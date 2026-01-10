import { PacketDefaults, ChecksumType, Checksum2Type } from './types.js';
import { calculateChecksumFromBuffer, calculateChecksum2FromBuffer } from './utils/checksum.js';
import { CelExecutor, CompiledScript } from './cel-executor.js';
import { Buffer } from 'buffer';
import { logger } from '../utils/logger.js';

/**
 * Handles the low-level parsing of incoming byte streams into discrete packets.
 *
 * Implements a sliding window buffer strategy to handle:
 * - Fragmentation (packets split across chunks)
 * - Coalescing (multiple packets in one chunk)
 * - Garbage data (noise on the line)
 *
 * It supports three primary parsing strategies based on the configuration:
 * 1. Fixed Length: `rx_length` is defined.
 * 2. Footer Delimited: `rx_footer` is defined.
 * 3. Variable Length / Checksum Sweep: Only `rx_header` is known, scans for valid checksums.
 */
export class PacketParser {
  private readonly MAX_BUFFER_SIZE = 16384; // 16KB limit
  private buffer: Buffer = Buffer.alloc(this.MAX_BUFFER_SIZE);
  private readOffset = 0;
  private writeOffset = 0;
  private lastRxTime: number = 0;
  private lastScannedLength: number = 0;
  private defaults: PacketDefaults;
  private headerBuffer: Buffer | null = null;
  private footerBuffer: Buffer | null = null;
  private isStandard1Byte: boolean = false;
  private isStandard2Byte: boolean = false;

  // Optimizations for CEL Checksums
  private preparedChecksum: CompiledScript | null = null;
  private preparedChecksum2: CompiledScript | null = null;

  private readonly checksumTypes = new Set([
    'add',
    'xor',
    'add_no_header',
    'xor_no_header',
    'samsung_rx',
    'samsung_tx',
    'none',
  ]);
  private readonly checksum2Types = new Set(['xor_add']);

  /**
   * @param defaults - Configuration defining packet structure (header, footer, checksum, length)
   */
  constructor(defaults: PacketDefaults) {
    this.defaults = defaults;
    if (this.defaults.rx_header && this.defaults.rx_header.length > 0) {
      this.headerBuffer = Buffer.from(this.defaults.rx_header);
    }
    if (this.defaults.rx_footer && this.defaults.rx_footer.length > 0) {
      this.footerBuffer = Buffer.from(this.defaults.rx_footer);
    }

    // Pre-calculate optimization flags for incremental checksums
    const checksumType = this.defaults.rx_checksum;
    this.isStandard1Byte =
      typeof checksumType === 'string' &&
      ['add', 'xor', 'add_no_header', 'xor_no_header', 'samsung_rx', 'samsung_tx'].includes(
        checksumType,
      );

    const checksum2Type = this.defaults.rx_checksum2;
    this.isStandard2Byte =
      typeof checksum2Type === 'string' &&
      ['xor_add'].includes(checksum2Type) &&
      (!this.defaults.rx_checksum || this.defaults.rx_checksum === 'none');

    // Prepare CEL scripts if applicable
    if (
      typeof checksumType === 'string' &&
      checksumType !== 'none' &&
      !this.checksumTypes.has(checksumType)
    ) {
      try {
        this.preparedChecksum = this.getExecutor().prepare(checksumType);
      } catch (err) {
        logger.warn({ err, checksumType }, '[PacketParser] Failed to prepare CEL checksum script');
      }
    }

    if (typeof checksum2Type === 'string' && !this.checksum2Types.has(checksum2Type)) {
      try {
        this.preparedChecksum2 = this.getExecutor().prepare(checksum2Type);
      } catch (err) {
        logger.warn(
          { err, checksum2Type },
          '[PacketParser] Failed to prepare CEL checksum2 script',
        );
      }
    }
  }

  private getExecutor(): CelExecutor {
    return CelExecutor.shared();
  }

  /**
   * Convenience method to parse a single byte.
   * Efficient mainly for testing; production code should typically use parseChunk with larger buffers.
   *
   * @param byte - The single byte to append
   * @returns The first parsed packet, or null if no packet is complete yet
   */
  public parse(byte: number): Buffer | null {
    const packets = this.parseChunk(Buffer.from([byte]));
    return packets.length > 0 ? packets[0] : null;
  }

  /**
   * Processes a chunk of incoming data and returns any complete packets found.
   *
   * The method appends the chunk to the internal buffer and attempts to extract packets
   * according to the configured strategy.
   *
   * Strategy Priority:
   * 1. **Header Enforcing**: If `rx_header` is configured, discard data until the header is found.
   * 2. **Fixed Length**: If `rx_length` is set, extract that many bytes (validating checksum).
   * 3. **Footer**: If `rx_footer` is set, scan for the footer and validate the frame.
   * 4. **Checksum Sweep**: (Fallback) Try every possible length and check if the checksum matches.
   *
   * @param chunk - The new data received from the interface
   * @returns An array of parsed packets (as Buffers)
   */
  public parseChunk(chunk: Buffer): Buffer[] {
    const now = Date.now();
    // Reset buffer on timeout to avoid stale partial packets corrupting new data
    if (this.defaults.rx_timeout && now - this.lastRxTime > this.defaults.rx_timeout) {
      this.resetBuffer();
    }
    this.lastRxTime = now;

    this.appendChunk(chunk);

    const packets: Buffer[] = [];
    const header = this.defaults.rx_header || [];
    const headerLen = header.length;

    // Safety guard to prevent infinite loops if the buffer isn't consumed
    let iterations = 0;
    const maxIterations = this.bufferLength() + 100;

    while (this.bufferLength() > 0) {
      iterations++;
      if (iterations > maxIterations) {
        // Force consumption of one byte to break strict loops
        this.consumeBytes(1);
        continue;
      }

      let bufferLength = this.bufferLength();

      // 1. Enforce Header (Sliding Window)
      // If a header is defined, we guarantee the buffer starts with it before proceeding.
      if (this.headerBuffer && headerLen > 0) {
        if (bufferLength < headerLen) break; // Wait for more data

        const idx = this.findPatternIndex(this.headerBuffer, this.readOffset);

        if (idx === -1) {
          // Header not found.
          // IMPORTANT: Keep the last few bytes (headerLen - 1) in case a header
          // is split between the end of this chunk and the start of the next.
          const keepLen = headerLen - 1;
          this.readOffset = Math.max(this.writeOffset - keepLen, 0);
          this.lastScannedLength = 0;
          break; // Stop processing this chunk
        } else if (idx > this.readOffset) {
          // Header found, but not at index 0. Discard garbage data before it.
          this.readOffset = idx;
          this.lastScannedLength = 0;
        }
        // If idx === readOffset, the buffer starts with the header. Proceed to extraction.
      }

      bufferLength = this.bufferLength();

      // 2. Find Packet Length and Extract
      let matchFound = false;
      let shift = false;

      if (this.defaults.rx_length && this.defaults.rx_length > 0) {
        // Strategy A: Fixed Length
        if (this.bufferLength() >= this.defaults.rx_length) {
          // Check Checksum
          if (this.verifyChecksum(this.buffer, this.readOffset, this.defaults.rx_length)) {
            const packet = Buffer.from(
              this.buffer.subarray(this.readOffset, this.readOffset + this.defaults.rx_length),
            );
            packets.push(packet);
            this.consumeBytes(this.defaults.rx_length);
            matchFound = true;
          } else {
            shift = true; // Invalid checksum for fixed length -> discard byte and try again
          }
        }
      } else if (this.defaults.rx_footer && this.defaults.rx_footer.length > 0) {
        // Strategy B: Footer Delimited
        // Scan for footer that satisfies checksum
        const checksumLen = this.getChecksumLength();
        const minLen = headerLen + 1 + checksumLen + this.defaults.rx_footer.length;

        if (bufferLength >= minLen && this.footerBuffer) {
          const footerLen = this.footerBuffer.length;
          // Footer ends at 'len', so it starts at 'len - footerLen'.
          // 'len' starts at 'minLen', so start search at 'minLen - footerLen'.
          let searchIdx = this.readOffset + minLen - footerLen;

          // Optimization: Check for standard 1-byte checksum to enable incremental calculation
          // This avoids O(N^2) complexity when many false footers are present
          if (this.isStandard1Byte) {
            // Incremental Checksum Strategy for Footer Delimited
            let runningChecksum = 0;
            const typeStr = this.defaults.rx_checksum as string;
            const isSamsungRx = typeStr === 'samsung_rx';
            const isSamsungTx = typeStr === 'samsung_tx';
            const isAdd = typeStr.startsWith('add');
            const isNoHeader = typeStr.includes('no_header') || isSamsungRx || isSamsungTx;

            if (isSamsungRx) {
              runningChecksum = 0xb0;
            }

            const baseOffset = this.readOffset;
            const startIdx = baseOffset + (isNoHeader ? headerLen : 0);

            // Track the index up to which we have already calculated the checksum
            let processedIdx = startIdx;

            // Optimization: Use indexOf to find footer candidates instead of checking every byte
            while (searchIdx <= this.writeOffset - footerLen) {
              const foundIdx = this.buffer.indexOf(this.footerBuffer, searchIdx);
              if (foundIdx === -1 || foundIdx + footerLen > this.writeOffset) break;

              const len = foundIdx + footerLen - this.readOffset;

              // Verify checksum incrementally
              // Packet: [Header ... Data ... Checksum ... Footer]
              const currentDataEnd = baseOffset + len - 1 - footerLen;

              // Update running checksum up to currentDataEnd
              if (processedIdx < currentDataEnd) {
                if (isAdd) {
                  for (let i = processedIdx; i < currentDataEnd; i++) {
                    runningChecksum += this.buffer[i];
                  }
                } else {
                  for (let i = processedIdx; i < currentDataEnd; i++) {
                    runningChecksum ^= this.buffer[i];
                  }
                }
                processedIdx = currentDataEnd;
              }

              // Apply final modifiers for Samsung types
              let finalChecksum = runningChecksum;
              if (isSamsungTx) {
                finalChecksum ^= 0x80;
              } else if (isSamsungRx) {
                // Check first byte of data (if it exists)
                if (currentDataEnd > startIdx && this.buffer[startIdx] < 0x7c) {
                  finalChecksum ^= 0x80;
                }
              }

              const expected = this.buffer[baseOffset + len - 1 - footerLen];
              if ((finalChecksum & 0xff) === expected) {
                const packet = Buffer.from(
                  this.buffer.subarray(this.readOffset, this.readOffset + len),
                );
                packets.push(packet);
                this.consumeBytes(len);
                matchFound = true;
                break;
              }

              // Footer found but checksum failed. Continue searching after this footer.
              searchIdx = foundIdx + 1;
            }
          } else {
            // Standard unoptimized loop for complex checksums (CEL, Samsung, etc.)
            while (searchIdx <= this.writeOffset - footerLen) {
              const foundIdx = this.buffer.indexOf(this.footerBuffer, searchIdx);
              if (foundIdx === -1 || foundIdx + footerLen > this.writeOffset) break;

              const len = foundIdx + footerLen - this.readOffset;
              if (this.verifyChecksum(this.buffer, this.readOffset, len)) {
                const packet = Buffer.from(
                  this.buffer.subarray(this.readOffset, this.readOffset + len),
                );
                packets.push(packet);
                this.consumeBytes(len);
                matchFound = true;
                break;
              }

              // Footer found but checksum failed. Continue searching after this footer.
              searchIdx = foundIdx + 1;
            }
          }
        }
      } else {
        // Strategy C: Checksum Sweep (Variable Length)
        // No fixed length, no footer.
        // Assume valid packet if checksum matches. This is the most expensive strategy.
        const checksumLen = this.getChecksumLength();
        const minLen = headerLen + checksumLen;
        if (checksumLen > 0 && bufferLength >= minLen) {
          const startLen = Math.max(minLen, this.lastScannedLength + 1);

          if (this.isStandard1Byte) {
            const typeStr = this.defaults.rx_checksum as string;
            const isSamsungRx = typeStr === 'samsung_rx';
            const isSamsungTx = typeStr === 'samsung_tx';
            const isAdd = typeStr.startsWith('add');
            // Samsung types also skip header (like _no_header types)
            const isNoHeader = typeStr.includes('no_header') || isSamsungRx || isSamsungTx;

            // Optimization: Incremental checksum calculation
            // Instead of re-calculating the full checksum for every candidate length,
            // we update the checksum incrementally as we advance the length.
            let runningChecksum = 0;

            // Samsung RX starts with 0xB0, others 0
            if (isSamsungRx) {
              runningChecksum = 0xb0;
            }

            const baseOffset = this.readOffset;
            const startIdx = baseOffset + (isNoHeader ? headerLen : 0);
            const initialDataEnd = baseOffset + startLen - checksumLen;

            // Calculate initial checksum for the starting packet length
            if (isAdd) {
              for (let i = startIdx; i < initialDataEnd; i++) {
                runningChecksum += this.buffer[i];
              }
            } else {
              for (let i = startIdx; i < initialDataEnd; i++) {
                runningChecksum ^= this.buffer[i];
              }
            }

            for (let len = startLen; len <= bufferLength; len++) {
              // Update checksum with the new byte added to the data section
              if (len > startLen) {
                // The byte that was previously the checksum (or part of future data)
                // is now part of the data being checksummed.
                // Packet length increased by 1, so data section extended by 1.
                // The new data byte is at `len - 1 - checksumLen`.
                const newByte = this.buffer[baseOffset + len - 1 - checksumLen];
                if (isAdd) {
                  runningChecksum += newByte;
                } else {
                  runningChecksum ^= newByte;
                }
              }

              // Apply final modifiers for Samsung types
              let finalChecksum = runningChecksum;
              if (isSamsungTx) {
                finalChecksum ^= 0x80;
              } else if (isSamsungRx) {
                // Check first byte of data (if it exists)
                // Data region is [startIdx, len - checksumLen)
                const currentDataEnd = baseOffset + len - checksumLen;
                if (currentDataEnd > startIdx && this.buffer[startIdx] < 0x7c) {
                  finalChecksum ^= 0x80;
                }
              }

              const expected = this.buffer[baseOffset + len - 1];
              if ((finalChecksum & 0xff) === expected) {
                const packet = Buffer.from(
                  this.buffer.subarray(this.readOffset, this.readOffset + len),
                );
                packets.push(packet);
                this.consumeBytes(len);
                this.lastScannedLength = 0;
                matchFound = true;
                break;
              }
            }
          } else if (this.isStandard2Byte) {
            // Incremental Checksum Strategy for 2-byte Checksums (xor_add)
            // xor_add maintains two running values: crc (sum) and temp (xor).
            // Updates are commutative, so we can incrementally update them.
            // Checksum location: last 2 bytes [high, low] = [temp, crc]

            let runningCrc = 0;
            let runningTemp = 0;
            const baseOffset = this.readOffset;

            // Calculate initial checksum for the starting packet length
            // xor_add processes header + data linearly.
            // Data ends at `len - 2`.
            const initialDataEnd = baseOffset + startLen - 2;

            for (let i = baseOffset; i < initialDataEnd; i++) {
              const byte = this.buffer[i];
              runningCrc += byte;
              runningTemp ^= byte;
            }

            for (let len = startLen; len <= bufferLength; len++) {
              // Update checksum with the new byte added to the data section
              if (len > startLen) {
                // The byte that was previously the checksum high byte (or part of future data)
                // is now part of the data being checksummed.
                // The new data byte is at `len - 1 - 2` = `len - 3` relative to start of packet.
                // Wait, previous length was `len - 1`. Data ended at `len - 1 - 2`.
                // New length is `len`. Data ends at `len - 2`.
                // So we need to add the byte at `len - 3` (relative to readOffset) to the running checksum.
                const newByte = this.buffer[baseOffset + len - 3];
                runningCrc += newByte;
                runningTemp ^= newByte;
              }

              // Finalize checksum: crc += temp
              const finalCrc = (runningCrc + runningTemp) & 0xff;
              const finalTemp = runningTemp & 0xff;

              // Expected bytes at the end of the packet
              const expectedHigh = this.buffer[baseOffset + len - 2];
              const expectedLow = this.buffer[baseOffset + len - 1];

              if (finalTemp === expectedHigh && finalCrc === expectedLow) {
                const packet = Buffer.from(
                  this.buffer.subarray(this.readOffset, this.readOffset + len),
                );
                packets.push(packet);
                this.consumeBytes(len);
                this.lastScannedLength = 0;
                matchFound = true;
                break;
              }
            }
          } else {
            // Standard unoptimized loop for complex checksums (CEL, Samsung, etc.)
            for (let len = startLen; len <= bufferLength; len++) {
              if (this.verifyChecksum(this.buffer, this.readOffset, len)) {
                const packet = Buffer.from(
                  this.buffer.subarray(this.readOffset, this.readOffset + len),
                );
                packets.push(packet);
                this.consumeBytes(len);
                this.lastScannedLength = 0;
                matchFound = true;
                break;
              }
            }
          }
        }
      }

      if (matchFound) {
        continue;
      }

      // Handle failed match
      if (this.defaults.rx_length && this.defaults.rx_length > 0) {
        if (shift) {
          // If we had a fixed length but checksum failed, shift 1 byte to realign
          this.consumeBytes(1);
          this.lastScannedLength = 0;
          continue;
        }
        // Waiting for more data to reach rx_length
        break;
      } else {
        // Variable length: waiting for more data to find a footer or valid checksum
        this.lastScannedLength = this.bufferLength();
        break;
      }
    }

    return packets;
  }

  private bufferLength(): number {
    return this.writeOffset - this.readOffset;
  }

  private resetBuffer(): void {
    this.readOffset = 0;
    this.writeOffset = 0;
    this.lastScannedLength = 0;
  }

  private compactBuffer(): void {
    if (this.readOffset === 0) return;
    if (this.readOffset >= this.writeOffset) {
      this.resetBuffer();
      return;
    }
    this.buffer.copy(this.buffer, 0, this.readOffset, this.writeOffset);
    this.writeOffset -= this.readOffset;
    this.readOffset = 0;
  }

  private appendChunk(chunk: Buffer): void {
    if (chunk.length === 0) return;

    if (chunk.length >= this.MAX_BUFFER_SIZE) {
      chunk = chunk.subarray(chunk.length - this.MAX_BUFFER_SIZE);
      this.resetBuffer();
    }

    if (this.writeOffset + chunk.length > this.MAX_BUFFER_SIZE) {
      this.compactBuffer();
    }

    if (this.writeOffset + chunk.length > this.MAX_BUFFER_SIZE) {
      const overflow = this.writeOffset + chunk.length - this.MAX_BUFFER_SIZE;
      this.readOffset = Math.min(this.readOffset + overflow, this.writeOffset);
      this.lastScannedLength = 0;
      if (this.readOffset === this.writeOffset) {
        this.resetBuffer();
      }
      if (this.writeOffset + chunk.length > this.MAX_BUFFER_SIZE) {
        this.compactBuffer();
      }
    }

    chunk.copy(this.buffer, this.writeOffset);
    this.writeOffset += chunk.length;
  }

  private consumeBytes(length: number): void {
    this.readOffset += length;
    if (this.readOffset >= this.writeOffset) {
      this.resetBuffer();
    }
  }

  private findPatternIndex(pattern: Buffer, startOffset: number): number {
    const idx = this.buffer.indexOf(pattern, startOffset);
    if (idx === -1 || idx + pattern.length > this.writeOffset) return -1;
    return idx;
  }

  private getChecksumLength(): number {
    return this.defaults.rx_checksum2
      ? 2
      : this.defaults.rx_checksum && this.defaults.rx_checksum !== 'none'
        ? 1
        : 0;
  }

  /**
   * Verifies the checksum of a potential packet candidate.
   *
   * @param buffer - The buffer containing the candidate packet
   * @param offset - The offset where the candidate packet starts
   * @param length - The length of the candidate packet to verify
   */
  private verifyChecksum(buffer: Buffer, offset: number, length: number): boolean {
    if (this.defaults.rx_checksum === 'none') return true;

    // 1-byte Checksum
    if (this.defaults.rx_checksum) {
      let checksumByte = buffer[offset + length - 1];
      let dataEnd = offset + length - 1;

      if (this.defaults.rx_footer && this.defaults.rx_footer.length > 0) {
        // If there is a footer, the checksum is usually immediately BEFORE the footer
        checksumByte = buffer[offset + length - 1 - this.defaults.rx_footer.length];
        dataEnd = offset + length - 1 - this.defaults.rx_footer.length;
      }

      if (typeof this.defaults.rx_checksum === 'string') {
        const checksumOrScript = this.defaults.rx_checksum as string;

        if (this.checksumTypes.has(checksumOrScript)) {
          // Standard algorithm (add, xor, etc.)
          const headerLength = this.defaults.rx_header?.length || 0;
          const calculated = calculateChecksumFromBuffer(
            buffer,
            checksumOrScript as ChecksumType,
            headerLength,
            dataEnd - offset,
            offset,
          );
          return calculated === checksumByte;
        } else if (this.preparedChecksum) {
          // Prepared CEL Expression
          // Optimization: Use prepared script to bypass cache lookups
          const result = this.preparedChecksum.execute({
            data: buffer.subarray(offset, dataEnd), // Pass Buffer directly to avoid array spread
            len: dataEnd - offset,
          });
          return result === checksumByte;
        } else {
          // Fallback (should not be reached if constructor works correctly)
          const result = this.getExecutor().execute(checksumOrScript, {
            data: buffer.subarray(offset, dataEnd),
            len: dataEnd - offset,
          });
          return result === checksumByte;
        }
      }
      return false;
    }

    // 2-byte Checksum
    if (this.defaults.rx_checksum2) {
      const footerLength = this.defaults.rx_footer?.length || 0;
      const headerLength = this.defaults.rx_header?.length || 0;

      // Ensure packet is long enough to contain checksum
      const checksumStart = offset + length - 2 - footerLength;
      if (checksumStart < offset + headerLength) return false;

      if (typeof this.defaults.rx_checksum2 === 'string') {
        const checksumOrScript = this.defaults.rx_checksum2 as string;

        if (this.checksum2Types.has(checksumOrScript)) {
          const calculated = calculateChecksum2FromBuffer(
            buffer,
            checksumOrScript as Checksum2Type,
            headerLength,
            checksumStart - offset,
            offset,
          );
          return (
            calculated[0] === buffer[checksumStart] && calculated[1] === buffer[checksumStart + 1]
          );
        } else if (this.preparedChecksum2) {
          // Prepared CEL Expression for 2-byte checksum
          const result = this.preparedChecksum2.execute({
            data: buffer.subarray(offset, checksumStart),
            len: checksumStart - offset,
          });
          if (Array.isArray(result) && result.length === 2) {
            return result[0] === buffer[checksumStart] && result[1] === buffer[checksumStart + 1];
          }
        } else {
          // Fallback (legacy path)
          const result = this.getExecutor().execute(checksumOrScript, {
            data: buffer.subarray(offset, checksumStart),
            len: checksumStart - offset,
          });
          if (Array.isArray(result) && result.length === 2) {
            return result[0] === buffer[checksumStart] && result[1] === buffer[checksumStart + 1];
          }
        }
      }
    }

    return true;
  }
}

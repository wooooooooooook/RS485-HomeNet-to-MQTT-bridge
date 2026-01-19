import { PacketDefaults, ChecksumType, Checksum2Type } from './types.js';
import { calculateChecksumFromBuffer, calculateChecksum2FromBuffer } from './utils/checksum.js';
import { CelExecutor, CompiledScript, ReusableBufferView } from './cel-executor.js';
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
  // Optimization: Use Uint8Array (0 or 1) for fast O(1) array access instead of Set.has()
  // This provides ~4x faster lookups in hot loops
  private validHeadersTable: Uint8Array | null = null;
  private validHeaderCount: number = 0;
  private isStandard1Byte: boolean = false;
  private isStandard2Byte: boolean = false;

  // Optimizations for CEL Checksums
  private preparedChecksum: CompiledScript | null = null;
  private preparedChecksum2: CompiledScript | null = null;
  private preparedLengthExpr: CompiledScript | null = null;
  private reusableBufferView: ReusableBufferView | null = null;
  private readonly reusableContext = {
    x: 0n,
    xstr: '',
    data: null as any,
    len: 0n,
    state: {},
    states: {},
    trigger: {},
    args: {},
  };

  private readonly checksumTypes = new Set([
    'add',
    'xor',
    'add_no_header',
    'xor_no_header',
    'samsung_rx',
    'samsung_tx',
    'samsung_xor',
    'bestin_sum',
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
    if (this.defaults.rx_valid_headers && this.defaults.rx_valid_headers.length > 0) {
      this.validHeadersTable = new Uint8Array(256);
      this.validHeaderCount = 0;
      for (const byte of this.defaults.rx_valid_headers) {
        if (byte >= 0 && byte <= 255) {
          this.validHeadersTable[byte] = 1;
          this.validHeaderCount++;
        }
      }
    }

    // Pre-calculate optimization flags for incremental checksums
    const checksumType = this.defaults.rx_checksum;
    this.isStandard1Byte =
      typeof checksumType === 'string' &&
      checksumType !== 'none' &&
      this.checksumTypes.has(checksumType);

    const checksum2Type = this.defaults.rx_checksum2;
    this.isStandard2Byte =
      typeof checksum2Type === 'string' &&
      checksum2Type !== 'none' &&
      this.checksum2Types.has(checksum2Type);

    // Prepare CEL scripts if applicable
    const executor = this.getExecutor();

    // Initialize ReusableBufferView for zero-allocation parsing
    this.reusableBufferView = executor.createReusableBufferView();
    this.reusableContext.data = this.reusableBufferView.proxy;

    if (
      typeof checksumType === 'string' &&
      checksumType !== 'none' &&
      !this.checksumTypes.has(checksumType)
    ) {
      try {
        this.preparedChecksum = executor.prepare(checksumType);
      } catch (err) {
        logger.warn({ err, checksumType }, '[PacketParser] Failed to prepare CEL checksum script');
      }
    }

    if (typeof checksum2Type === 'string' && !this.checksum2Types.has(checksum2Type)) {
      try {
        this.preparedChecksum2 = executor.prepare(checksum2Type);
      } catch (err) {
        logger.warn(
          { err, checksum2Type },
          '[PacketParser] Failed to prepare CEL checksum2 script',
        );
      }
    }

    // Prepare rx_length_expr for dynamic packet length calculation
    if (this.defaults.rx_length_expr) {
      if (this.defaults.rx_length && this.defaults.rx_length > 0) {
        logger.warn(
          '[PacketParser] Both rx_length and rx_length_expr are defined. rx_length takes precedence, rx_length_expr will be ignored.',
        );
      } else {
        try {
          this.preparedLengthExpr = executor.prepare(this.defaults.rx_length_expr);
        } catch (err) {
          logger.warn(
            { err, expr: this.defaults.rx_length_expr },
            '[PacketParser] Failed to prepare CEL rx_length_expr script',
          );
        }
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
        // Optimized scanning loop: Check all possible offsets in the current buffer at once.
        // This avoids the overhead of repeated function calls and context resetting in the main loop
        // when valid packets are sparse (noise).
        if (this.bufferLength() >= this.defaults.rx_length) {
          const packetLen = this.defaults.rx_length;
          let currentOffset = this.readOffset;
          const maxOffset = this.writeOffset - packetLen;

          // Optimization: Prepare sliding window checksum state
          let useSlidingWindow = false;
          let runningChecksum = 0;
          let runningChecksum2: number[] = [0, 0]; // [crc, temp]
          let windowStartRel = 0;
          let windowEndRel = 0;
          let checksumIndexRel = 0;

          const typeStr = this.defaults.rx_checksum as string;
          const isSamsungRx = typeStr === 'samsung_rx';
          const isSamsungTx = typeStr === 'samsung_tx';
          const isSamsungXor = typeStr === 'samsung_xor';
          // bestin_sum is not commutative/associative in a way that supports simple sliding window
          const isBestinSum = typeStr === 'bestin_sum';
          const isAdd =
            typeStr &&
            typeStr.startsWith('add') &&
            !isSamsungRx &&
            !isSamsungTx &&
            !isSamsungXor &&
            !isBestinSum;
          const isXor =
            typeStr &&
            typeStr.startsWith('xor') &&
            !isSamsungRx &&
            !isSamsungTx &&
            !isSamsungXor &&
            !isBestinSum;

          const headerLen = this.defaults.rx_header?.length || 0;
          const footerLen = this.defaults.rx_footer?.length || 0;

          // Optimization: Disable sliding window if we have a sparse validHeadersTable.
          // If the validHeadersTable is sparse (few valid headers), we will skip most bytes.
          // In this case, maintaining the sliding window checksum is overhead for skipped bytes.
          // It's faster to skip (O(1)) and calculate full checksum on demand (O(Length)) when a valid header is found.
          // Threshold 16 is empirically determined (256/16 = 16x skips per match).
          const useSparseScan = this.validHeaderCount > 0 && this.validHeaderCount < 16;

          if (!useSparseScan && this.isStandard1Byte && !isBestinSum) {
            useSlidingWindow = true;
            const isNoHeader =
              typeStr.includes('no_header') || isSamsungRx || isSamsungTx || isSamsungXor;

            windowStartRel = isNoHeader ? headerLen : 0;
            // Checksum is usually at the end of data (before footer)
            // rx_checksum=1 byte.
            // Data ends at packetLen - 1 - footerLen
            windowEndRel = packetLen - 1 - footerLen;
            checksumIndexRel = windowEndRel;

            // Initialize checksum for the first window at currentOffset
            if (currentOffset <= maxOffset) {
              const startIdx = currentOffset + windowStartRel;
              const endIdx = currentOffset + windowEndRel;

              if (isSamsungRx) {
                runningChecksum = 0xb0;
              } else if (isSamsungTx) {
                runningChecksum = 0x00;
              } else {
                runningChecksum = 0;
              }

              if (isAdd) {
                for (let i = startIdx; i < endIdx; i++) {
                  runningChecksum = (runningChecksum + this.buffer[i]) & 0xff;
                }
              } else {
                for (let i = startIdx; i < endIdx; i++) {
                  runningChecksum ^= this.buffer[i];
                }
              }
            }
          } else if (!useSparseScan && this.isStandard2Byte) {
            useSlidingWindow = true;
            // xor_add (checksum2)
            // Always includes header (no _no_header variant currently for checksum2)
            windowStartRel = 0;
            // Checksum is 2 bytes.
            // Data ends at packetLen - 2 - footerLen
            windowEndRel = packetLen - 2 - footerLen;
            checksumIndexRel = windowEndRel;

            if (currentOffset <= maxOffset) {
              const startIdx = currentOffset + windowStartRel;
              const endIdx = currentOffset + windowEndRel;

              // runningChecksum2 = [crc, temp]
              let crc = 0;
              let temp = 0;
              for (let i = startIdx; i < endIdx; i++) {
                const b = this.buffer[i];
                crc += b;
                temp ^= b;
              }
              runningChecksum2[0] = crc;
              runningChecksum2[1] = temp;
            }
          }

          while (currentOffset <= maxOffset) {
            // Optimization: Check header first before expensive checksum
            if (this.validHeadersTable && this.validHeadersTable[this.buffer[currentOffset]] === 0) {
              // Even if we skip, we MUST update the sliding window checksum for the shift
              if (useSlidingWindow) {
                const leavingByte = this.buffer[currentOffset + windowStartRel];
                const enteringByte = this.buffer[currentOffset + windowEndRel];

                if (this.isStandard1Byte) {
                  if (isAdd) {
                    runningChecksum = (runningChecksum - leavingByte + enteringByte) & 0xff;
                  } else {
                    runningChecksum = runningChecksum ^ leavingByte ^ enteringByte;
                  }
                } else {
                  // xor_add
                  const bOut = leavingByte;
                  const bIn = enteringByte;
                  runningChecksum2[0] = runningChecksum2[0] - bOut + bIn; // crc
                  runningChecksum2[1] = runningChecksum2[1] ^ bOut ^ bIn; // temp
                }
              }

              currentOffset++;
              continue;
            }

            // Check Checksum for current window
            let checksumValid = false;

            if (useSlidingWindow) {
              if (this.isStandard1Byte) {
                let finalChecksum = runningChecksum;
                if (isSamsungTx) {
                  finalChecksum ^= 0x80;
                } else if (isSamsungRx) {
                  // Check first byte of data (if it exists)
                  // Data starts at currentOffset + headerLen
                  const dataStartIdx = currentOffset + headerLen;
                  if (
                    dataStartIdx < currentOffset + windowEndRel &&
                    this.buffer[dataStartIdx] < 0x7c
                  ) {
                    finalChecksum ^= 0x80;
                  }
                } else if (isSamsungXor) {
                  finalChecksum &= 0x7f;
                }

                const expected = this.buffer[currentOffset + checksumIndexRel];
                checksumValid = (finalChecksum & 0xff) === expected;
              } else {
                // xor_add
                // Finalize: crc += temp
                const temp = runningChecksum2[1] & 0xff;
                const crc = (runningChecksum2[0] + temp) & 0xff;

                const expectedHigh = this.buffer[currentOffset + checksumIndexRel];
                const expectedLow = this.buffer[currentOffset + checksumIndexRel + 1];

                checksumValid = temp === expectedHigh && crc === expectedLow;
              }
            } else {
              checksumValid = this.verifyChecksum(this.buffer, currentOffset, packetLen);
            }

            if (checksumValid) {
              const packet = Buffer.from(
                this.buffer.subarray(currentOffset, currentOffset + packetLen),
              );
              packets.push(packet);

              // Packet found: Advance readOffset beyond this packet
              const advance = currentOffset - this.readOffset + packetLen;
              this.consumeBytes(advance);
              matchFound = true;
              break;
            }

            // If verification failed, try next byte
            if (useSlidingWindow) {
              const leavingByte = this.buffer[currentOffset + windowStartRel];
              const enteringByte = this.buffer[currentOffset + windowEndRel];

              if (this.isStandard1Byte) {
                if (isAdd) {
                  runningChecksum = (runningChecksum - leavingByte + enteringByte) & 0xff;
                } else {
                  runningChecksum = runningChecksum ^ leavingByte ^ enteringByte;
                }
              } else {
                // xor_add
                const bOut = leavingByte;
                const bIn = enteringByte;
                runningChecksum2[0] = runningChecksum2[0] - bOut + bIn; // crc
                runningChecksum2[1] = runningChecksum2[1] ^ bOut ^ bIn; // temp
              }
            }

            currentOffset++;
          }

          // Optimization: If we scanned a large chunk and found nothing, discard it
          // to keep the buffer clean and avoid re-scanning the same bytes next time.
          // However, we must stop at `maxOffset` because new data might complete a packet starting at `maxOffset` or later.
          if (!matchFound) {
            const scannedBytes = currentOffset - this.readOffset;
            if (scannedBytes > 0) {
              // We scanned up to `maxOffset` (exclusive of `currentOffset` which is `maxOffset + 1` at loop exit).
              // We can safely discard bytes up to `maxOffset` because we know they don't start a valid packet
              // (since we checked them all).
              this.consumeBytes(scannedBytes);
            }
          }
        }
      } else if (this.defaults.rx_footer && this.defaults.rx_footer.length > 0) {
        // Strategy B: Footer Delimited
        // Scan for footer that satisfies checksum
        const checksumLen = this.getChecksumLength();
        const minLen = headerLen + 1 + checksumLen + this.defaults.rx_footer.length;

        if (bufferLength >= minLen && this.footerBuffer) {
          // Optimization: Check header first to skip invalid start bytes immediately
          if (this.validHeadersTable && this.validHeadersTable[this.buffer[this.readOffset]] === 0) {
            this.consumeBytes(1);
            this.lastScannedLength = 0;
            continue;
          }

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
            const isSamsungXor = typeStr === 'samsung_xor';
            const isBestinSum = typeStr === 'bestin_sum';
            const isAdd = typeStr.startsWith('add');
            const isNoHeader = typeStr.includes('no_header') || isSamsungRx || isSamsungTx;

            if (isSamsungRx) {
              runningChecksum = 0xb0;
            } else if (isBestinSum) {
              runningChecksum = 3;
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
                if (isBestinSum) {
                  for (let i = processedIdx; i < currentDataEnd; i++) {
                    runningChecksum = ((this.buffer[i] ^ runningChecksum) + 1) & 0xff;
                  }
                } else if (isAdd) {
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
              } else if (isSamsungXor) {
                finalChecksum &= 0x7f;
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
          // Optimization: Pre-check valid headers to avoid expensive calculations and skip invalid starts immediately
          if (this.validHeadersTable && this.validHeadersTable[this.buffer[this.readOffset]] === 0) {
            this.consumeBytes(1);
            this.lastScannedLength = 0;
            continue;
          }

          // Optimization: Use rx_length_expr to calculate packet length directly
          // If the expression returns a valid length, verify only that length.
          // If it returns 0 or the buffer is insufficient, fallback to checksum sweep.
          if (this.preparedLengthExpr && this.reusableBufferView) {
            this.reusableBufferView.update(this.buffer, this.readOffset, bufferLength);
            try {
              // Optimization: Use reusableContext for rx_length_expr
              // We need to set 'len' in reusableContext to current buffer length
              this.reusableContext.len = BigInt(bufferLength);
              const exprResult = this.preparedLengthExpr.executeRaw(this.reusableContext);

              const dynamicLen = typeof exprResult === 'bigint' ? Number(exprResult) : exprResult;

              if (typeof dynamicLen === 'number' && dynamicLen > 0 && dynamicLen <= bufferLength) {
                // Dynamic length provided - verify only this length
                if (this.verifyChecksum(this.buffer, this.readOffset, dynamicLen)) {
                  // Validate first byte against valid headers if configured
                  if (
                    !this.validHeadersTable ||
                    this.validHeadersTable[this.buffer[this.readOffset]] === 1
                  ) {
                    const packet = Buffer.from(
                      this.buffer.subarray(this.readOffset, this.readOffset + dynamicLen),
                    );
                    packets.push(packet);
                    this.consumeBytes(dynamicLen);
                    this.lastScannedLength = 0;
                    matchFound = true;
                  }
                }
                // If checksum failed or header invalid, treat as no match (will shift 1 byte later)
                if (matchFound) continue;
              }
              // If dynamicLen <= 0 or > bufferLength, fallback to checksum sweep
            } catch (err) {
              logger.debug({ err }, '[PacketParser] rx_length_expr execution failed, using sweep');
            }
          }

          const startLen = Math.max(minLen, this.lastScannedLength + 1);

          if (this.isStandard1Byte) {
            const typeStr = this.defaults.rx_checksum as string;
            const isSamsungRx = typeStr === 'samsung_rx';
            const isSamsungTx = typeStr === 'samsung_tx';
            const isSamsungXor = typeStr === 'samsung_xor';
            const isBestinSum = typeStr === 'bestin_sum';
            const isAdd = typeStr.startsWith('add');
            // Samsung types also skip header (like _no_header types)
            const isNoHeader = typeStr.includes('no_header') || isSamsungRx || isSamsungTx;

            // Optimization: Incremental checksum calculation
            // Instead of re-calculating the full checksum for every candidate length,
            // we update the checksum incrementally as we advance the length.
            let runningChecksum = 0;

            // Samsung RX starts with 0xB0, Bestin starts with 3, others 0
            if (isSamsungRx) {
              runningChecksum = 0xb0;
            } else if (isBestinSum) {
              runningChecksum = 3;
            }

            const baseOffset = this.readOffset;
            const startIdx = baseOffset + (isNoHeader ? headerLen : 0);
            const initialDataEnd = baseOffset + startLen - checksumLen;

            // Calculate initial checksum for the starting packet length
            if (isBestinSum) {
              for (let i = startIdx; i < initialDataEnd; i++) {
                runningChecksum = ((this.buffer[i] ^ runningChecksum) + 1) & 0xff;
              }
            } else if (isAdd) {
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
                if (isBestinSum) {
                  runningChecksum = ((newByte ^ runningChecksum) + 1) & 0xff;
                } else if (isAdd) {
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
              } else if (isSamsungXor) {
                finalChecksum &= 0x7f;
              }

              const expected = this.buffer[baseOffset + len - 1];
              if ((finalChecksum & 0xff) === expected) {
                // Validate first byte against valid headers if configured
                if (
                  this.validHeadersTable &&
                  this.validHeadersTable[this.buffer[this.readOffset]] === 0
                ) {
                  continue;
                }
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
                // Validate first byte against valid headers if configured
                if (
                  this.validHeadersTable &&
                  this.validHeadersTable[this.buffer[this.readOffset]] === 0
                ) {
                  continue;
                }
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
                // Validate first byte against valid headers if configured
                if (
                  this.validHeadersTable &&
                  this.validHeadersTable[this.buffer[this.readOffset]] === 0
                ) {
                  continue;
                }
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
          // Optimization: Use ReusableBufferView to avoid allocation (Strategy C)
          if (this.reusableBufferView) {
            this.reusableBufferView.update(buffer, offset, dataEnd - offset);
            // Reuse context object + bypass safety checks for speed
            // data matches reusableBufferView.proxy
            this.reusableContext.len = BigInt(dataEnd - offset);
            const result = this.preparedChecksum.executeRaw(this.reusableContext);
            return result === checksumByte;
          } else {
            // Fallback (e.g. if ReusableBufferView initialization failed)
            const result = this.preparedChecksum.execute({
              data: buffer.subarray(offset, dataEnd),
              len: dataEnd - offset,
            });
            return result === checksumByte;
          }
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
          if (this.reusableBufferView) {
            this.reusableBufferView.update(buffer, offset, checksumStart - offset);

            // Optimization: Reuse context object for 2-byte checksum
            this.reusableContext.len = BigInt(checksumStart - offset);

            const result = this.preparedChecksum2.executeRaw(this.reusableContext);

            if (Array.isArray(result) && result.length === 2) {
              return result[0] === buffer[checksumStart] && result[1] === buffer[checksumStart + 1];
            }
          } else {
            const result = this.preparedChecksum2.execute({
              data: buffer.subarray(offset, checksumStart),
              len: checksumStart - offset,
            });
            if (Array.isArray(result) && result.length === 2) {
              return result[0] === buffer[checksumStart] && result[1] === buffer[checksumStart + 1];
            }
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

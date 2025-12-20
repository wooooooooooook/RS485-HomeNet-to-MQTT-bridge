import { PacketDefaults, ChecksumType, Checksum2Type } from './types.js';
import { calculateChecksumFromBuffer, calculateChecksum2FromBuffer } from './utils/checksum.js';
import { CelExecutor } from './cel-executor.js';
import { Buffer } from 'buffer';

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
  private buffer: Buffer = Buffer.alloc(0);
  private lastRxTime: number = 0;
  private defaults: PacketDefaults;
  private celExecutor: CelExecutor;
  private headerBuffer: Buffer | null = null;
  private footerBuffer: Buffer | null = null;

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
    this.celExecutor = new CelExecutor();
    if (this.defaults.rx_header && this.defaults.rx_header.length > 0) {
      this.headerBuffer = Buffer.from(this.defaults.rx_header);
    }
    if (this.defaults.rx_footer && this.defaults.rx_footer.length > 0) {
      this.footerBuffer = Buffer.from(this.defaults.rx_footer);
    }
  }

  /**
   * Convenience method to parse a single byte.
   * Efficient mainly for testing; production code should typically use parseChunk with larger buffers.
   *
   * @param byte - The single byte to append
   * @returns The first parsed packet, or null if no packet is complete yet
   */
  public parse(byte: number): number[] | null {
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
   * @returns An array of parsed packets (as number arrays)
   */
  public parseChunk(chunk: Buffer): number[][] {
    const now = Date.now();
    // Reset buffer on timeout to avoid stale partial packets corrupting new data
    if (this.defaults.rx_timeout && now - this.lastRxTime > this.defaults.rx_timeout) {
      this.buffer = Buffer.alloc(0);
    }
    this.lastRxTime = now;

    this.buffer = Buffer.concat([this.buffer, chunk]);

    const packets: number[][] = [];
    const header = this.defaults.rx_header || [];
    const headerLen = header.length;

    // Safety guard to prevent infinite loops if the buffer isn't consumed
    let iterations = 0;
    const maxIterations = this.buffer.length + 100;

    while (this.buffer.length > 0) {
      iterations++;
      if (iterations > maxIterations) {
        // Force consumption of one byte to break strict loops
        this.buffer = this.buffer.subarray(1);
        continue;
      }

      // 1. Enforce Header (Sliding Window)
      // If a header is defined, we guarantee the buffer starts with it before proceeding.
      if (this.headerBuffer && headerLen > 0) {
        if (this.buffer.length < headerLen) break; // Wait for more data

        const idx = this.buffer.indexOf(this.headerBuffer);

        if (idx === -1) {
          // Header not found.
          // IMPORTANT: Keep the last few bytes (headerLen - 1) in case a header
          // is split between the end of this chunk and the start of the next.
          const keepLen = headerLen - 1;
          if (this.buffer.length > keepLen) {
            this.buffer = this.buffer.subarray(this.buffer.length - keepLen);
          }
          break; // Stop processing this chunk
        } else if (idx > 0) {
          // Header found, but not at index 0. Discard garbage data before it.
          this.buffer = this.buffer.subarray(idx);
        }
        // If idx === 0, the buffer starts with the header. Proceed to extraction.
      }

      // 2. Find Packet Length and Extract
      let matchFound = false;
      let shift = false;

      if (this.defaults.rx_length && this.defaults.rx_length > 0) {
        // Strategy A: Fixed Length
        if (this.buffer.length >= this.defaults.rx_length) {
          // Check Checksum
          if (this.verifyChecksum(this.buffer, this.defaults.rx_length)) {
            const packet = this.buffer.subarray(0, this.defaults.rx_length);
            packets.push([...packet]);
            this.buffer = this.buffer.subarray(this.defaults.rx_length);
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

        if (this.buffer.length >= minLen && this.footerBuffer) {
          const footerLen = this.footerBuffer.length;
          // Footer ends at 'len', so it starts at 'len - footerLen'.
          // 'len' starts at 'minLen', so start search at 'minLen - footerLen'.
          let searchIdx = minLen - footerLen;

          // Optimization: Use indexOf to find footer candidates instead of checking every byte
          while (searchIdx <= this.buffer.length - footerLen) {
            const foundIdx = this.buffer.indexOf(this.footerBuffer, searchIdx);
            if (foundIdx === -1) break;

            const len = foundIdx + footerLen;
            if (this.verifyChecksum(this.buffer, len)) {
              const packet = this.buffer.subarray(0, len);
              packets.push([...packet]);
              this.buffer = this.buffer.subarray(len);
              matchFound = true;
              break;
            }

            // Footer found but checksum failed. Continue searching after this footer.
            searchIdx = foundIdx + 1;
          }
        }
      } else {
        // Strategy C: Checksum Sweep (Variable Length)
        // No fixed length, no footer.
        // Assume valid packet if checksum matches. This is the most expensive strategy.
        const checksumLen = this.getChecksumLength();
        const minLen = headerLen + checksumLen;
        if (checksumLen > 0 && this.buffer.length >= minLen) {
          for (let len = minLen; len <= this.buffer.length; len++) {
            if (this.verifyChecksum(this.buffer, len)) {
              const packet = this.buffer.subarray(0, len);
              packets.push([...packet]);
              this.buffer = this.buffer.subarray(len);
              matchFound = true;
              break;
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
          this.buffer = this.buffer.subarray(1);
          continue;
        }
        // Waiting for more data to reach rx_length
        break;
      } else {
        // Variable length: waiting for more data to find a footer or valid checksum
        break;
      }
    }

    return packets;
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
   * @param buffer - The buffer containing the candidate packet at the start
   * @param length - The length of the candidate packet to verify
   */
  private verifyChecksum(buffer: Buffer, length: number): boolean {
    if (this.defaults.rx_checksum === 'none') return true;

    // 1-byte Checksum
    if (this.defaults.rx_checksum) {
      let checksumByte = buffer[length - 1];
      let dataEnd = length - 1;

      if (this.defaults.rx_footer && this.defaults.rx_footer.length > 0) {
        // If there is a footer, the checksum is usually immediately BEFORE the footer
        checksumByte = buffer[length - 1 - this.defaults.rx_footer.length];
        dataEnd = length - 1 - this.defaults.rx_footer.length;
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
            dataEnd,
          );
          return calculated === checksumByte;
        } else {
          // CEL Expression
          const result = this.celExecutor.execute(checksumOrScript, {
            data: [...buffer.subarray(0, dataEnd)],
            len: dataEnd,
          });
          return result === checksumByte;
        }
      } else if (
        typeof this.defaults.rx_checksum === 'object' &&
        (this.defaults.rx_checksum as any).type === 'custom'
      ) {
        // Custom algorithm handling (placeholder)
        return false;
      }
      return false;
    }

    // 2-byte Checksum
    if (this.defaults.rx_checksum2) {
      const footerLength = this.defaults.rx_footer?.length || 0;
      const headerLength = this.defaults.rx_header?.length || 0;

      // Ensure packet is long enough to contain checksum
      const checksumStart = length - 2 - footerLength;
      if (checksumStart < headerLength) return false;

      if (typeof this.defaults.rx_checksum2 === 'string') {
        const checksumOrScript = this.defaults.rx_checksum2 as string;

        if (this.checksum2Types.has(checksumOrScript)) {
          const calculated = calculateChecksum2FromBuffer(
            buffer,
            checksumOrScript as Checksum2Type,
            headerLength,
            checksumStart,
          );
          return (
            calculated[0] === buffer[checksumStart] && calculated[1] === buffer[checksumStart + 1]
          );
        } else {
          // CEL Expression for 2-byte checksum
          const result = this.celExecutor.execute(checksumOrScript, {
            data: [...buffer.subarray(0, checksumStart)],
            len: checksumStart,
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

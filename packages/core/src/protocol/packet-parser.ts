import { PacketDefaults, ChecksumType, Checksum2Type } from './types.js';
import { calculateChecksumFromBuffer, calculateChecksum2FromBuffer } from './utils/checksum.js';
import { CelExecutor } from './cel-executor.js';
import { Buffer } from 'buffer';

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

  public parse(byte: number): number[] | null {
    const packets = this.parseChunk(Buffer.from([byte]));
    return packets.length > 0 ? packets[0] : null;
  }

  public parseChunk(chunk: Buffer): number[][] {
    const now = Date.now();
    if (this.defaults.rx_timeout && now - this.lastRxTime > this.defaults.rx_timeout) {
      this.buffer = Buffer.alloc(0);
    }
    this.lastRxTime = now;

    this.buffer = Buffer.concat([this.buffer, chunk]);

    const packets: number[][] = [];
    const header = this.defaults.rx_header || [];
    const headerLen = header.length;

    // Safety guard to prevent infinite loops
    let iterations = 0;
    const maxIterations = this.buffer.length + 100;

    while (this.buffer.length > 0) {
      iterations++;
      if (iterations > maxIterations) {
        this.buffer = this.buffer.subarray(1);
        continue;
      }

      // 1. Enforce Header (Sliding Window)
      if (this.headerBuffer && headerLen > 0) {
        if (this.buffer.length < headerLen) break; // Wait for more data

        const idx = this.buffer.indexOf(this.headerBuffer);

        if (idx === -1) {
          // Header not found. Keep potential partial header at the end.
          const keepLen = headerLen - 1;
          if (this.buffer.length > keepLen) {
            this.buffer = this.buffer.subarray(this.buffer.length - keepLen);
          }
          break;
        } else if (idx > 0) {
          // Header found. Discard garbage before it.
          this.buffer = this.buffer.subarray(idx);
        }
        // If idx === 0, proceed.
      }

      // 2. Find Packet Length and Extract
      let matchFound = false;
      let shift = false;

      if (this.defaults.rx_length && this.defaults.rx_length > 0) {
        if (this.buffer.length >= this.defaults.rx_length) {
          // Check Checksum
          if (this.verifyChecksum(this.buffer, this.defaults.rx_length)) {
            const packet = this.buffer.subarray(0, this.defaults.rx_length);
            packets.push([...packet]);
            this.buffer = this.buffer.subarray(this.defaults.rx_length);
            matchFound = true;
          } else {
            shift = true; // Invalid checksum for fixed length -> discard byte
          }
        }
      } else if (this.defaults.rx_footer && this.defaults.rx_footer.length > 0) {
        // Scan for footer that satisfies checksum
        const checksumLen = this.getChecksumLength();
        const minLen = headerLen + 1 + checksumLen + this.defaults.rx_footer.length;

        if (this.buffer.length >= minLen && this.footerBuffer) {
          const footerLen = this.footerBuffer.length;
          // Footer ends at 'len', so it starts at 'len - footerLen'.
          // 'len' starts at 'minLen', so start search at 'minLen - footerLen'.
          let searchIdx = minLen - footerLen;

          // Optimization: Use indexOf to find footer candidates
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
        // No length, no footer.
        // Assume valid packet if checksum matches.
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
          this.buffer = this.buffer.subarray(1);
          continue;
        }
        // Waiting for length
        break;
      } else {
        // Variable length: waiting for footer/data
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

  private verifyChecksum(buffer: Buffer, length: number): boolean {
    if (this.defaults.rx_checksum === 'none') return true;

    // 1-byte
    if (this.defaults.rx_checksum) {
      let checksumByte = buffer[length - 1];
      let dataEnd = length - 1;

      if (this.defaults.rx_footer && this.defaults.rx_footer.length > 0) {
        checksumByte = buffer[length - 1 - this.defaults.rx_footer.length];
        dataEnd = length - 1 - this.defaults.rx_footer.length;
      }

      if (typeof this.defaults.rx_checksum === 'string') {
        const checksumOrScript = this.defaults.rx_checksum as string;

        if (this.checksumTypes.has(checksumOrScript)) {
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
            data: buffer.subarray(0, dataEnd), // Pass Buffer directly to avoid array spread
            len: dataEnd,
          });
          return result === checksumByte;
        }
      } else if (
        typeof this.defaults.rx_checksum === 'object' &&
        (this.defaults.rx_checksum as any).type === 'custom'
      ) {
        // Custom algorithm handling (omitted here as it might be handled externally or not implemented fully yet)
        // Just leaving it as false or basic check if needed.
        return false;
      }
      return false;
    }

    // 2-byte
    if (this.defaults.rx_checksum2) {
      const footerLength = this.defaults.rx_footer?.length || 0;
      const headerLength = this.defaults.rx_header?.length || 0;

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
          // CEL Expression
          const result = this.celExecutor.execute(checksumOrScript, {
            data: buffer.subarray(0, checksumStart), // Pass Buffer directly to avoid array spread
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

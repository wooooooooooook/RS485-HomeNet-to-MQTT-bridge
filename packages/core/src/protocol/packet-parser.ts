import { PacketDefaults, ChecksumType, Checksum2Type, LambdaConfig } from './types.js';
import {
  calculateChecksumFromBuffer,
  calculateChecksum2FromBuffer,
} from './utils/checksum.js';
import { LambdaExecutor } from './lambda-executor.js';
import { Buffer } from 'buffer';

export class PacketParser {
  private buffer: Buffer = Buffer.alloc(0);
  private lastRxTime: number = 0;
  private defaults: PacketDefaults;
  private lambdaExecutor: LambdaExecutor;

  constructor(defaults: PacketDefaults) {
    this.defaults = defaults;
    this.lambdaExecutor = new LambdaExecutor();
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
      if (headerLen > 0) {
        if (this.buffer.length < headerLen) break; // Wait for more data

        let headerMatch = true;
        for (let i = 0; i < headerLen; i++) {
          if (this.buffer[i] !== header[i]) {
            headerMatch = false;
            break;
          }
        }
        if (!headerMatch) {
          this.buffer = this.buffer.subarray(1);
          continue;
        }
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

         if (this.buffer.length >= minLen) {
             const footer = this.defaults.rx_footer;
             // Scan buffer for footer sequence
             for(let len = minLen; len <= this.buffer.length; len++) {
                 // Check if segment [0...len] ends with footer
                 let fMatch = true;
                 for(let f=0; f<footer.length; f++) {
                    if (this.buffer[len - footer.length + f] !== footer[f]) {
                       fMatch = false; break;
                    }
                 }

                 if (fMatch) {
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
      } else {
         // No length, no footer.
         // Assume valid packet if checksum matches.
         const checksumLen = this.getChecksumLength();
         const minLen = headerLen + checksumLen;
         if (checksumLen > 0 && this.buffer.length >= minLen) {
             for(let len = minLen; len <= this.buffer.length; len++) {
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
             const headerLength = this.defaults.rx_header?.length || 0;
             const calculated = calculateChecksumFromBuffer(
                buffer,
                this.defaults.rx_checksum as ChecksumType,
                headerLength,
                dataEnd
             );
             return calculated === checksumByte;
        } else if ((this.defaults.rx_checksum as any).type === 'lambda') {
            const lambda = this.defaults.rx_checksum as LambdaConfig;
            const result = this.lambdaExecutor.execute(lambda, {
               data: [...buffer.subarray(0, dataEnd)],
               len: dataEnd
            });
            return result === checksumByte;
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
          const calculated = calculateChecksum2FromBuffer(
             buffer,
             this.defaults.rx_checksum2 as Checksum2Type,
             headerLength,
             checksumStart
          );
          return calculated[0] === buffer[checksumStart] && calculated[1] === buffer[checksumStart + 1];
       } else if ((this.defaults.rx_checksum2 as any).type === 'lambda') {
        const lambda = this.defaults.rx_checksum2 as LambdaConfig;
        const result = this.lambdaExecutor.execute(lambda, {
          data: [...buffer.subarray(0, checksumStart)],
          len: checksumStart,
        });
        if (Array.isArray(result) && result.length === 2) {
          return result[0] === buffer[checksumStart] && result[1] === buffer[checksumStart + 1];
        }
        return false;
      }
    }

    return true;
  }
}

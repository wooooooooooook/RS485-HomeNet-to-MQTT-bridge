import { PacketDefaults, ChecksumType, Checksum2Type, LambdaConfig } from './types.js';
import {
  calculateChecksum,
  calculateChecksum2,
  calculateChecksumFromBuffer,
  calculateChecksum2FromBuffer,
} from './utils/checksum.js';
import { LambdaExecutor } from './lambda-executor.js';
import { Buffer } from 'buffer';

export class PacketParser {
  private buffer: number[] = [];
  private lastRxTime: number = 0;
  private defaults: PacketDefaults;
  private lambdaExecutor: LambdaExecutor;

  constructor(defaults: PacketDefaults) {
    this.defaults = defaults;
    this.lambdaExecutor = new LambdaExecutor();
  }

  public parse(byte: number): number[] | null {
    const now = Date.now();
    if (this.defaults.rx_timeout && now - this.lastRxTime > this.defaults.rx_timeout) {
      this.buffer = [];
    }
    this.lastRxTime = now;

    this.buffer.push(byte);

    // Check if we have a potential packet
    if (this.isPacketComplete()) {
      const packet = [...this.buffer];
      this.buffer = []; // Reset buffer after successful parse
      return packet;
    }

    // Optional: Implement max buffer size protection
    if (this.buffer.length > 256) {
      this.buffer.shift();
    }

    return null;
  }

  private isPacketComplete(): boolean {
    // 1. Check Header
    if (this.defaults.rx_header && this.defaults.rx_header.length > 0) {
      if (this.buffer.length < this.defaults.rx_header.length) return false;
      for (let i = 0; i < this.defaults.rx_header.length; i++) {
        if (this.buffer[i] !== this.defaults.rx_header[i]) {
          // Invalid header, remove first byte and try again (sliding window)
          this.buffer.shift();
          return this.isPacketComplete();
        }
      }
    }

    // 2. Check Length (if fixed)
    if (this.defaults.rx_length && this.defaults.rx_length > 0) {
      if (this.buffer.length < this.defaults.rx_length) return false;
    }

    // 3. Check Footer
    if (this.defaults.rx_footer && this.defaults.rx_footer.length > 0) {
      // Calculate minimum packet length: header + checksum + footer
      // We need at least 1 byte of data between header and checksum
      const checksumLength = this.defaults.rx_checksum2
        ? 2
        : this.defaults.rx_checksum && this.defaults.rx_checksum !== 'none'
          ? 1
          : 0;
      const minPacketLength =
        (this.defaults.rx_header?.length || 0) +
        1 + // At least 1 byte of data
        checksumLength +
        this.defaults.rx_footer.length;

      // Don't check footer until we have minimum packet length
      if (this.buffer.length < minPacketLength) return false;

      // Now check if footer matches at the end
      if (
        this.buffer.length <
        (this.defaults.rx_header?.length || 0) + this.defaults.rx_footer.length
      )
        return false;
      const footerStart = this.buffer.length - this.defaults.rx_footer.length;
      for (let i = 0; i < this.defaults.rx_footer.length; i++) {
        if (this.buffer[footerStart + i] !== this.defaults.rx_footer[i]) {
          // If we are waiting for a footer and it doesn't match at the end,
          // we just continue buffering UNLESS we have a fixed length,
          // in which case it's a bad packet.
          if (this.defaults.rx_length && this.buffer.length >= this.defaults.rx_length) {
            this.buffer.shift();
            return this.isPacketComplete();
          }
          return false;
        }
      }
    }

    // 4. Check Checksum
    const checksumLength = this.defaults.rx_checksum2
      ? 2
      : this.defaults.rx_checksum && this.defaults.rx_checksum !== 'none'
        ? 1
        : 0;

    if (checksumLength > 0) {
      // Ensure we have at least checksum bytes beyond the header
      const minLength = (this.defaults.rx_header?.length || 0) + checksumLength;
      if (this.buffer.length < minLength) {
        return false;
      }

      // We need to know where the packet ends to verify checksum.
      // If we have a footer, we are good.
      // If we have a fixed length, we are good.
      // If neither, we can't really know when to check unless we assume end of buffer is end of packet.

      // For now, assuming packet is complete if header/footer/length checks passed.
      if (!this.verifyChecksum(this.buffer)) {
        // If checksum fails, and we are not fixed length, maybe we haven't received the full packet yet?
        // But if we matched footer, it SHOULD be the packet.

        const hasFixedLength = this.defaults.rx_length && this.defaults.rx_length > 0;
        const hasFooter = this.defaults.rx_footer && this.defaults.rx_footer.length > 0;

        if (hasFixedLength) {
          // Fixed length with bad checksum - discard and retry
          this.buffer.shift();
          return this.isPacketComplete();
        } else if (hasFooter) {
          // Variable length with footer but bad checksum
          // This could be a false footer match (e.g., checksum byte == footer byte)
          // Continue buffering to see if we get the real footer
          return false;
        } else {
          // Variable length, no footer. Checksum failed.
          // Could be incomplete packet.
          // Don't shift. Just return false (not complete).
          return false;
        }
      }
    }

    return true;
  }

  private verifyChecksum(packet: number[]): boolean {
    // If rx_checksum is 'none', skip this block
    if (this.defaults.rx_checksum === 'none') return true;

    // Check for 1-byte checksum first (more common)
    if (this.defaults.rx_checksum) {
      let calculatedChecksum = 0;
      let checksumByte = packet[packet.length - 1]; // Default assumption: checksum is last byte
      let dataEnd = packet.length - 1;

      // Adjust for footer
      if (this.defaults.rx_footer && this.defaults.rx_footer.length > 0) {
        checksumByte = packet[packet.length - 1 - this.defaults.rx_footer.length];
        dataEnd = packet.length - this.defaults.rx_footer.length - 1;
      }

      if (typeof this.defaults.rx_checksum === 'string') {
        // Use calculateChecksumFromBuffer for string types to avoid slicing
        const headerLength = this.defaults.rx_header?.length || 0;

        calculatedChecksum = calculateChecksumFromBuffer(
          packet,
          this.defaults.rx_checksum as ChecksumType,
          headerLength,
          dataEnd,
        );

        return calculatedChecksum === checksumByte;
      } else if ((this.defaults.rx_checksum as any).type === 'lambda') {
        const lambda = this.defaults.rx_checksum as LambdaConfig;
        // Execute lambda
        // Context: data (array of bytes), len (length)
        // Should return the calculated checksum
        const result = this.lambdaExecutor.execute(lambda, {
          data: packet.slice(0, dataEnd),
          len: dataEnd,
        });

        return result === checksumByte;
      }

      return false;
    }

    // Fall back to 2-byte checksum
    if (this.defaults.rx_checksum2) {
      const footerLength = this.defaults.rx_footer?.length || 0;
      const headerLength = this.defaults.rx_header?.length || 0;

      // Get the 2-byte checksum from the packet
      const checksumStart = packet.length - 2 - footerLength;
      if (checksumStart < headerLength) {
        return false; // Not enough data
      }

      if (typeof this.defaults.rx_checksum2 === 'string') {
        const calculated = calculateChecksum2FromBuffer(
          packet,
          this.defaults.rx_checksum2 as Checksum2Type,
          headerLength,
          checksumStart,
        );
        return calculated[0] === packet[checksumStart] && calculated[1] === packet[checksumStart + 1];
      } else if ((this.defaults.rx_checksum2 as any).type === 'lambda') {
        const lambda = this.defaults.rx_checksum2 as LambdaConfig;
        const result = this.lambdaExecutor.execute(lambda, {
          data: packet.slice(0, checksumStart),
          len: checksumStart,
        });
        // Lambda should return array of 2 bytes
        if (Array.isArray(result) && result.length === 2) {
          return result[0] === packet[checksumStart] && result[1] === packet[checksumStart + 1];
        }
        return false;
      }
      return false;
    }

    // No checksum configured
    return true;
  }
}

import { PacketDefaults, ChecksumType } from './types.js';

export class PacketParser {
    private buffer: number[] = [];
    private lastRxTime: number = 0;
    private defaults: PacketDefaults;

    constructor(defaults: PacketDefaults) {
        this.defaults = defaults;
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
            if (this.buffer.length < (this.defaults.rx_header?.length || 0) + this.defaults.rx_footer.length) return false;
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
        if (this.defaults.rx_checksum && this.defaults.rx_checksum !== 'none') {
            // We need to know where the packet ends to verify checksum.
            // If we have a footer, we are good.
            // If we have a fixed length, we are good.
            // If neither, we can't really know when to check unless we assume end of buffer is end of packet.

            // For now, assuming packet is complete if header/footer/length checks passed.
            if (!this.verifyChecksum(this.buffer)) {
                // If checksum fails, and we are not fixed length, maybe we haven't received the full packet yet?
                // But if we matched footer, it SHOULD be the packet.
                // If checksum fails, it's likely a bad packet or collision.
                // We drop the first byte and retry scanning.
                this.buffer.shift();
                return this.isPacketComplete();
            }
        }

        return true;
    }

    private verifyChecksum(packet: number[]): boolean {
        if (!this.defaults.rx_checksum || this.defaults.rx_checksum === 'none') return true;

        let calculatedChecksum = 0;
        let checksumByte = packet[packet.length - 1]; // Default assumption: checksum is last byte
        let dataEnd = packet.length - 1;

        // Adjust for footer
        if (this.defaults.rx_footer && this.defaults.rx_footer.length > 0) {
            checksumByte = packet[packet.length - 1 - this.defaults.rx_footer.length];
            dataEnd = packet.length - this.defaults.rx_footer.length - 1;
        }

        // Calculate checksum based on type
        // TODO: Implement all checksum types from uartex
        // 'add' | 'xor' | 'add_no_header' | 'xor_no_header' | 'xor_add' | 'samsung_rx' | 'samsung_tx'

        let startIdx = 0;
        if (this.defaults.rx_checksum === 'add_no_header' || this.defaults.rx_checksum === 'xor_no_header') {
            startIdx = this.defaults.rx_header?.length || 0;
        }

        for (let i = startIdx; i < dataEnd; i++) {
            if (this.defaults.rx_checksum === 'add' || this.defaults.rx_checksum === 'add_no_header') {
                calculatedChecksum = (calculatedChecksum + packet[i]) & 0xFF;
            } else if (this.defaults.rx_checksum === 'xor' || this.defaults.rx_checksum === 'xor_no_header') {
                calculatedChecksum = (calculatedChecksum ^ packet[i]) & 0xFF;
            }
            // ... other types
        }

        return calculatedChecksum === checksumByte;
    }
}

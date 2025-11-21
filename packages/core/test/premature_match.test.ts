import { describe, it, expect } from 'vitest';
import { PacketParser } from '../src/protocol/packet-parser.js';
import { PacketDefaults } from '../src/protocol/types.js';

describe('PacketParser Premature Matching', () => {
    it('should NOT match a single byte packet when it is just the header', () => {
        const defaults: PacketDefaults = {
            rx_header: [0xB0],
            rx_checksum: 'samsung_rx',
            rx_timeout: 10
        };

        const parser = new PacketParser(defaults);

        // Feed just the header byte
        const packet = parser.parse(0xB0);

        // Should be null because a packet must contain more than just the header if checksum is involved
        // (or at least we expect it to wait for more data)
        expect(packet).toBeNull();
    });

    it('should match a valid minimal packet', () => {
        const defaults: PacketDefaults = {
            rx_header: [0xB0],
            rx_checksum: 'samsung_rx',
            rx_timeout: 10
        };

        const parser = new PacketParser(defaults);

        // Valid packet: B0 41 00 71 (checksum 71)
        // B0 ^ 41 ^ 00 = F1. 
        // B0 < 7C is false.
        // Wait, samsung_rx:
        // crc = B0
        // crc ^= B0 -> 0
        // crc ^= 41 -> 41
        // crc ^= 00 -> 41
        // data[0] (B0) < 7C is false.
        // Result 41.
        // So checksum should be 41?

        // Let's check the log: b0 41 00 71
        // Maybe my manual calculation is wrong or the log has different checksum.
        // 0xB0 is header.
        // Data part: 41 00.
        // Checksum: 71.

        // samsung_rx implementation:
        // crc = 0xb0
        // for byte of data (41, 00)
        // crc ^= 41 -> F1
        // crc ^= 00 -> F1
        // data[0] (41) < 7C is true.
        // crc ^= 80 -> F1 ^ 80 = 71.
        // Matches!

        expect(parser.parse(0xB0)).toBeNull();
        expect(parser.parse(0x41)).toBeNull();
        expect(parser.parse(0x00)).toBeNull();
        const packet = parser.parse(0x71);

        expect(packet).toEqual([0xB0, 0x41, 0x00, 0x71]);
    });
});

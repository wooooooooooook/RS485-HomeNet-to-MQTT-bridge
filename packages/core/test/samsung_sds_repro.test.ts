import { describe, it, expect } from 'vitest';
import { PacketParser } from '../src/protocol/packet-parser.js';
import { PacketDefaults } from '../src/protocol/types.js';

describe('Samsung SDS Packet Parsing Reproduction', () => {
    it('should parse Samsung SDS packets from the provided hex dump', () => {
        const defaults: PacketDefaults = {
            rx_header: [0xB0],
            rx_checksum: 'samsung_rx',
            rx_timeout: 10 // 10ms
        };

        const parser = new PacketParser(defaults);

        // Hex dump from the issue description (first chunk)
        const hexString = "a15a005a006aa25a0078a35a0079a45a007ea5410064b0410071a6410067b0410071ab41006ab0410170ac79000451b07914015cae7c020000000050b07c02001617ff30c64a0400000000000008b04a040100000000007fcc5a000000006bb6";
        const buffer = Buffer.from(hexString, 'hex');

        const parsedPackets: number[][] = [];

        for (const byte of buffer) {
            const packet = parser.parse(byte);
            if (packet) {
                parsedPackets.push(packet);
            }
        }

        // We expect to find at least one packet starting with B0
        // For example: b0 41 00 71 (if that's a valid packet)
        // Or: b0 79 14 01 5c

        // Currently, we expect this to FAIL (find 0 packets) because 'samsung_rx' is not implemented in PacketParser
        expect(parsedPackets.length).toBeGreaterThan(0);
    });
});

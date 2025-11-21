
import { describe, it, expect } from 'vitest';
import { PacketParser } from '../src/protocol/packet-parser.js';
import { PacketDefaults } from '../src/protocol/types.js';

describe('PacketParser Reproduction', () => {
    it('should parse concatenated packets correctly', () => {
        const defaults: PacketDefaults = {
            rx_length: 8,
            rx_checksum: 'add',
            rx_header: [],
            rx_footer: []
        };

        const parser = new PacketParser(defaults);

        // Packet A: 02 04 00 00 00 00 00 06
        // Packet B: 82 80 04 22 15 00 00 3D

        const packetA = [0x02, 0x04, 0x00, 0x00, 0x00, 0x00, 0x00, 0x06];
        const packetB = [0x82, 0x80, 0x04, 0x22, 0x15, 0x00, 0x00, 0x3D];

        const clumped = [...packetA, ...packetB];

        console.log('Feeding clumped bytes:', clumped.map(b => b.toString(16)).join(' '));

        let packetCount = 0;
        const packets: number[][] = [];

        for (const byte of clumped) {
            const packet = parser.parse(byte);
            if (packet) {
                console.log('Parsed packet:', packet.map(b => b.toString(16)).join(' '));
                packets.push(packet);
                packetCount++;
            }
        }

        expect(packetCount).toBe(2);
        expect(packets[0]).toEqual(packetA);
        expect(packets[1]).toEqual(packetB);
    });
});

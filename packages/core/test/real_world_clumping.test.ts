import { describe, it, expect } from 'vitest';
import { PacketParser } from '../src/protocol/packet-parser.js';
import { PacketDefaults } from '../src/protocol/types.js';

describe('Real World Packet Clumping', () => {
    it('should handle all user-reported packet sequences', () => {
        const defaults: PacketDefaults = {
            rx_length: 8,
            rx_checksum: 'add',
            rx_header: [],
            rx_footer: []
        };

        const parser = new PacketParser(defaults);

        // 사용자가 보고한 실제 순서대로 (타임스탬프 역순)
        const sequences = [
            // [오후 1:34:36] - 뭉쳐진 패킷들
            [0x02, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x03, 0x82, 0x81, 0x01, 0x24, 0x15, 0x00, 0x00, 0x3D, 0x02, 0x02, 0x00, 0x00, 0x00, 0x00, 0x00, 0x04],
            // [오후 1:34:36]
            [0x82, 0x81, 0x02, 0x24, 0x15, 0x00, 0x00, 0x3E, 0x02, 0x03, 0x00, 0x00, 0x00, 0x00, 0x00, 0x05],
            // [오후 1:34:36]
            [0x82, 0x80, 0x03, 0x23, 0x20, 0x00, 0x00, 0x48, 0x02, 0x04, 0x00, 0x00, 0x00, 0x00, 0x00, 0x06],
            // [오후 1:34:37] - 단독 패킷
            [0x82, 0x80, 0x04, 0x22, 0x15, 0x00, 0x00, 0x3D],
        ];

        let totalPackets = 0;
        const parsedPackets: number[][] = [];

        for (const sequence of sequences) {
            console.log(`\nProcessing sequence: ${sequence.map(b => b.toString(16).padStart(2, '0')).join(' ')}`);
            for (const byte of sequence) {
                const packet = parser.parse(byte);
                if (packet) {
                    console.log(`  Parsed: ${packet.map(b => b.toString(16).padStart(2, '0')).join(' ')}`);
                    parsedPackets.push(packet);
                    totalPackets++;
                }
            }
        }

        console.log(`\nTotal packets parsed: ${totalPackets}`);

        // 예상: 3개 시퀀스에서 각각 2개씩 + 마지막 1개 = 7개
        expect(totalPackets).toBe(7);
    });

    it('should handle the specific missing packet case', () => {
        const defaults: PacketDefaults = {
            rx_length: 8,
            rx_checksum: 'add',
            rx_header: [],
            rx_footer: []
        };

        const parser = new PacketParser(defaults);

        // 사용자가 언급한 "해석했어야 하는데 안하고 지나간" 패킷
        const missingPacket = [0x82, 0x80, 0x04, 0x22, 0x15, 0x00, 0x00, 0x3D];

        console.log(`\nTesting missing packet: ${missingPacket.map(b => b.toString(16).padStart(2, '0')).join(' ')}`);

        let parsed = false;
        for (const byte of missingPacket) {
            const packet = parser.parse(byte);
            if (packet) {
                console.log(`  Parsed: ${packet.map(b => b.toString(16).padStart(2, '0')).join(' ')}`);
                parsed = true;
                expect(packet).toEqual(missingPacket);
            }
        }

        expect(parsed).toBe(true);
    });
});

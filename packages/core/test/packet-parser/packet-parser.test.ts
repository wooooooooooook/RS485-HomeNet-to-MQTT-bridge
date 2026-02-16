import { describe, it, expect } from 'vitest';
import { PacketParser } from '../../src/protocol/packet-parser';
import { PacketDefaults } from '../../src/protocol/types';

describe('PacketParser Comprehensive Tests', () => {
  describe('Buffer Logic', () => {
    const defaults: PacketDefaults = {
      rx_header: [0x02],
      rx_checksum: 'add',
      rx_footer: [0x03],
    };

    it('should handle fragmentation (packet split across chunks)', () => {
      const parser = new PacketParser(defaults);
      const part1 = Buffer.from([0x02, 0x10]);
      const part2 = Buffer.from([0x12, 0x03]); // Checksum: 0x02+0x10 = 0x12

      const result1 = parser.parseChunk(part1);
      expect(result1).toHaveLength(0);

      const result2 = parser.parseChunk(part2);
      expect(result2).toHaveLength(1);
      expect(result2[0]).toEqual(Buffer.concat([part1, part2]));
    });

    it('should handle coalescing (multiple packets in one chunk)', () => {
      const parser = new PacketParser(defaults);
      const packet1 = Buffer.from([0x02, 0x10, 0x12, 0x03]);
      const packet2 = Buffer.from([0x02, 0x20, 0x22, 0x03]);

      const result = parser.parseChunk(Buffer.concat([packet1, packet2]));
      expect(result).toHaveLength(2);
      expect(result[0]).toEqual(packet1);
      expect(result[1]).toEqual(packet2);
    });

    it('should handle garbage data (noise before valid packet)', () => {
      const parser = new PacketParser(defaults);
      const garbage = Buffer.from([0xFF, 0xEE, 0xDD]);
      const packet = Buffer.from([0x02, 0x10, 0x12, 0x03]);

      const result = parser.parseChunk(Buffer.concat([garbage, packet]));
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual(packet);
    });

    it('should handle rx_timeout (reset buffer after inactivity)', async () => {
      const parser = new PacketParser({ ...defaults, rx_timeout: 10 });
      const part1 = Buffer.from([0x02, 0x10]);

      parser.parseChunk(part1);

      // Wait for timeout
      await new Promise(resolve => setTimeout(resolve, 20));

      const part2 = Buffer.from([0x12, 0x03]);
      // Should have reset, so part2 is treated as new data.
      // Since part2 alone is not a valid packet (starts with 0x12, expected 0x02), it returns nothing.
      const result = parser.parseChunk(part2);
      expect(result).toHaveLength(0);
    });
  });

  describe('Parsing Strategies', () => {
    describe('Fixed Length', () => {
      const defaults: PacketDefaults = {
        rx_header: [0xAA],
        rx_length: 4,
        rx_checksum: 'add',
      };

      it('should parse valid fixed length packets', () => {
        const parser = new PacketParser(defaults);
        const packet = Buffer.from([0xAA, 0x01, 0x02, 0xAD]); // AA+01+02 = AD
        const result = parser.parseChunk(packet);
        expect(result).toHaveLength(1);
        expect(result[0]).toEqual(packet);
      });

      it('should reject invalid checksum and resync', () => {
        const parser = new PacketParser(defaults);
        // Invalid packet (checksum mismatch) + Valid packet
        const invalid = Buffer.from([0xAA, 0x01, 0x02, 0x00]);
        const valid = Buffer.from([0xAA, 0x02, 0x03, 0xAF]); // AA+02+03 = AF

        const result = parser.parseChunk(Buffer.concat([invalid, valid]));
        expect(result).toHaveLength(1);
        expect(result[0]).toEqual(valid);
      });
    });

    describe('Footer Delimited', () => {
      const defaults: PacketDefaults = {
        rx_header: [0x55],
        rx_footer: [0xEE],
        rx_checksum: 'xor',
      };

      it('should parse valid footer delimited packets', () => {
        const parser = new PacketParser(defaults);
        // 55 ^ 01 ^ 02 = 56
        const packet = Buffer.from([0x55, 0x01, 0x02, 0x56, 0xEE]);
        const result = parser.parseChunk(packet);
        expect(result).toHaveLength(1);
        expect(result[0]).toEqual(packet);
      });

      it('should handle false footer inside data', () => {
        const parser = new PacketParser(defaults);
        // Data contains 0xEE (footer byte)
        // 55 ^ EE ^ 02 = B9 (0x55 ^ 0xEE = 0xBB ^ 0x02 = 0xB9)
        const packet = Buffer.from([0x55, 0xEE, 0x02, 0xB9, 0xEE]);
        const result = parser.parseChunk(packet);
        expect(result).toHaveLength(1);
        expect(result[0]).toEqual(packet);
      });
    });

    describe('Checksum Sweep (Variable Length)', () => {
      const defaults: PacketDefaults = {
        rx_header: [0xF0],
        rx_checksum: 'add',
        rx_min_length: 3,
        rx_max_length: 10,
      };

      it('should parse variable length packets by checksum scan', () => {
        const parser = new PacketParser(defaults);
        // F0 + 01 = F1 (len 3)
        const packet1 = Buffer.from([0xF0, 0x01, 0xF1]);
        // F0 + 01 + 02 = F3 (len 4)
        const packet2 = Buffer.from([0xF0, 0x01, 0x02, 0xF3]);

        const result = parser.parseChunk(Buffer.concat([packet1, packet2]));
        expect(result).toHaveLength(2);
        expect(result[0]).toEqual(packet1);
        expect(result[1]).toEqual(packet2);
      });
    });
  });

  describe('Checksum Types', () => {
    it('should support "xor" checksum', () => {
      const defaults: PacketDefaults = {
        rx_header: [0x10],
        rx_length: 3,
        rx_checksum: 'xor',
      };
      const parser = new PacketParser(defaults);
      // 10 ^ 01 = 11
      const packet = Buffer.from([0x10, 0x01, 0x11]);
      const result = parser.parseChunk(packet);
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual(packet);
    });

    it('should support "samsung_rx" checksum', () => {
      const defaults: PacketDefaults = {
        rx_header: [0xAA],
        rx_length: 3,
        rx_checksum: 'samsung_rx',
      };
      const parser = new PacketParser(defaults);

      // Byte 0: Header 0xAA (Skipped by samsung_rx)
      // Byte 1: Data 0x10
      // Initial 0xB0
      // 0xB0 ^ 0x10 = 0xA0
      // Data 0x10 < 0x7C, so ^= 0x80
      // 0xA0 ^ 0x80 = 0x20

      const packet = Buffer.from([0xAA, 0x10, 0x20]);
      const result = parser.parseChunk(packet);
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual(packet);
    });

    it('should support "xor_add" (2-byte) checksum', () => {
     // xor_add: [XOR_SUM, (ADD_SUM + XOR_SUM) & 0xFF]
     // Bytes: 55, 01, 02
     // Add Sum: 55 + 01 + 02 = 58 (0x58)
     // XOR Sum: 55 ^ 01 ^ 02 = 56 (0x56)
     // High = 0x56
     // Low = (0x58 + 0x56) & 0xFF = 0xAE

     const defaults: PacketDefaults = {
       rx_header: [0x55],
       rx_length: 5, // Header + 2 Data + 2 Checksum
       rx_checksum2: 'xor_add',
     };
     const parser = new PacketParser(defaults);

     const packet = Buffer.from([0x55, 0x01, 0x02, 0x56, 0xAE]);
     const result = parser.parseChunk(packet);
     expect(result).toHaveLength(1);
     expect(result[0]).toEqual(packet);
    });
  });
});

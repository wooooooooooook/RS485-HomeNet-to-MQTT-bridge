import { describe, it, expect } from 'vitest';
import {
  calculateChecksum,
  calculateChecksumFromBuffer,
  getChecksumFunction,
  getChecksumOffsetType,
  STANDARD_CHECKSUM_TYPES,
} from '../../src/protocol/utils/checksum.js';
import { PacketParser } from '../../src/protocol/packet-parser.js';

describe('Parameterized Final Checksums (8 variants x 256)', () => {
  const header = [0x10, 0x02];
  const data = [0x01, 0x02, 0x03];

  // header sum = 0x12, data sum = 0x06, total sum = 0x18
  // header xor = 0x12, data xor = 0x00, total xor = 0x12

  describe('1. add_final_xor', () => {
    it('calculates (sum(header + data) & 0xff) ^ finalVal', () => {
      // 0x18 ^ 0x55 = 0x4D
      expect(calculateChecksum(header, data, 'add_final_xor(0x55)')).toBe(0x4d);
      expect(getChecksumOffsetType('add_final_xor(0x55)')).toBe('base');
    });

    it('calculates (sum(data) & 0xff) ^ finalVal when no_header', () => {
      // 0x06 ^ 0x55 = 0x53
      expect(calculateChecksum(header, data, 'add_final_xor_no_header(0x55)')).toBe(0x53);
      expect(getChecksumOffsetType('add_final_xor_no_header(0x55)')).toBe('header');
    });
  });

  describe('2. add_final_add', () => {
    it('calculates (sum(header + data) + finalVal) & 0xff', () => {
      // (0x18 + 0x05) & 0xff = 0x1D
      expect(calculateChecksum(header, data, 'add_final_add(0x05)')).toBe(0x1d);
      expect(getChecksumOffsetType('add_final_add(0x05)')).toBe('base');
    });

    it('calculates (sum(data) + finalVal) & 0xff when no_header', () => {
      // (0x06 + 0x05) & 0xff = 0x0B
      expect(calculateChecksum(header, data, 'add_final_add_no_header(0x05)')).toBe(0x0b);
      expect(getChecksumOffsetType('add_final_add_no_header(0x05)')).toBe('header');
    });
  });

  describe('3. xor_final_xor (and legacy xor_final)', () => {
    it('calculates (xor(header + data)) ^ finalVal', () => {
      // 0x12 ^ 0x55 = 0x47
      expect(calculateChecksum(header, data, 'xor_final_xor(0x55)')).toBe(0x47);
      expect(calculateChecksum(header, data, 'xor_final(0x55)')).toBe(0x47);
    });

    it('calculates (xor(data)) ^ finalVal when no_header', () => {
      // 0x00 ^ 0x55 = 0x55
      expect(calculateChecksum(header, data, 'xor_final_xor_no_header(0x55)')).toBe(0x55);
      expect(calculateChecksum(header, data, 'xor_final_no_header(0x55)')).toBe(0x55);
    });
  });

  describe('4. xor_final_add', () => {
    it('calculates (xor(header + data) + finalVal) & 0xff', () => {
      // (0x12 + 0x0A) & 0xff = 0x1C
      expect(calculateChecksum(header, data, 'xor_final_add(0x0a)')).toBe(0x1c);
      expect(getChecksumOffsetType('xor_final_add(0x0a)')).toBe('base');
    });

    it('calculates (xor(data) + finalVal) & 0xff when no_header', () => {
      // (0x00 + 0x0A) & 0xff = 0x0A
      expect(calculateChecksum(header, data, 'xor_final_add_no_header(0x0a)')).toBe(0x0a);
      expect(getChecksumOffsetType('xor_final_add_no_header(0x0a)')).toBe('header');
    });
  });

  describe('Optimized checksum function retrieval', () => {
    it('retrieves pre-compiled closures for all 8 variants', () => {
      const buffer = Buffer.from([0x10, 0x02, 0x01, 0x02, 0x03, 0x00]);
      const fnAddXor = getChecksumFunction('add_final_xor(0x55)');
      expect(fnAddXor).not.toBeNull();
      expect(fnAddXor!(buffer, 0, 5)).toBe(0x4d);

      const fnAddAdd = getChecksumFunction('add_final_add(0x05)');
      expect(fnAddAdd).not.toBeNull();
      expect(fnAddAdd!(buffer, 0, 5)).toBe(0x1d);

      const fnXorXor = getChecksumFunction('xor_final_xor(0x55)');
      expect(fnXorXor).not.toBeNull();
      expect(fnXorXor!(buffer, 0, 5)).toBe(0x47);

      const fnXorAdd = getChecksumFunction('xor_final_add(0x0a)');
      expect(fnXorAdd).not.toBeNull();
      expect(fnXorAdd!(buffer, 0, 5)).toBe(0x1c);
    });
  });

  describe('Real LGAP 20-packet verification with add_final_xor(0x55)', () => {
    const realLgapPackets = [
      '1002a3000000520c64666628001824f2',
      '1002a30001001a0b656566280007240b',
      '1002a30001001a0b6666662800072435',
      '1002a3000000520c63666628001824f3',
      '1002a30001001a0b656666280007240a',
      '1002a30001001a0b666566280007240a',
      '1002a30001001a0b656666280007240a',
      '1002a30002005a0b61626228000524c7',
      '1002a30001001a0b6666662800072435',
      '1002a30001001a0b656666280007240a',
      '1002a30001001a0b6666662800072435',
      '1002a30001001a0b656566280007240b',
      '1002a30001001a0b6666662800072435',
      '1002a30001001a0b656666280007240a',
      '1002a30001001a0b666566280007240a',
      '1002a30001001a0b656666280007240a',
      '1002a30001001a0b6666662800072435',
      '1002a30001001a0b656666280007240a',
      '1002a30001001a0b666566280007240a',
      '1002a30001001a0b656666280007240a',
    ];

    it('validates every packet checksum using calculateChecksum and calculateChecksumFromBuffer', () => {
      for (const hexStr of realLgapPackets) {
        const buf = Buffer.from(hexStr, 'hex');
        const expectedChecksum = buf[buf.length - 1];
        const headerBytes = [buf[0]];
        const dataBytes = Array.from(buf.subarray(1, buf.length - 1));

        const cs1 = calculateChecksum(headerBytes, dataBytes, 'add_final_xor(0x55)');
        expect(cs1).toBe(expectedChecksum);

        const csBuffer = calculateChecksumFromBuffer(buf, 'add_final_xor(0x55)', 1, buf.length - 1);
        expect(csBuffer).toBe(expectedChecksum);
      }
    });

    it('parses real LGAP streams with PacketParser (sliding window & fixed length)', () => {
      const parser = new PacketParser({
        rx_header: [0x10],
        rx_length: 16,
        rx_checksum: 'add_final_xor(0x55)',
      });

      // Feed packets with noise in between
      const noise = Buffer.from([0xff, 0x00, 0x10, 0xaa]);
      for (const hexStr of realLgapPackets) {
        const packetBuf = Buffer.from(hexStr, 'hex');
        const chunk = Buffer.concat([noise, packetBuf]);
        const parsed = parser.parseChunk(chunk);
        expect(parsed.length).toBe(1);
        expect(parsed[0].toString('hex')).toBe(hexStr);
      }
    });
  });

  describe('Samsung SDS checksum equivalences', () => {
    it('samsung_tx is equivalent to xor_final_xor_no_header(0x80)', () => {
      const testData = [0x79, 0x21, 0x01];
      const csSamsungTx = calculateChecksum([], testData, 'samsung_tx');
      const csXorFinal = calculateChecksum([], testData, 'xor_final_xor_no_header(0x80)');
      expect(csSamsungTx).toBe(csXorFinal);
    });
  });

  describe('Full STANDARD_CHECKSUM_TYPES Parameterized Round-Trip Tests', () => {
    const parameterizedTypes = STANDARD_CHECKSUM_TYPES.filter(
      (type) => typeof type === 'string' && type.includes('_final'),
    );

    it('contains all 2,560 parameterized checksum types (8 variants + 2 legacy x 256)', () => {
      expect(parameterizedTypes.length).toBe(2560);
    });

    it('performs round-trip PacketParser parsing across all parameterized checksum types (Fixed Length Strategy A)', () => {
      const header = [0xaa, 0x55];
      const payload = [0x12, 0x34, 0x56, 0x78];

      for (const type of parameterizedTypes) {
        const checksum = calculateChecksum(header, payload, type);
        const fullPacket = Buffer.from([...header, ...payload, checksum]);

        const parser = new PacketParser({
          rx_header: [0xaa, 0x55],
          rx_length: fullPacket.length,
          rx_checksum: type,
        });

        // Add prefix noise to verify sliding window resynchronization
        const stream = Buffer.concat([Buffer.from([0x00, 0x11, 0x22]), fullPacket]);
        const parsed = parser.parseChunk(stream);

        expect(parsed.length).toBe(1);
        expect(Buffer.compare(parsed[0], fullPacket)).toBe(0);
      }
    });

    it('performs round-trip PacketParser parsing across all parameterized checksum types (Footer Strategy B)', () => {
      const header = [0xaa];
      const payload = [0x10, 0x20, 0x30];
      const footer = [0x0d, 0x0a];

      for (const type of parameterizedTypes) {
        const checksum = calculateChecksum(header, payload, type);
        const fullPacket = Buffer.from([...header, ...payload, checksum, ...footer]);

        const parser = new PacketParser({
          rx_header: [0xaa],
          rx_footer: [0x0d, 0x0a],
          rx_checksum: type,
          rx_min_length: fullPacket.length,
        });

        const stream = Buffer.concat([Buffer.from([0x00, 0x11, 0x22]), fullPacket]);
        const parsed = parser.parseChunk(stream);

        expect(parsed.length).toBe(1);
        expect(Buffer.compare(parsed[0], fullPacket)).toBe(0);
      }
    });

    it('performs round-trip PacketParser parsing across all parameterized checksum types (Sweep Strategy C)', () => {
      const header = [0x02];
      const payload = [0x11, 0x22, 0x33, 0x44];

      for (const type of parameterizedTypes) {
        const checksum = calculateChecksum(header, payload, type);
        const fullPacket = Buffer.from([...header, ...payload, checksum]);

        const parser = new PacketParser({
          rx_header: [0x02],
          rx_min_length: fullPacket.length,
          rx_max_length: fullPacket.length + 4,
          rx_checksum: type,
        });

        const stream = Buffer.concat([Buffer.from([0x00, 0x11]), fullPacket]);
        const parsed = parser.parseChunk(stream);

        expect(parsed.length).toBe(1);
        expect(Buffer.compare(parsed[0], fullPacket)).toBe(0);
      }
    });
  });
});

import { describe, it, expect } from 'vitest';
import {
  calculateChecksum,
  calculateChecksumFromBuffer,
  getChecksumFunction,
  getChecksum2Verifier,
  getChecksumOffsetType,
  verifyXorAddRange,
} from '../../src/protocol/utils/checksum';

describe('Checksum Utils', () => {
  describe('getChecksumFunction', () => {
    it('should return the correct function for each type', () => {
      expect(getChecksumFunction('add')).toBeDefined();
      expect(getChecksumFunction('add_no_header')).toBeDefined();
      expect(getChecksumFunction('xor')).toBeDefined();
      expect(getChecksumFunction('xor_no_header')).toBeDefined();
      expect(getChecksumFunction('samsung_rx')).toBeDefined();
      expect(getChecksumFunction('samsung_tx')).toBeDefined();
      expect(getChecksumFunction('samsung_xor')).toBeDefined();
      expect(getChecksumFunction('bestin_sum')).toBeDefined();
    });

    it('should support parameterized xor_final()', () => {
      const fn = getChecksumFunction('xor_final(0x55)' as any);
      expect(fn).toBeDefined();
      expect(fn!([0x01, 0x02, 0x03], 0, 3)).toBe((0x01 ^ 0x02 ^ 0x03) ^ 0x55);
    });

    it('should support all byte-sized xor_final values', () => {
      expect(getChecksumFunction('xor_final(0x00)' as any)).toBeDefined();
      expect(getChecksumFunction('xor_final(0xff)' as any)).toBeDefined();
      expect(getChecksumFunction('xor_final(0x100)' as any)).toBeNull();
      expect(getChecksumFunction('xor_final(0x5)' as any)).toBeNull();
    });

    it('should return null for "none"', () => {
      expect(getChecksumFunction('none')).toBeNull();
    });

    it('should return null for unknown types', () => {
      expect(getChecksumFunction('unknown' as any)).toBeNull();
    });

    it('should return functions that work correctly', () => {
      const addFn = getChecksumFunction('add')!;
      expect(addFn([1, 2, 3], 0, 3)).toBe(6);

      const xorFn = getChecksumFunction('xor')!;
      expect(xorFn([1, 2, 3], 0, 3)).toBe(0);
    });
  });

  describe('calculateChecksum', () => {
    it('should apply xor_final to the entire frame including the header', () => {
      const header = [0xaa, 0x55];
      const data = [0x10, 0x20, 0x30];
      const expected = 0xaa ^ 0x55 ^ 0x10 ^ 0x20 ^ 0x30 ^ 0x55;
      expect(calculateChecksum(header, data, 'xor_final(0x55)' as any)).toBe(expected);
    });

    it('should apply xor_final to a buffer range', () => {
      const frame = [0xaa, 0x10, 0x20, 0x30, 0x00];
      const expected = 0xaa ^ 0x10 ^ 0x20 ^ 0x30 ^ 0x55;
      expect(calculateChecksumFromBuffer(frame, 'xor_final(0x55)' as any, 1, 4)).toBe(expected);
    });
  });

  describe('getChecksum2Verifier', () => {
    it('should return the correct verifier for "xor_add"', () => {
      expect(getChecksum2Verifier('xor_add')).toBe(verifyXorAddRange);
    });

    it('should return a function for "crc_ccitt_xmodem"', () => {
      expect(getChecksum2Verifier('crc_ccitt_xmodem')).toBeDefined();
    });

    it('should return null for unknown types', () => {
      expect(getChecksum2Verifier('unknown' as any)).toBeNull();
    });
  });

  describe('getChecksumOffsetType', () => {
    it('should return "header" for types that exclude header', () => {
      expect(getChecksumOffsetType('add_no_header')).toBe('header');
      expect(getChecksumOffsetType('xor_no_header')).toBe('header');
      expect(getChecksumOffsetType('samsung_rx')).toBe('header');
      expect(getChecksumOffsetType('samsung_tx')).toBe('header');
    });

    it('should return "base" for other types', () => {
      expect(getChecksumOffsetType('add')).toBe('base');
      expect(getChecksumOffsetType('xor')).toBe('base');
      expect(getChecksumOffsetType('xor_final(0x55)' as any)).toBe('base');
      expect(getChecksumOffsetType('samsung_xor')).toBe('base');
      expect(getChecksumOffsetType('bestin_sum')).toBe('base');
      expect(getChecksumOffsetType('none')).toBe('base');
    });
  });
});

import { describe, it, expect } from 'vitest';
import { hexToBytes, bytesToHex } from '../../src/protocol/utils/common';

describe('Common Utils', () => {
  describe('hexToBytes', () => {
    it('should convert valid hex string to byte array', () => {
      expect(hexToBytes('0A0B')).toEqual([10, 11]);
      expect(hexToBytes('FF00')).toEqual([255, 0]);
    });

    it('should handle empty string', () => {
      expect(hexToBytes('')).toEqual([]);
    });

    it('should be case insensitive', () => {
      expect(hexToBytes('0a0b')).toEqual([10, 11]);
      expect(hexToBytes('ff00')).toEqual([255, 0]);
    });
  });

  describe('bytesToHex', () => {
    it('should convert byte array to hex string', () => {
      expect(bytesToHex([10, 11])).toBe('0a0b');
      expect(bytesToHex([255, 0])).toBe('ff00');
    });

    it('should handle empty array', () => {
      expect(bytesToHex([])).toBe('');
    });
  });
});

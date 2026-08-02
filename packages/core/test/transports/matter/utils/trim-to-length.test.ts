import { describe, it, expect } from 'vitest';
import { trimToLength } from '../../../../src/transports/matter/utils/trim-to-length.js';

describe('trimToLength', () => {
  it('should return undefined if input is undefined or null', () => {
    expect(trimToLength(undefined, 10)).toBeUndefined();
    expect(trimToLength(null, 10)).toBeUndefined();
  });

  it('should return original string if byte length is less than or equal to maxLengthBytes', () => {
    expect(trimToLength('hello', 10)).toBe('hello');
    expect(trimToLength('world', 5)).toBe('world');
  });

  it('should handle empty strings', () => {
    expect(trimToLength('', 5)).toBe('');
  });

  it('should truncate strings to the maximum byte length', () => {
    expect(trimToLength('hello world', 5)).toBe('hello');
    expect(trimToLength('matter over rs485', 6)).toBe('matter');
  });

  it('should truncate strings containing multi-byte characters correctly', () => {
    // "안녕" is 6 bytes (3 bytes per character in UTF-8)
    expect(trimToLength('안녕', 6)).toBe('안녕');
    expect(trimToLength('안녕하세요', 6)).toBe('안녕');
  });

  it('should not include partial multi-byte characters when truncating', () => {
    // "안" (3 bytes) + "녕" (3 bytes)
    // Truncating to 5 bytes would split the second character.
    // The decoder will drop the partial byte, so it should return just "안"
    expect(trimToLength('안녕', 5)).toBe('안');
    expect(trimToLength('안녕', 4)).toBe('안');
    expect(trimToLength('안녕', 3)).toBe('안');
  });

  it('should correctly handle emojis', () => {
    // "👋" is 4 bytes
    expect(trimToLength('👋', 4)).toBe('👋');
    expect(trimToLength('👋👋', 6)).toBe('👋');
    expect(trimToLength('👋👋', 8)).toBe('👋👋');
  });
});

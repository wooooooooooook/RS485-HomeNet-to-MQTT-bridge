import { describe, it, expect } from 'vitest';
import { Buffer } from 'buffer';
import { extractFromSchema } from '../../src/protocol/schema-utils.js';

describe('extractFromSchema', () => {
  it('should extract 1-byte unsigned integer (default)', () => {
    const packet = Buffer.from([0x00, 0x01, 0x02, 0x03]);
    const schema = { offset: 1 };
    expect(extractFromSchema(packet, schema)).toBe(1);
  });

  it('should extract multi-byte big-endian unsigned integer', () => {
    const packet = Buffer.from([0x00, 0x01, 0x02, 0x03]);
    const schema = { offset: 1, length: 2, endian: 'big' as const };
    // 0x0102 = 1 * 256 + 2 = 258
    expect(extractFromSchema(packet, schema)).toBe(258);
  });

  it('should extract multi-byte little-endian unsigned integer', () => {
    const packet = Buffer.from([0x00, 0x01, 0x02, 0x03]);
    const schema = { offset: 1, length: 2, endian: 'little' as const };
    // 0x01, 0x02 -> 0x0201 = 2 * 256 + 1 = 513
    expect(extractFromSchema(packet, schema)).toBe(513);
  });

  it('should return null if out of bounds', () => {
    const packet = Buffer.from([0x00, 0x01]);
    const schema = { offset: 1, length: 2 };
    expect(extractFromSchema(packet, schema)).toBeNull();
  });

  describe('Data Matching', () => {
    it('should match data exactly and return full data length value', () => {
      const packet = Buffer.from([0xAA, 0xBB, 0xCC]);
      const schema = { offset: 0, data: [0xAA, 0xBB] };
      // length defaults to data.length = 2
      expect(extractFromSchema(packet, schema)).toBe(0xAABB);
    });

    it('should match data but return specified length', () => {
      const packet = Buffer.from([0xAA, 0xBB, 0xCC]);
      const schema = { offset: 0, data: [0xAA, 0xBB], length: 1 };
      expect(extractFromSchema(packet, schema)).toBe(0xAA);
    });

    it('should return null on mismatching data', () => {
      const packet = Buffer.from([0xAA, 0xBB, 0xCC]);
      const schema = { offset: 0, data: [0xAA, 0x00] };
      expect(extractFromSchema(packet, schema)).toBeNull();
    });

    it('should match with mask and return masked value', () => {
      const packet = Buffer.from([0xAF, 0xBB]);
      const schema = { offset: 0, data: [0xA0], mask: 0xF0 };
      // 0xAF & 0xF0 = 0xA0
      expect(extractFromSchema(packet, schema)).toBe(0xA0);
    });

    it('should match with array mask and return masked values', () => {
      const packet = Buffer.from([0xAF, 0xBF]);
      const schema = { offset: 0, data: [0xA0, 0xB0], mask: [0xF0, 0xF0] };
      // 0xAF & 0xF0 = 0xA0, 0xBF & 0xF0 = 0xB0 -> 0xA0B0
      expect(extractFromSchema(packet, schema)).toBe(0xA0B0);
    });
  });

  describe('Decoding Strategies', () => {
    it('should decode BCD', () => {
      const packet = Buffer.from([0x12, 0x34]);
      const schema = { offset: 0, length: 2, decode: 'bcd' as const };
      // 0x12 0x34 -> 1234
      expect(extractFromSchema(packet, schema)).toBe(1234);
    });

    it('should decode BCD with little endian', () => {
        const packet = Buffer.from([0x34, 0x12]);
        const schema = { offset: 0, length: 2, decode: 'bcd' as const, endian: 'little' as const };
        // 0x34 0x12 -> 0x12 0x34 -> 1234
        expect(extractFromSchema(packet, schema)).toBe(1234);
      });

    it('should decode ASCII', () => {
      const packet = Buffer.from([0x48, 0x65, 0x6C, 0x6C, 0x6F]); // "Hello"
      const schema = { offset: 0, length: 5, decode: 'ascii' as const };
      expect(extractFromSchema(packet, schema)).toBe('Hello');
    });

    it('should decode ASCII with mask and inversion', () => {
        const packet = Buffer.from([0x48 ^ 0xFF, 0x65 ^ 0xFF]);
        const schema = { offset: 0, length: 2, decode: 'ascii' as const, inverted: true };
        expect(extractFromSchema(packet, schema)).toBe('He');
    });

    it('should decode signed_byte_half_degree (positive)', () => {
      // 0x14 = 20 -> 20.0
      const packet = Buffer.from([0x14]);
      const schema = { offset: 0, decode: 'signed_byte_half_degree' as const };
      expect(extractFromSchema(packet, schema)).toBe(20.0);
    });

    it('should decode signed_byte_half_degree (positive + 0.5)', () => {
        // 0x94 = 0x80 | 0x14 -> 20.5
        const packet = Buffer.from([0x94]);
        const schema = { offset: 0, decode: 'signed_byte_half_degree' as const };
        expect(extractFromSchema(packet, schema)).toBe(20.5);
      });

    it('should decode signed_byte_half_degree (negative)', () => {
      // 0x40 is sign bit in this specific decoder
      // 0x54 = 0x40 | 0x14 -> -20.0
      const packet = Buffer.from([0x54]);
      const schema = { offset: 0, decode: 'signed_byte_half_degree' as const, signed: true };
      expect(extractFromSchema(packet, schema)).toBe(-20.0);
    });

    it('should decode signed_byte_half_degree (negative + 0.5)', () => {
        // 0xD4 = 0x80 | 0x40 | 0x14 -> -20.5
        const packet = Buffer.from([0xD4]);
        const schema = { offset: 0, decode: 'signed_byte_half_degree' as const, signed: true };
        expect(extractFromSchema(packet, schema)).toBe(-20.5);
      });
  });

  describe('Signed Integers (Two\'s Complement)', () => {
    it('should handle 1-byte signed integer (positive)', () => {
      const packet = Buffer.from([0x7F]);
      const schema = { offset: 0, length: 1, signed: true };
      expect(extractFromSchema(packet, schema)).toBe(127);
    });

    it('should handle 1-byte signed integer (negative)', () => {
      const packet = Buffer.from([0xFF]);
      const schema = { offset: 0, length: 1, signed: true };
      expect(extractFromSchema(packet, schema)).toBe(-1);
    });

    it('should handle 2-byte signed integer (negative)', () => {
      const packet = Buffer.from([0xFF, 0xFE]);
      const schema = { offset: 0, length: 2, signed: true };
      expect(extractFromSchema(packet, schema)).toBe(-2);
    });
  });

  it('should apply precision', () => {
    const packet = Buffer.from([0x7B]); // 123
    const schema = { offset: 0, precision: 1 };
    expect(extractFromSchema(packet, schema)).toBe(12.3);
  });

  it('should apply mapping', () => {
    const packet = Buffer.from([0x01]);
    const schema = { offset: 0, mapping: { 1: 'ON', 0: 'OFF' } };
    expect(extractFromSchema(packet, schema)).toBe('ON');
  });

  it('should return raw value if not in mapping', () => {
    const packet = Buffer.from([0x02]);
    const schema = { offset: 0, mapping: { 1: 'ON', 0: 'OFF' } };
    expect(extractFromSchema(packet, schema)).toBe(2);
  });

  it('should handle inverted bits for numeric values', () => {
    const packet = Buffer.from([0xFE]); // ~0xFE = 0x01
    const schema = { offset: 0, inverted: true };
    expect(extractFromSchema(packet, schema)).toBe(1);
  });
});

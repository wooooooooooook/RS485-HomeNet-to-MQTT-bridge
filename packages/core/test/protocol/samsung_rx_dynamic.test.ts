import { describe, it, expect } from 'vitest';
import {
  calculateChecksum,
  calculateChecksumFromBuffer,
} from '../../src/protocol/utils/checksum.js';

describe('Samsung SDS Checksum (Redefined)', () => {
  // Logic: XOR all bytes (including header) and set MSB to 0 (& 0x7F)

  it('should calculate samsung_xor correctly (XOR all, MSB 0)', () => {
    const header = [0xb0];
    const data = [0x79, 0x21, 0x01];
    // XOR: B0 ^ 79 ^ 21 ^ 01 = E9
    // E9 & 0x7F = 69

    expect(calculateChecksum(header, data, 'samsung_xor')).toBe(0x69);
  });

  it('should calculate correctly with different header', () => {
    const header = [0xac];
    const data = [0x7a, 0x01, 0x01];
    // XOR: AC ^ 7A ^ 01 ^ 01 = D6
    // D6 & 0x7F = 56

    expect(calculateChecksum(header, data, 'samsung_xor')).toBe(0x56);
  });

  it('should work with empty header (rx_header: [])', () => {
    const header: number[] = [];
    const data = [0xb0, 0x79, 0x21, 0x01];
    // XOR: B0 ^ 79 ^ 21 ^ 01 = E9
    // E9 & 0x7F = 69

    expect(calculateChecksum(header, data, 'samsung_xor')).toBe(0x69);
  });

  it('should calculate from buffer correctly', () => {
    const packet = [0xb0, 0x79, 0x21, 0x01, 0x69];
    const dataEnd = 4;
    const headerLength = 1;

    expect(calculateChecksumFromBuffer(packet, 'samsung_xor', headerLength, dataEnd)).toBe(0x69);
  });

  it('should calculate from buffer correctly with 0 header length', () => {
    const packet = [0xb0, 0x79, 0x21, 0x01, 0x69];
    const dataEnd = 4;
    const headerLength = 0;

    expect(calculateChecksumFromBuffer(packet, 'samsung_xor', headerLength, dataEnd)).toBe(0x69);
  });
});

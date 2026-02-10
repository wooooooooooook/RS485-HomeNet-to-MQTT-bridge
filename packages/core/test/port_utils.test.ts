import { describe, it, expect } from 'vitest';
import { normalizePortId } from '../src/utils/port.js';

describe('normalizePortId', () => {
  it('should return trimmed portId when provided', () => {
    expect(normalizePortId('COM1', 0)).toBe('COM1');
    expect(normalizePortId(' /dev/ttyUSB0 ', 0)).toBe('/dev/ttyUSB0');
  });

  it('should return homedevice{index + 1} when portId is null', () => {
    expect(normalizePortId(null, 0)).toBe('homedevice1');
    expect(normalizePortId(null, 1)).toBe('homedevice2');
  });

  it('should return homedevice{index + 1} when portId is undefined', () => {
    expect(normalizePortId(undefined, 0)).toBe('homedevice1');
    expect(normalizePortId(undefined, 2)).toBe('homedevice3');
  });

  it('should return homedevice{index + 1} when portId is empty string', () => {
    expect(normalizePortId('', 0)).toBe('homedevice1');
  });

  it('should return homedevice{index + 1} when portId is whitespace', () => {
    expect(normalizePortId('   ', 0)).toBe('homedevice1');
    expect(normalizePortId('\t', 5)).toBe('homedevice6');
  });
});

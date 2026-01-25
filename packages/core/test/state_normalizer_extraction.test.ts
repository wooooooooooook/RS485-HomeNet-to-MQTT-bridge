import { describe, it, expect } from 'vitest';
import { normalizeDeviceState } from '../src/protocol/devices/state-normalizer.js';
import { Buffer } from 'buffer';

describe('normalizeDeviceState extraction', () => {
  it('should extract numeric value for sensor', () => {
    const config = {
      type: 'sensor',
      state_number: {
        offset: 0,
        length: 2,
        endian: 'big',
      },
    };
    const payload = Buffer.from([0x01, 0x02]);
    const normalized = normalizeDeviceState(config, payload, {});
    expect(normalized.value).toBe(258);
  });

  it('should extract little endian value', () => {
    const config = {
      type: 'sensor',
      state_number: {
        offset: 0,
        length: 2,
        endian: 'little',
      },
    };
    const payload = Buffer.from([0x01, 0x02]);
    const normalized = normalizeDeviceState(config, payload, {});
    expect(normalized.value).toBe(513);
  });

  it('should extract BCD value', () => {
    const config = {
      type: 'sensor',
      state_number: {
        offset: 0,
        length: 1,
        decode: 'bcd',
      },
    };
    const payload = Buffer.from([0x12]);
    const normalized = normalizeDeviceState(config, payload, {});
    expect(normalized.value).toBe(12);
  });

  it('should extract signed byte half degree', () => {
    const config = {
      type: 'climate',
      state_temperature_current: {
        offset: 0,
        length: 1,
        decode: 'signed_byte_half_degree',
        signed: true,
      },
    };
    // 0x18 = 24.0
    // 0x98 (0x18 | 0x80) = 24.5

    // Existing logic:
    // val = byte & 0x7f.
    // If bit 0x80 set, val += 0.5.
    // If signed and bit 0x40 set, val = -val.

    let payload = Buffer.from([0x18]); // 24
    let normalized = normalizeDeviceState(config, payload, {});
    expect(normalized.current_temperature).toBe(24.0);

    payload = Buffer.from([0x98]); // 152. 152 & 127 = 24. +0.5 = 24.5
    normalized = normalizeDeviceState(config, payload, {});
    expect(normalized.current_temperature).toBe(24.5);

    payload = Buffer.from([0x58]); // 88. 88 & 127 = 88. 0x40 is set. -88.
    normalized = normalizeDeviceState(config, payload, {});
    expect(normalized.current_temperature).toBe(-88.0);
  });

  it('should extract signed integer (negative)', () => {
    const config = {
      type: 'sensor',
      state_number: {
        offset: 0,
        length: 1,
        signed: true,
      },
    };
    const payload = Buffer.from([0xff]); // -1
    const normalized = normalizeDeviceState(config, payload, {});
    expect(normalized.value).toBe(-1);
  });
});

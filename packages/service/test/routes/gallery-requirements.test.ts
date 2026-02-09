import { describe, it, expect } from 'vitest';
import { HomenetBridgeConfig } from '@rs485-homenet/core';
import { checkConfigRequirements } from '../../src/utils/gallery-requirements.js';

describe('checkConfigRequirements', () => {
  const baseConfig: HomenetBridgeConfig = {
      serial: {
        path: '/dev/ttyUSB0',
        baud_rate: 9600,
        data_bits: 8,
        parity: 'none',
        stop_bits: 1,
        portId: 'default'
      },
      packet_defaults: {
        rx_header: [0xaa],
      },
  };

  it('should return true when requirements match config', () => {
    const requirements = {
      serial: { baud_rate: 9600, parity: 'none' },
      packet_defaults: { rx_header: [0xaa] },
    };

    expect(checkConfigRequirements(baseConfig, requirements)).toBe(true);
  });

  it('should return false when baud_rate mismatches', () => {
    const requirements = {
      serial: { baud_rate: 19200 },
    };

    expect(checkConfigRequirements(baseConfig, requirements)).toBe(false);
  });

  it('should return false when packet_defaults mismatch', () => {
    const requirements = {
      packet_defaults: { rx_header: [0xbb] },
    };

    expect(checkConfigRequirements(baseConfig, requirements)).toBe(false);
  });

  it('should treat null/undefined/empty array as equivalent in packet_defaults', () => {
    const config: HomenetBridgeConfig = {
      serial: {
        path: '/dev/ttyUSB0',
        baud_rate: 9600,
        data_bits: 8,
        parity: 'none',
        stop_bits: 1,
        portId: 'default'
      },
      packet_defaults: {
        rx_header: [], // empty array
      },
    };

    // requirement expects null (should match empty array)
    // Note: If expected is null, normalizeValue returns '__EMPTY__'.
    // If actual is [], normalizeValue returns '__EMPTY__'.
    // Match!
    const req1 = {
      packet_defaults: { rx_header: null },
    };
    // Type casting because HomenetBridgeConfig types might be strict but runtime allows it
    expect(checkConfigRequirements(config, req1 as any)).toBe(true);

    // Test explicit empty array requirement matching null config
    const config2: HomenetBridgeConfig = {
      serial: {
        path: '/dev/ttyUSB0',
        baud_rate: 9600,
        data_bits: 8,
        parity: 'none',
        stop_bits: 1,
        portId: 'default'
      },
      packet_defaults: {
        // rx_header undefined
      },
    };

    const req2 = {
      packet_defaults: { rx_header: [] },
    };
    expect(checkConfigRequirements(config2, req2)).toBe(true);
  });
});

import { describe, it, expect } from 'vitest';
import { HomenetBridgeConfig } from '@rs485-homenet/core';
import { checkConfigRequirements } from '../../src/utils/gallery-requirements.js';

describe('checkConfigRequirements Enhanced', () => {
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

  it('should support range matching for baud_rate', () => {
    // 9600 is within [9000, 10000]
    expect(
      checkConfigRequirements(baseConfig, {
        serial: { baud_rate: { min: 9000, max: 10000 } },
      })
    ).toBe(true);

    // 9600 is NOT within [10000, 11000]
    expect(
      checkConfigRequirements(baseConfig, {
        serial: { baud_rate: { min: 10000, max: 11000 } },
      })
    ).toBe(false);

    // Min only
    expect(
      checkConfigRequirements(baseConfig, {
        serial: { baud_rate: { min: 9000 } },
      })
    ).toBe(true);
    
    // Max only
    expect(
        checkConfigRequirements(baseConfig, {
          serial: { baud_rate: { max: 9000 } },
        })
      ).toBe(false);
  });

  it('should support list matching for parity', () => {
    // 'none' is in ['none', 'even']
    expect(
      checkConfigRequirements(baseConfig, {
        serial: { parity: ['none', 'even'] },
      })
    ).toBe(true);

    // 'none' is NOT in ['odd', 'mark']
    expect(
      checkConfigRequirements(baseConfig, {
        serial: { parity: ['odd', 'mark'] },
      })
    ).toBe(false);
  });

  it('should support exact matching (backward compatibility)', () => {
    expect(
      checkConfigRequirements(baseConfig, {
        serial: { baud_rate: 9600 },
      })
    ).toBe(true);

    expect(
      checkConfigRequirements(baseConfig, {
        serial: { baud_rate: 19200 },
      })
    ).toBe(false);
  });
  
  it('should support list matching for stop_bits', () => {
      // 1 is in [1, 2]
      expect(
        checkConfigRequirements(baseConfig, {
          serial: { stop_bits: [1, 2] },
        })
      ).toBe(true);
  });

  it('should handle packet_defaults list matching', () => {
    const configWithChecksum: HomenetBridgeConfig = {
        ...baseConfig,
        packet_defaults: { ...baseConfig.packet_defaults, rx_checksum: 'none' }
    };

    expect(
        checkConfigRequirements(configWithChecksum, {
            packet_defaults: { rx_checksum: ['none', 'sum'] }
        })
    ).toBe(true);
  });

  it('should handle rx_header exact array matching', () => {
      // Exact match [0xaa] matches [0xaa]
      expect(
          checkConfigRequirements(baseConfig, {
              packet_defaults: { rx_header: [0xaa] }
          })
      ).toBe(true);
  });

  it('should handle rx_header list matching', () => {
      // List match: [[0xaa], [0xbb]] matches [0xaa]
      expect(
          checkConfigRequirements(baseConfig, {
              packet_defaults: { rx_header: [[0xaa], [0xbb]] }
          })
      ).toBe(true);
  });
});

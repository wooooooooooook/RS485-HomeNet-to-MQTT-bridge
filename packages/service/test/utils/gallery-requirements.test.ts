import { describe, it, expect } from 'vitest';
import { HomenetBridgeConfig } from '@rs485-homenet/core';
import { checkConfigRequirements, matchRequirement } from '../../src/utils/gallery-requirements.js';

describe('matchRequirement', () => {
    it('should match primitive values (exact)', () => {
        expect(matchRequirement(9600, 9600)).toBe(true);
        expect(matchRequirement('none', 'none')).toBe(true);
        expect(matchRequirement(9600, 19200)).toBe(false);
    });

    it('should match primitive values (list)', () => {
        expect(matchRequirement([9600, 19200], 9600)).toBe(true);
        expect(matchRequirement([9600, 19200], 19200)).toBe(true);
        expect(matchRequirement([9600, 19200], 38400)).toBe(false);
    });

    it('should match primitive values (range)', () => {
        expect(matchRequirement({ min: 9000, max: 10000 }, 9600)).toBe(true);
        expect(matchRequirement({ min: 9000, max: 10000 }, 8000)).toBe(false);
    });

    it('should match array values (exact)', () => {
        // rx_header: [0xaa]
        expect(matchRequirement([0xaa], [0xaa])).toBe(true);
        expect(matchRequirement([0xaa, 0xbb], [0xaa, 0xbb])).toBe(true);
        expect(matchRequirement([0xaa], [0xbb])).toBe(false);
    });

    it('should match array values (list)', () => {
        // rx_header: [[0xaa], [0xbb]]
        expect(matchRequirement([[0xaa], [0xbb]], [0xaa])).toBe(true);
        expect(matchRequirement([[0xaa], [0xbb]], [0xbb])).toBe(true);
        expect(matchRequirement([[0xaa], [0xbb]], [0xcc])).toBe(false);
    });
});

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

  it('should pass correct config', () => {
      expect(checkConfigRequirements(baseConfig, {
          serial: { baud_rate: 9600 },
          packet_defaults: { rx_header: [0xaa] }
      })).toBe(true);
  });
});

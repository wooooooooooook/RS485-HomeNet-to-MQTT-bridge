import { describe, it, expect } from 'vitest';
import { ClimateDevice } from '../src/protocol/devices/climate.device';
import { ProtocolConfig } from '../src/protocol/types';

describe('Issue Repro: Mode Inverted', () => {
  const protocolConfig: ProtocolConfig = {
    packet_defaults: { rx_length: 8, rx_header: [] },
  };

  const heaterConfig = {
    id: 'heater_1',
    name: 'Heater 1',
    type: 'climate',
    state: {
      data: [0x80, 0x00, 0x01],
      mask: [0xF9, 0x00, 0xFF]
    },
    state_temperature_current: {
      offset: 3,
      signed: false,
      decode: 'bcd'
    },
    state_temperature_target: {
      offset: 4,
      signed: false,
      decode: 'bcd'
    },
    state_off: {
      offset: 1,
      data: [0x80]
    },
    state_heat: {
      offset: 1,
      data: [0x00],
      mask: [0x0F],
      inverted: true
    },
    state_action_off: {
      offset: 1,
      data: [0x80]
    },
    state_action_idle: {
      offset: 1,
      data: [0x81]
    },
    state_action_heating: {
      offset: 1,
      data: [0x83]
    }
  };

  it('should correctly parse mode with inverted logic', () => {
    const device = new ClimateDevice(heaterConfig as any, protocolConfig);
    // Packet: 0x82 0x81 0x01 0x25 0x15 0x00 0x00 0x3e
    const packet = [0x82, 0x81, 0x01, 0x25, 0x15, 0x00, 0x00, 0x3e];

    const result = device.parseData(packet);
    
    // Before fix, mode is likely missing
    // After fix, mode should be 'heat'
    
    // Byte 1 is 0x81.
    // state_off: 0x80. No match.
    // state_heat: data 0x00, mask 0x0F. 0x81 & 0x0F = 0x01. 0x01 != 0x00. Match FAIL.
    // Inverted: True. So it SHOULD be considered a match -> mode: heat.
    
    console.log('Parsed result:', result);
    expect(result).not.toBeNull();
    if (result) {
        expect(result.mode).toBe('heat');
        expect(result.current_temperature).toBe(25);
        expect(result.target_temperature).toBe(15);
        expect(result.action).toBe('idle');
    }
  });
});

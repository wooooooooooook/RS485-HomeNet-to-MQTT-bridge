import { describe, it, expect } from 'vitest';
import { ClimateDevice } from '../../src/protocol/devices/climate.device';
import { ClimateEntity } from '../../src/domain/entities/climate.entity';
import { ProtocolConfig } from '../../src/protocol/types';

const protocolConfig: ProtocolConfig = {
  packet_defaults: { rx_length: 10 },
};

describe('Climate Entity', () => {
  const climateConfig: ClimateEntity = {
    id: 'test_climate',
    name: 'Test Climate',
    type: 'climate',
    state: { offset: 0, data: [0x80], mask: [0xf0] },
    state_temperature_current: { offset: 1, decode: 'bcd' },
    state_temperature_target: { offset: 2, decode: 'bcd' },
    state_off: { offset: 0, data: [0x80] },
    state_heat: { offset: 0, data: [0x81] },
    state_cool: { offset: 0, data: [0x82] },
    state_action_heating: { offset: 3, data: [0x01] },
    state_action_cooling: { offset: 3, data: [0x02] },
    state_action_idle: { offset: 3, data: [0x00] },

    command_off: { data: [0x80, 0x00] },
    command_heat: { data: [0x80, 0x01] },
    command_cool: { data: [0x80, 0x02] },
    command_temperature: { data: [0x80, 0x03, 0x00], value_offset: 2, length: 1 },
  };

  it('should parse current and target temperature', () => {
    const device = new ClimateDevice(climateConfig, protocolConfig);
    // 0x81 (Heat), 0x25 (25C), 0x30 (30C), 0x01 (Heating)
    const packet = [0x81, 0x25, 0x30, 0x01, 0x00];
    const result = device.parseData(packet);
    expect(result).toMatchObject({
      current_temperature: 25,
      target_temperature: 30,
    });
  });

  it('should parse mode', () => {
    const device = new ClimateDevice(climateConfig, protocolConfig);

    expect(device.parseData([0x80, 0x00, 0x00, 0x00, 0x00])).toMatchObject({ mode: 'off' });
    expect(device.parseData([0x81, 0x00, 0x00, 0x00, 0x00])).toMatchObject({ mode: 'heat' });
    expect(device.parseData([0x82, 0x00, 0x00, 0x00, 0x00])).toMatchObject({ mode: 'cool' });
  });

  it('should parse action', () => {
    const device = new ClimateDevice(climateConfig, protocolConfig);

    expect(device.parseData([0x81, 0x00, 0x00, 0x01, 0x00])).toMatchObject({ action: 'heating' });
    expect(device.parseData([0x82, 0x00, 0x00, 0x02, 0x00])).toMatchObject({ action: 'cooling' });
    expect(device.parseData([0x81, 0x00, 0x00, 0x00, 0x00])).toMatchObject({ action: 'idle' });
  });

  it('should construct mode commands', () => {
    const device = new ClimateDevice(climateConfig, protocolConfig);

    expect(device.constructCommand('off')).toEqual([0x80, 0x00]);
    expect(device.constructCommand('heat')).toEqual([0x80, 0x01]);
    // Cool command might not be standard in GenericDevice yet, but let's check if we can add it or if it falls back
    // The GenericDevice/ClimateDevice implementation I saw earlier had specific handling for off/heat.
    // Let's verify if 'cool' is handled if config is present.
    // Looking at ClimateDevice.ts, it calls super.constructCommand first.
    // If GenericDevice handles it via simple command lookup, it should work.
    expect(device.constructCommand('cool')).toEqual([0x80, 0x02]);
  });

  it('should construct temperature command', () => {
    const device = new ClimateDevice(climateConfig, protocolConfig);

    // Verify that constructCommand correctly handles value injection using value_offset
    // Config: command_temperature: { data: [0x80, 0x03, 0x00], value_offset: 2, length: 1 }
    // Value: 25 (0x19)
    // Expected: [0x80, 0x03, 0x19]
    expect(device.constructCommand('temperature', 25)).toEqual([0x80, 0x03, 0x19]);
  });

  it('should handle heater_4 specific logic (integration test migration)', () => {
    const heater4Config = {
      id: 'heater_4',
      name: 'Heater 4',
      type: 'climate',
      state: {
        data: [0x80, 0x00, 0x04],
        mask: [0xf9, 0x00, 0xff],
      },
      state_temperature_current: { offset: 3, decode: 'bcd' },
      state_temperature_target: { offset: 4, decode: 'bcd' },
      state_off: { offset: 1, data: [0x80] },
      state_heat: { offset: 1, data: [0x00], mask: [0x0f], inverted: true },
    };

    const device = new ClimateDevice(heater4Config as any, protocolConfig);
    const packet = [0x82, 0x80, 0x04, 0x22, 0x15, 0x00, 0x00, 0x3d];

    expect(device.matchesPacket(packet)).toBe(true);
    const result = device.parseData(packet);
    expect(result).toMatchObject({
      current_temperature: 22,
      target_temperature: 15,
      mode: 'off',
    });
  });
});

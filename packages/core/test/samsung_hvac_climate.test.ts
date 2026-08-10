import { describe, it, expect } from 'vitest';
import { ClimateDevice } from '../src/protocol/devices/climate.device.js';
import { PacketParser } from '../src/protocol/packet-parser.js';
import { ProtocolConfig } from '../src/protocol/types.js';

describe('Samsung HVAC NonNASA Climate Integration', () => {
  const protocolConfig: ProtocolConfig = {
    packet_defaults: {
      rx_header: [0x32],
      tx_header: [0x32],
      rx_footer: [0x34],
      tx_footer: [0x34],
      rx_checksum: 'xor_no_header',
      tx_checksum: 'xor_no_header',
      rx_min_length: 14,
      rx_max_length: 14,
    },
  };

  const climateConfig = {
    id: 'hvac_1',
    name: 'HVAC 1',
    type: 'climate',
    visual: {
      min_temperature: 16,
      max_temperature: 30,
      temperature_step: 1,
    },
    state: {
      data: [0x20, 0x00, 0x20],
      mask: [0xff, 0x00, 0xff],
      index: 1,
    },
    state_temperature_target: 'double(data[4]) - 55.0',
    state_temperature_current: 'double(data[5]) - 55.0',
    state_off: {
      index: 8,
      data: [0x00],
      mask: [0x80],
    },
    state_heat: {
      index: 8,
      data: [0x81],
      mask: [0xbf],
    },
    state_cool: {
      index: 8,
      data: [0x82],
      mask: [0xbf],
    },
    state_fan_auto: {
      index: 7,
      data: [0x00],
      mask: [0x07],
    },
    state_fan_low: {
      index: 7,
      data: [0x02],
      mask: [0x07],
    },
    state_fan_medium: {
      index: 7,
      data: [0x04],
      mask: [0x07],
    },
    state_fan_high: {
      index: 7,
      data: [0x05],
      mask: [0x07],
    },
    command_off: {
      data: [0xd0, 0x20, 0xb0, 0x1f, 0x04, 0x00, 0x00, 0xc4, 0x21, 0x00, 0x00],
    },
    command_heat: {
      data: [0xd0, 0x20, 0xb0, 0x1f, 0x04, 0x00, 0x04, 0xf4, 0x21, 0x00, 0x00],
    },
    command_cool: {
      data: [0xd0, 0x20, 0xb0, 0x1f, 0x04, 0x00, 0x01, 0xf4, 0x21, 0x00, 0x00],
    },
    command_temperature:
      '[[0xD0, 0x20, 0xB0, 0x1F, 0x04, bitAnd(int(x), 31), 0x04, 0xF4, 0x21, 0x00, 0x00]]',
  };

  it('should parse 14-byte Cmd20 packet correctly (Target: 24°C, Current: 22°C, Heat mode, High fan)', () => {
    const device = new ClimateDevice(climateConfig as any, protocolConfig);

    // Frame: 0x32 (Start), SRC=0x20 (Indoor 1), DST=0xC8 (Outdoor), CMD=0x20 (Cmd20)
    // Target temp: 24 + 55 = 79 (0x4F)
    // Room temp: 22 + 55 = 77 (0x4D)
    // Pipe in: 20 + 55 = 75 (0x4B)
    // Wind + Fan: High fan = 5 (0x05)
    // Power + Mode: Power ON (0x80) | Heat (0x01) = 0x81
    // Data bytes 1..11: [0x20, 0xC8, 0x20, 0x4F, 0x4D, 0x4B, 0x05, 0x81, 0x00, 0x00, 0x4B]
    const dataBytes = [0x20, 0xc8, 0x20, 0x4f, 0x4d, 0x4b, 0x05, 0x81, 0x00, 0x00, 0x4b];
    const crc = dataBytes.reduce((acc, b) => acc ^ b, 0);

    const packet = Buffer.from([0x32, ...dataBytes, crc, 0x34]);

    const state = device.parseData(packet);

    expect(state).not.toBeNull();
    expect(state?.target_temperature).toBe(24);
    expect(state?.current_temperature).toBe(22);
    expect(state?.mode).toBe('heat');
    expect(state?.fan_mode).toBe('high');
  });

  it('should verify packet parser extracts valid NonNASA packet with xor_no_header checksum', () => {
    const parser = new PacketParser(protocolConfig.packet_defaults!);
    const dataBytes = [0x20, 0xc8, 0x20, 0x4f, 0x4d, 0x4b, 0x05, 0x81, 0x00, 0x00, 0x4b];
    const crc = dataBytes.reduce((acc, b) => acc ^ b, 0);
    const packet = Buffer.from([0x32, ...dataBytes, crc, 0x34]);

    const parsed = parser.parseChunk(packet);
    expect(parsed.length).toBe(1);
    expect(Buffer.compare(parsed[0], packet)).toBe(0);
  });

  it('should construct command_cool packet with proper checksum', () => {
    const device = new ClimateDevice(climateConfig as any, protocolConfig);
    const command = device.constructCommand('cool');

    expect(command).not.toBeNull();
    const packet = Array.isArray(command) ? command : (command as any).packet;
    expect(packet[0]).toBe(0x32); // header
    expect(packet[13]).toBe(0x34); // footer
    expect(packet[1]).toBe(0xd0); // SRC
    expect(packet[2]).toBe(0x20); // DST (Indoor 1)
    expect(packet[3]).toBe(0xb0); // CMD (CmdB0)
    expect(packet[7]).toBe(0x01); // Mode cool

    // Verify CRC (bytes 1..11)
    const expectedCrc = packet.slice(1, 12).reduce((a: number, b: number) => a ^ b, 0);
    expect(packet[12]).toBe(expectedCrc);
  });

  it('should construct command_temperature with target value', () => {
    const device = new ClimateDevice(climateConfig as any, protocolConfig);
    const command = device.constructCommand('temperature', 26);

    expect(command).not.toBeNull();
    const packet = Array.isArray(command) ? command : (command as any).packet;
    expect(packet[0]).toBe(0x32);
    // Full packet: [0x32 (header), 0xD0, 0x20, 0xB0, 0x1F, 0x04, 26 (target), ...]
    expect(packet[6]).toBe(26); // target temperature (26) at index 6 of full packet
  });
});

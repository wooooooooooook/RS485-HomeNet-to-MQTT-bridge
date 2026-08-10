import { describe, it, expect } from 'vitest';
import { ClimateDevice } from '../src/protocol/devices/climate.device.js';
import { PacketParser } from '../src/protocol/packet-parser.js';
import { ProtocolConfig } from '../src/protocol/types.js';

describe('Samsung HVAC NASA Climate Integration', () => {
  const protocolConfig: ProtocolConfig = {
    packet_defaults: {
      rx_header: [0x32],
      tx_header: [0x32],
      rx_footer: [0x34],
      tx_footer: [0x34],
      rx_checksum2: 'crc16_no_header(data, 3, 0x1021, 0, false, false, 0)',
      tx_checksum2: 'crc16_no_header(data, 3, 0x1021, 0, false, false, 0)',
      rx_length_expr: '(int(data[1]) << 8) + int(data[2]) + 2',
      rx_min_length: 14,
      rx_max_length: 100,
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
      data: [0x20, 0x00, 0x01],
      index: 3,
    },
    state_temperature_target:
      '(int(data[13]) == 0x42 && int(data[14]) == 0x01) ? dyn(double(bitShiftLeft(int(data[15]), 8) + int(data[16])) / 10.0) : null',
    state_temperature_current:
      '(int(data[13]) == 0x42 && int(data[14]) == 0x03) ? dyn(double(bitShiftLeft(int(data[15]), 8) + int(data[16])) / 10.0) : null',
    state_off: {
      index: 13,
      data: [0x40, 0x00, 0x00],
    },
    state_on: {
      index: 13,
      data: [0x40, 0x00, 0x01],
    },
    state_heat: {
      index: 13,
      data: [0x40, 0x01, 0x04],
    },
    state_fan_high: {
      index: 13,
      data: [0x40, 0x06, 0x03],
    },
    command_off: {
      data: [
        0x00, 0x11, 0x80, 0xff, 0x00, 0x20, 0x00, 0x01, 0xc0, 0x12, 0x01, 0x01, 0x40, 0x00, 0x00,
      ],
    },
    command_heat: {
      data: [
        0x00, 0x11, 0x80, 0xff, 0x00, 0x20, 0x00, 0x01, 0xc0, 0x12, 0x01, 0x01, 0x40, 0x01, 0x04,
      ],
    },
    command_temperature:
      '[[0x00, 0x12, 0x80, 0xFF, 0x00, 0x20, 0x00, 0x01, 0xC0, 0x12, 0x01, 0x01, 0x42, 0x01, bitShiftRight(int(double(x) * 10.0), 8), bitAnd(int(double(x) * 10.0), 255)]]',
  };

  // Helper for generating valid NASA CRC16 (poly=0x1021, init=0, refin=false, refout=false, xorOut=0) starting at byte 3
  function computeNasaCrc16(data: number[]): [number, number] {
    let crc = 0;
    for (let i = 3; i < data.length - 3; i++) {
      crc = crc ^ (data[i] << 8);
      for (let j = 0; j < 8; j++) {
        if (crc & 0x8000) {
          crc = ((crc << 1) ^ 0x1021) & 0xffff;
        } else {
          crc = (crc << 1) & 0xffff;
        }
      }
    }
    return [(crc >> 8) & 0xff, crc & 0xff];
  }

  it('should parse target temperature (0x4201) correctly in NASA frame', () => {
    const device = new ClimateDevice(climateConfig as any, protocolConfig);

    // Frame (20 bytes):
    // 0x32 (Start), 0x00, 0x12 (Size=18), SA=20.00.01, DA=80.FF.00, CMD=C0 14 01, MSG_COUNT=01, MSG_ID=0x4201, VAL=240 (0x00, 0xF0)
    const rawPacket = [
      0x32, 0x00, 0x12, 0x20, 0x00, 0x01, 0x80, 0xff, 0x00, 0xc0, 0x14, 0x01, 0x01, 0x42, 0x01,
      0x00, 0xf0, 0x00, 0x00, 0x34,
    ];
    const [crcHi, crcLo] = computeNasaCrc16(rawPacket);
    rawPacket[17] = crcHi;
    rawPacket[18] = crcLo;

    const packet = Buffer.from(rawPacket);

    const state = device.parseData(packet);
    expect(state).not.toBeNull();
    expect(state?.target_temperature).toBe(24);
  });

  it('should parse heat mode state (0x4001 = 4) correctly in NASA frame', () => {
    const device = new ClimateDevice(climateConfig as any, protocolConfig);

    // SA=20.00.01, DA=80.FF.00, CMD=C0 14 01, MSG_COUNT=01, MSG_ID=0x4001, VAL=0x04
    const rawPacket = [
      0x32, 0x00, 0x11, 0x20, 0x00, 0x01, 0x80, 0xff, 0x00, 0xc0, 0x14, 0x01, 0x01, 0x40, 0x01,
      0x04, 0x00, 0x00, 0x34,
    ];
    const [crcHi, crcLo] = computeNasaCrc16(rawPacket);
    rawPacket[16] = crcHi;
    rawPacket[17] = crcLo;

    const packet = Buffer.from(rawPacket);

    const state = device.parseData(packet);
    expect(state).not.toBeNull();
    expect(state?.mode).toBe('heat');
  });

  it('should verify packet parser parses NASA variable length frame with rx_length_expr', () => {
    const parser = new PacketParser(protocolConfig.packet_defaults!);
    const rawPacket = [
      0x32, 0x00, 0x12, 0x20, 0x00, 0x01, 0x80, 0xff, 0x00, 0xc0, 0x14, 0x01, 0x01, 0x42, 0x01,
      0x00, 0xf0, 0x00, 0x00, 0x34,
    ];
    const [crcHi, crcLo] = computeNasaCrc16(rawPacket);
    rawPacket[17] = crcHi;
    rawPacket[18] = crcLo;

    const packet = Buffer.from(rawPacket);

    const parsed = parser.parseChunk(packet);
    expect(parsed.length).toBe(1);
    expect(Buffer.compare(parsed[0], packet)).toBe(0);
  });

  it('should construct command_temperature with target value 26°C (260 = 0x0104)', () => {
    const device = new ClimateDevice(climateConfig as any, protocolConfig);
    const command = device.constructCommand('temperature', 26);

    expect(command).not.toBeNull();
    const packet = Array.isArray(command) ? command : (command as any).packet;

    expect(packet[0]).toBe(0x32);
    expect(packet[packet.length - 1]).toBe(0x34);

    // Payload starts at index 3:
    // MSG_ID = [0x42, 0x01] at index 13, 14
    // Target value = 260 -> 0x01, 0x04 at index 15, 16
    expect(packet[15]).toBe(0x01);
    expect(packet[16]).toBe(0x04);
  });
});

import { describe, it, expect } from 'vitest';
import { SensorDevice } from '../src/protocol/devices/sensor.device.js';
import { ProtocolConfig } from '../src/protocol/types.js';

describe('Samsung HVAC NonNASA Outdoor Sensors Integration', () => {
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

  const outdoorTempConfig = {
    id: 'outdoor_temperature',
    name: 'Outdoor Temperature',
    type: 'sensor',
    state: {
      data: [0xc8, 0x00, 0xc0],
      mask: [0xff, 0x00, 0xff],
      index: 1,
    },
    state_value: 'double(data[8]) - 55.0',
  };

  const outdoorPowerConfig = {
    id: 'outdoor_inverter_power',
    name: 'Outdoor Inverter Power',
    type: 'sensor',
    state: {
      data: [0xc8, 0x00, 0x8d],
      mask: [0xff, 0x00, 0xff],
      index: 1,
    },
    state_value: '(double(data[8]) / 10.0) * 0.1 * (double(data[10]) * 2.0)',
  };

  const outdoorErrorCodeConfig = {
    id: 'outdoor_error_code',
    name: 'Outdoor Error Code',
    type: 'sensor',
    state: {
      data: [0xc8, 0x00, 0xf0],
      mask: [0xff, 0x00, 0xff],
      index: 1,
    },
    state_value: 'int(data[10])',
  };

  it('should parse outdoor temperature correctly (CmdC0)', () => {
    const device = new SensorDevice(outdoorTempConfig as any, protocolConfig);

    // Frame: SRC=0xC8 (Outdoor), DST=0xD0 (Controller), CMD=0xC0
    // Outdoor temp: 15°C -> 15 + 55 = 70 (0x46) at index 8
    const dataBytes = [0xc8, 0xd0, 0xc0, 0x00, 0x00, 0x00, 0x00, 0x46, 0x00, 0x00, 0x00];
    const crc = dataBytes.reduce((a, b) => a ^ b, 0);
    const packet = Buffer.from([0x32, ...dataBytes, crc, 0x34]);

    const state = device.parseData(packet);
    expect(state).not.toBeNull();
    expect(state?.value).toBe(15);
  });

  it('should parse outdoor inverter power correctly (Cmd8D)', () => {
    const device = new SensorDevice(outdoorPowerConfig as any, protocolConfig);

    // Frame: SRC=0xC8, DST=0xD0, CMD=0x8D
    // Current raw: 100 -> 10A (data[8] = 100 = 0x64)
    // Voltage raw: 110 -> 220V (data[10] = 110 = 0x6E)
    // Calculated power: (100 / 10) * 0.1 * (110 * 2) = 1.0 * 220 = 220W
    const dataBytes = [0xc8, 0xd0, 0x8d, 0x00, 0x00, 0x00, 0x00, 0x64, 0x00, 0x6e, 0x00];
    const crc = dataBytes.reduce((a, b) => a ^ b, 0);
    const packet = Buffer.from([0x32, ...dataBytes, crc, 0x34]);

    const state = device.parseData(packet);
    expect(state).not.toBeNull();
    expect(state?.value).toBeCloseTo(220.0);
  });

  it('should parse outdoor error code correctly (CmdF0)', () => {
    const device = new SensorDevice(outdoorErrorCodeConfig as any, protocolConfig);

    // Frame: SRC=0xC8, DST=0xD0, CMD=0xF0
    // Error code: 0x00 (Normal), or 0x05 (E105) at index 10
    const dataBytes = [0xc8, 0xd0, 0xf0, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x05, 0x00];
    const crc = dataBytes.reduce((a, b) => a ^ b, 0);
    const packet = Buffer.from([0x32, ...dataBytes, crc, 0x34]);

    const state = device.parseData(packet);
    expect(state).not.toBeNull();
    expect(state?.value).toBe(5);
  });
});

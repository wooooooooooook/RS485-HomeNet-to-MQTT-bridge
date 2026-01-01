import { describe, it, expect } from 'vitest';
import { ClimateDevice } from '../../../src/protocol/devices/climate.device';
import { ProtocolConfig } from '../../../src/protocol/types';

describe('ClimateDevice Command Generation', () => {
  const protocolConfig: ProtocolConfig = {
    packet_defaults: {
      tx_checksum: 'none',
    },
  };

  it('should fail when using undefined variable "target" in CEL', () => {
    const config = {
      id: 'test_climate',
      name: 'test_climate',
      command_temperature: '[[0x36, 0x11, 0x44, 0x01, target], [0x36, 0x11, 0xc4]]',
    };

    const device = new ClimateDevice(config, protocolConfig);
    // Suppress error logging for expected failure
    const command = device.constructCommand('temperature', 25);
    expect(command).toBeNull();
  });

  it('should succeed when using variable "x" in CEL (Ezville Pattern)', () => {
    const config = {
      id: 'test_climate',
      name: 'test_climate',
      command_temperature: '[[0x36, 0x11, 0x44, 0x01, x], [0x36, 0x11, 0xc4]]',
    };

    const device = new ClimateDevice(config, protocolConfig);
    const command = device.constructCommand('temperature', 25);

    // It returns CommandResult with packet and ack
    expect(command).toEqual({
      packet: [0x36, 0x11, 0x44, 0x01, 25],
      ack: { data: [0x36, 0x11, 0xc4] },
    });
  });

  it('should succeed when using complex list structure with "x" (Kocom Pattern)', () => {
    const config = {
      id: 'test_climate',
      name: 'test_climate',
      command_temperature:
        '[[0x30, 0xbc, 0x00, 0x36, 0x03, 0x01, 0x00, 0x00, 0x11, 0x01, x, 0x00, 0x00, 0x00, 0x00, 0x00], [0x30, 0xdc]]',
    };

    const device = new ClimateDevice(config, protocolConfig);
    const command = device.constructCommand('temperature', 20);

    // It returns CommandResult with packet and ack
    expect(command).toEqual({
      packet: [
        0x30, 0xbc, 0x00, 0x36, 0x03, 0x01, 0x00, 0x00, 0x11, 0x01, 20, 0x00, 0x00, 0x00, 0x00,
        0x00,
      ],
      ack: { data: [0x30, 0xdc] },
    });
  });

  it('should succeed when using variable "x" in a simple array structure', () => {
    const config = {
      id: 'test_climate',
      name: 'test_climate',
      command_temperature: '[0x01, 0x02, x]',
    };

    const device = new ClimateDevice(config, protocolConfig);
    const command = device.constructCommand('temperature', 10);

    expect(command).toEqual([0x01, 0x02, 10]);
  });
});

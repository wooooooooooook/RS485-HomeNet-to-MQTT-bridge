import { describe, it, expect } from 'vitest';
import { PacketProcessor } from '../src/protocol/packet-processor.js';
import { HomenetBridgeConfig } from '../src/config/types.js';
import { ProtocolManager } from '../src/protocol/protocol-manager.js';

// Mock ProtocolManager to avoid complex setup
// We just want to check if ID is generated in the config object passed to Device
// But PacketProcessor creates devices internally.
// We can check if the registered device has an ID.

describe('ID Generation', () => {
  it('should generate ID from name if missing', () => {
    const serial = {
      portId: 'main',
      baud_rate: 9600,
      data_bits: 8,
      parity: 'none',
      stop_bits: 1,
    } as any;
    const config: HomenetBridgeConfig = {
      serial,
      packet_defaults: {},
      light: [
        {
          name: 'Living Room Light',
          state: { data: [0x01] },
        } as any,
      ],
    };

    const stateProvider = {
      getLightState: () => undefined,
      getClimateState: () => undefined,
      getAllStates: () => ({}),
      getEntityState: () => undefined,
    };

    const processor = new PacketProcessor(config, stateProvider);

    // Access private protocolManager to check devices
    const protocolManager = (processor as any).protocolManager as ProtocolManager;
    const devices = (protocolManager as any).devices;

    expect(devices.length).toBe(1);
    expect(devices[0].getId()).toBe('living_room_light');
  });
});

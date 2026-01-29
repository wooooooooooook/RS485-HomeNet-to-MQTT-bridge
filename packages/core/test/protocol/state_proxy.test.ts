import { describe, it, expect, vi } from 'vitest';
import { ProtocolManager } from '../../src/protocol/protocol-manager';
import { LightDevice } from '../../src/protocol/devices/light.device';
import { ProtocolConfig } from '../../src/protocol/types';
import { LightEntity } from '../../src/domain/entities/light.entity';
import { ClimateDevice } from '../../src/protocol/devices/climate.device';
import { ClimateEntity } from '../../src/domain/entities/climate.entity';

describe('State Proxy Logic', () => {
  it('should redirect state updates to target_id (Light)', () => {
    const protocolConfig: ProtocolConfig = {
      packet_defaults: {
        rx_header: [0xaa],
        rx_checksum: 'none',
        rx_length: 2,
      },
    };
    const manager = new ProtocolManager(protocolConfig);

    const targetConfig: LightEntity = {
      id: 'main_light',
      name: 'Main Light',
      type: 'light',
      state: { data: [0x01] },
    };
    const targetDevice = new LightDevice(targetConfig, protocolConfig);
    manager.registerDevice(targetDevice);

    const proxyConfig: LightEntity = {
      id: 'proxy_entity',
      name: 'Proxy Entity',
      type: 'light',
      state_proxy: true,
      target_id: 'main_light',
      state: { data: [0x02] },
      state_on: { data: [0x02] }, // Just to generate some state
    };
    const proxyDevice = new LightDevice(proxyConfig, protocolConfig);
    manager.registerDevice(proxyDevice);

    const stateSpy = vi.fn();
    manager.on('state', stateSpy);

    // Send packet for proxy
    // Header: 0xAA, Data: 0x02
    manager.handleIncomingChunk(Buffer.from([0xaa, 0x02]));

    expect(stateSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        deviceId: 'main_light',
        state: expect.objectContaining({ state: 'ON' }),
      }),
    );
  });

  it('should redirect complex attributes (Climate)', () => {
    const protocolConfig: ProtocolConfig = {
      packet_defaults: {
        rx_header: [0xbb],
        rx_checksum: 'none',
        rx_length: 2,
      },
    };
    const manager = new ProtocolManager(protocolConfig);

    const targetConfig: ClimateEntity = {
      id: 'main_climate',
      name: 'Main Climate',
      type: 'climate',
      state: { data: [0x10] },
      state_cool: { data: [0x10] },
    };
    const targetDevice = new ClimateDevice(targetConfig, protocolConfig);
    manager.registerDevice(targetDevice);

    const proxyConfig: ClimateEntity = {
      id: 'proxy_climate',
      name: 'Proxy Climate',
      type: 'climate',
      state_proxy: true,
      target_id: 'main_climate',
      state: { data: [0x20] },
      // Simulate that this proxy parses a specific attribute like 'current_temperature'
      state_temperature_current: {
        length: 1,
        // Packet: BB 20 -> Data: 20 (0x20 = 32)
      },
    };
    const proxyDevice = new ClimateDevice(proxyConfig, protocolConfig);
    manager.registerDevice(proxyDevice);

    const stateSpy = vi.fn();
    manager.on('state', stateSpy);

    // Send packet for proxy
    // Header: 0xBB, Data: 0x20 (32 decimal)
    manager.handleIncomingChunk(Buffer.from([0xbb, 0x20]));

    expect(stateSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        deviceId: 'main_climate',
        state: expect.objectContaining({
          current_temperature: 32,
        }),
      }),
    );
  });
});

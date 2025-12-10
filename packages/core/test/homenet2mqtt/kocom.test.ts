import { describe, it, expect } from 'vitest';
import { setupTest, processPacket, publishMock } from './utils';
import { KOCOM_PACKETS } from '../../../simulator/src/kocom';

describe('HomeNet to MQTT - Kocom Protocol', () => {
  it('should process Kocom packets and publish state', async () => {
    const { stateManager } = await setupTest('kocom.homenet_bridge.yaml');

    // Room 0 Light 1 (ON) - Index 1
    processPacket(stateManager, KOCOM_PACKETS[1]);

    expect(publishMock).toHaveBeenCalledWith(
      'homenet/default/room_0_light_1/state',
      JSON.stringify({ state: 'ON' }),
      expect.objectContaining({ retain: true }),
    );

    // Room 0 Heater (HEAT) - Index 26
    processPacket(stateManager, KOCOM_PACKETS[26]);
    expect(publishMock).toHaveBeenCalledWith(
      'homenet/default/room_0_heater/state',
      expect.stringMatching(/\"mode\":\"heat\"/),
      expect.objectContaining({ retain: true }),
    );

    // Room 0 Heater (Temp 25C/26C) - Index 27
    processPacket(stateManager, KOCOM_PACKETS[27]);
    expect(publishMock).toHaveBeenCalledWith(
      'homenet/default/room_0_heater/state',
      expect.stringMatching(/"current_temperature":25.*"target_temperature":26/),
      expect.objectContaining({ retain: true }),
    );

    // Gas Valve (OPEN) - Index 41
    processPacket(stateManager, KOCOM_PACKETS[41]);
    expect(publishMock).toHaveBeenCalledWith(
      'homenet/default/gas_valve/state',
      JSON.stringify({ state: 'OPEN' }),
      expect.objectContaining({ retain: true }),
    );

    // Elevator Floors (Base State) - Index 43
    processPacket(stateManager, KOCOM_PACKETS[43]);
    // Expectation depends on mapping
  });
});

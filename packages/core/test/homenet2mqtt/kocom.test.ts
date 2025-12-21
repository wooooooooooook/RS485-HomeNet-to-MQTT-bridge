import { describe, it, expect } from 'vitest';
import { setupTest, processPacket, executeCommand } from './utils';
import { KOCOM_PACKETS } from '../../../simulator/src/kocom';
import { Buffer } from 'buffer';

describe('HomeNet to MQTT - Kocom Protocol', () => {
  it('should process Kocom packets and publish state', async () => {
    const ctx = await setupTest('kocom.homenet_bridge.yaml');
    const { stateManager, publishMock } = ctx;

    // Room 0 Light 1 (ON) - Index 1
    processPacket(stateManager, KOCOM_PACKETS[1]);

    expect(publishMock).toHaveBeenCalledWith(
      'homenet2mqtt/homedevice1/room_0_light_1/state',
      JSON.stringify({ state: 'ON' }),
      expect.objectContaining({ retain: true }),
    );

    // Room 0 Heater (HEAT) - Index 26
    processPacket(stateManager, KOCOM_PACKETS[26]);
    expect(publishMock).toHaveBeenCalledWith(
      'homenet2mqtt/homedevice1/room_0_heater/state',
      expect.stringMatching(/\"mode\":\"heat\"/),
      expect.objectContaining({ retain: true }),
    );

    // Room 0 Heater (Temp 25C/26C) - Index 27
    processPacket(stateManager, KOCOM_PACKETS[27]);
    expect(publishMock).toHaveBeenCalledWith(
      'homenet2mqtt/homedevice1/room_0_heater/state',
      expect.stringMatching(/"current_temperature":25.*"target_temperature":26/),
      expect.objectContaining({ retain: true }),
    );

    // Gas Valve (OPEN) - Index 41
    processPacket(stateManager, KOCOM_PACKETS[41]);
    expect(publishMock).toHaveBeenCalledWith(
      'homenet2mqtt/homedevice1/gas_valve/state',
      JSON.stringify({ state: 'OPEN' }),
      expect.objectContaining({ retain: true }),
    );

    // Elevator Floors (Base State) - Index 43
    processPacket(stateManager, KOCOM_PACKETS[43]);
    // Expectation depends on mapping
  });

  it('should generate command packets', async () => {
    const ctx = await setupTest('kocom.homenet_bridge.yaml');

    // Command Close for gas_valve
    // Data: [0x30, 0xbc, 0x00, 0x2c, 0x00, 0x02, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]
    // Header: [0xAA, 0x55]
    // Footer: [0x0D, 0x0D]
    // Checksum: add_no_header (Sum of Data) = 0xEC + 0x2C + 0x02 = 0x11A -> 0x1A
    await executeCommand(ctx, 'gas_valve', 'close', null);

    const expectedClose = Buffer.from([
      0xaa, 0x55, 0x30, 0xbc, 0x00, 0x2c, 0x00, 0x02, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
      0x00, 0x00, 0x1a, 0x0d, 0x0d,
    ]);
    expect(ctx.mockSerialPort.write).toHaveBeenCalledWith(expectedClose);
  });
});

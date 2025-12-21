import { describe, it, expect } from 'vitest';
import { setupTest, processPacket, executeCommand } from './utils';
import { CVNET_PACKETS } from '../../../simulator/src/cvnet';
import { Buffer } from 'buffer';

describe('HomeNet to MQTT - CVNet Protocol', () => {
  it('should process CVNet packets and publish state', async () => {
    const ctx = await setupTest('cvnet.homenet_bridge.yaml');
    const { stateManager, publishMock } = ctx;

    // Room 0 Light 1 (ON) - Index 1
    processPacket(stateManager, CVNET_PACKETS[1]);

    expect(publishMock).toHaveBeenCalledWith(
      'homenet2mqtt/homedevice1/room_0_light_1/state',
      JSON.stringify({ state: 'ON' }),
      expect.objectContaining({ retain: true }),
    );

    // Room 0 Light 1 (OFF) - Index 2
    processPacket(stateManager, CVNET_PACKETS[2]);

    expect(publishMock).toHaveBeenCalledWith(
      'homenet2mqtt/homedevice1/room_0_light_1/state',
      JSON.stringify({ state: 'OFF' }),
      expect.objectContaining({ retain: true }),
    );

    // Fan 1 (ON) - Index 13
    processPacket(stateManager, CVNET_PACKETS[13]);
    expect(publishMock).toHaveBeenCalledWith(
      'homenet2mqtt/homedevice1/fan_1/state',
      expect.stringMatching(/"state":"ON"/),
      expect.objectContaining({ retain: true }),
    );

    // Fan 1 (Speed 1) - Index 15
    processPacket(stateManager, CVNET_PACKETS[15]);
    expect(publishMock).toHaveBeenCalledWith(
      'homenet2mqtt/homedevice1/fan_1/state',
      expect.stringMatching(/\"speed\":1/),
      expect.objectContaining({ retain: true }),
    );

    // Heater 1 (HEAT) - Index 19
    processPacket(stateManager, CVNET_PACKETS[19]);
    expect(publishMock).toHaveBeenCalledWith(
      'homenet2mqtt/homedevice1/heater_1/state',
      expect.stringMatching(/"mode":"heat"/),
      expect.objectContaining({ retain: true }),
    );

    // Heater 1 (Temp 25C/26C) - Index 20
    processPacket(stateManager, CVNET_PACKETS[20]);
    expect(publishMock).toHaveBeenCalledWith(
      'homenet2mqtt/homedevice1/heater_1/state',
      expect.stringMatching(/\"current_temperature\":25/),
      expect.objectContaining({ retain: true }),
    );

    // Gas Valve (OPEN) - Index 34
    processPacket(stateManager, CVNET_PACKETS[34]);
    expect(publishMock).toHaveBeenCalledWith(
      'homenet2mqtt/homedevice1/gas_valve/state',
      expect.stringMatching(/\"state\":\"OPEN\"/),
      expect.objectContaining({ retain: true }),
    );

    // Elevator Floors (Base State - just to check parsing) - Index 36
    processPacket(stateManager, CVNET_PACKETS[36]);
  });

  it('should generate command packets', async () => {
    const ctx = await setupTest('cvnet.homenet_bridge.yaml');

    // Command ON for room_0_light_1
    // Data: [0x20, 0x21, 0x01, 0x11, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]
    // Checksum: Add (no header) -> 0x54
    // Header: F7, Footer: AA
    await executeCommand(ctx, 'room_0_light_1', 'on', null);
    const expectedLight = Buffer.from([
      0xf7, 0x20, 0x21, 0x01, 0x11, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x54, 0xaa,
    ]);
    expect(ctx.mockSerialPort.write).toHaveBeenCalledWith(expectedLight);

    // Command ON for fan_1
    // Data: [0x20, 0x71, 0x01, 0x11, 0x01, 0x01, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00]
    // Checksum: Add (no header) -> 0xA6
    // Header: F7, Footer: AA
    await executeCommand(ctx, 'fan_1', 'on', null);
    const expectedFan = Buffer.from([
      0xf7, 0x20, 0x71, 0x01, 0x11, 0x01, 0x01, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0xa6, 0xaa,
    ]);
    expect(ctx.mockSerialPort.write).toHaveBeenCalledWith(expectedFan);
  });
});

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

  it('should generate command packets for all entities', async () => {
    const ctx = await setupTest('cvnet.homenet_bridge.yaml');

    // --- Lights ---
    // Room 0 Light 1
    await executeCommand(ctx, 'room_0_light_1', 'on', null);
    expect(ctx.mockSerialPort.write).toHaveBeenLastCalledWith(
      Buffer.from([
        0xf7, 0x20, 0x21, 0x01, 0x11, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x54, 0xaa,
      ]),
    );
    await executeCommand(ctx, 'room_0_light_1', 'off', null);
    expect(ctx.mockSerialPort.write).toHaveBeenLastCalledWith(
      Buffer.from([
        0xf7, 0x20, 0x21, 0x01, 0x11, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x53, 0xaa,
      ]),
    );

    // Room 0 Light 2
    await executeCommand(ctx, 'room_0_light_2', 'on', null);
    expect(ctx.mockSerialPort.write).toHaveBeenLastCalledWith(
      Buffer.from([
        0xf7, 0x20, 0x21, 0x01, 0x12, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x55, 0xaa,
      ]),
    );
    await executeCommand(ctx, 'room_0_light_2', 'off', null);
    expect(ctx.mockSerialPort.write).toHaveBeenLastCalledWith(
      Buffer.from([
        0xf7, 0x20, 0x21, 0x01, 0x12, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x54, 0xaa,
      ]),
    );

    // Room 0 Light 3
    await executeCommand(ctx, 'room_0_light_3', 'on', null);
    expect(ctx.mockSerialPort.write).toHaveBeenLastCalledWith(
      Buffer.from([
        0xf7, 0x20, 0x21, 0x01, 0x13, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x56, 0xaa,
      ]),
    );
    await executeCommand(ctx, 'room_0_light_3', 'off', null);
    expect(ctx.mockSerialPort.write).toHaveBeenLastCalledWith(
      Buffer.from([
        0xf7, 0x20, 0x21, 0x01, 0x13, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x55, 0xaa,
      ]),
    );

    // Room 1 Light 1
    await executeCommand(ctx, 'room_1_light_1', 'on', null);
    expect(ctx.mockSerialPort.write).toHaveBeenLastCalledWith(
      Buffer.from([
        0xf7, 0x20, 0x22, 0x01, 0x11, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x55, 0xaa,
      ]),
    );
    await executeCommand(ctx, 'room_1_light_1', 'off', null);
    expect(ctx.mockSerialPort.write).toHaveBeenLastCalledWith(
      Buffer.from([
        0xf7, 0x20, 0x22, 0x01, 0x11, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x54, 0xaa,
      ]),
    );

    // --- Fan ---
    await executeCommand(ctx, 'fan_1', 'on', null);
    expect(ctx.mockSerialPort.write).toHaveBeenLastCalledWith(
      Buffer.from([
        0xf7, 0x20, 0x71, 0x01, 0x11, 0x01, 0x01, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0xa6, 0xaa,
      ]),
    );
    await executeCommand(ctx, 'fan_1', 'off', null);
    expect(ctx.mockSerialPort.write).toHaveBeenLastCalledWith(
      Buffer.from([
        0xf7, 0x20, 0x71, 0x01, 0x11, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0xa3, 0xaa,
      ]),
    );
    // Speed command uses CEL: [[0x20, 0x71, 0x01, 0x02, x, 0x00, 0x00], [0x60, 0x71, 0x01, 0x02, x]]
    // Checksum: Add (no header). For x=2: 20+71+01+02+02+00+00 = 96 (hex)
    await executeCommand(ctx, 'fan_1', 'speed', 2);
    expect(ctx.mockSerialPort.write).toHaveBeenLastCalledWith(
      Buffer.from([0xf7, 0x20, 0x71, 0x01, 0x02, 0x02, 0x00, 0x00, 0x96, 0xaa]),
    );

    // --- Valve ---
    // Gas Valve (Close only)
    await executeCommand(ctx, 'gas_valve', 'close', null);
    expect(ctx.mockSerialPort.write).toHaveBeenLastCalledWith(
      Buffer.from([
        0xf7, 0x20, 0x11, 0x01, 0x11, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x43, 0xaa,
      ]),
    );

    // --- Button ---
    // Elevator Call
    await executeCommand(ctx, 'elevator_call', 'press', null);
    expect(ctx.mockSerialPort.write).toHaveBeenLastCalledWith(
      Buffer.from([
        0xf7, 0x20, 0x01, 0x81, 0x81, 0x02, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x25, 0xaa,
      ]),
    );

    // --- Climate (Heaters) ---
    // Heater 1
    // Test command_temperature (x=25)
    await executeCommand(ctx, 'heater_1', 'temperature', 25);
    expect(ctx.mockSerialPort.write).toHaveBeenLastCalledWith(
      Buffer.from([
        0xf7, 0x20, 0x41, 0x01, 0x11, 0x99, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x0c, 0xaa,
      ]),
    );

    // Test command_off (default temp 0)
    await executeCommand(ctx, 'heater_1', 'off', null);
    expect(ctx.mockSerialPort.write).toHaveBeenLastCalledWith(
      Buffer.from([
        0xf7, 0x20, 0x41, 0x01, 0x11, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x73, 0xaa,
      ]),
    );

    // Test command_heat (default temp 0 -> 0+0x80 = 0x80)
    await executeCommand(ctx, 'heater_1', 'heat', null);
    expect(ctx.mockSerialPort.write).toHaveBeenLastCalledWith(
      Buffer.from([
        0xf7, 0x20, 0x41, 0x01, 0x11, 0x80, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0xf3, 0xaa,
      ]),
    );

    // Heater 2 (Address 0x42)
    await executeCommand(ctx, 'heater_2', 'temperature', 20);
    expect(ctx.mockSerialPort.write).toHaveBeenLastCalledWith(
      Buffer.from([
        0xf7, 0x20, 0x42, 0x01, 0x11, 0x94, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x08, 0xaa,
      ]),
    );

    // Heater 3 (Address 0x43)
    await executeCommand(ctx, 'heater_3', 'temperature', 30);
    expect(ctx.mockSerialPort.write).toHaveBeenLastCalledWith(
      Buffer.from([
        0xf7, 0x20, 0x43, 0x01, 0x11, 0x9e, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x13, 0xaa,
      ]),
    );

    // Heater 4 (Address 0x44)
    await executeCommand(ctx, 'heater_4', 'temperature', 10);
    expect(ctx.mockSerialPort.write).toHaveBeenLastCalledWith(
      Buffer.from([
        0xf7, 0x20, 0x44, 0x01, 0x11, 0x8a, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0xaa,
      ]),
    );
  });
});

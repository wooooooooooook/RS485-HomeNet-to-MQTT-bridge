import { describe, it, expect } from 'vitest';
import { setupTest, processPacket, executeCommand } from './utils';
import { HYUNDAI_IMAZU_PACKETS } from '../../../simulator/src/hyundai_imazu';
import { Buffer } from 'buffer';

describe('HomeNet to MQTT - Hyundai Imazu Protocol', () => {
  it('should process light packets', async () => {
    const ctx = await setupTest('hyundai_imazu.homenet_bridge.yaml');
    const { stateManager, publishMock } = ctx;

    // Room 1 Light 2 (ON) - Index 4
    processPacket(stateManager, HYUNDAI_IMAZU_PACKETS[4]);

    expect(publishMock).toHaveBeenCalledWith(
      'homenet2mqtt/homedevice1/room_1_light_2/state',
      JSON.stringify({ state: 'ON' }),
      expect.objectContaining({ retain: true }),
    );

    // Light OFF test
    if (HYUNDAI_IMAZU_PACKETS[5]) {
      processPacket(stateManager, HYUNDAI_IMAZU_PACKETS[5]);
      expect(publishMock).toHaveBeenCalledWith(
        'homenet2mqtt/homedevice1/room_1_light_2/state',
        JSON.stringify({ state: 'OFF' }),
        expect.objectContaining({ retain: true }),
      );
    }
  });

  it('should process additional device packets', async () => {
    const ctx = await setupTest('hyundai_imazu.homenet_bridge.yaml');
    const { stateManager } = ctx;

    // Test other devices if available (heating, etc.)
    if (HYUNDAI_IMAZU_PACKETS[10]) {
      processPacket(stateManager, HYUNDAI_IMAZU_PACKETS[10]);
      // Add expectations based on device type
    }
  });

  it('should generate command packets', async () => {
    const ctx = await setupTest('hyundai_imazu.homenet_bridge.yaml');

    // Command ON for room_1_light_2
    // Data: [0x0b, 0x01, 0x19, 0x02, 0x40, 0x12, 0x01, 0x00]
    // Checksum: XOR (including header) -> 0xB5
    // Header: F7, Footer: EE
    await executeCommand(ctx, 'room_1_light_2', 'on', null);
    const expectedLight = Buffer.from([
      0xf7, 0x0b, 0x01, 0x19, 0x02, 0x40, 0x12, 0x01, 0x00, 0xb5, 0xee,
    ]);
    expect(ctx.mockSerialPort.write).toHaveBeenCalledWith(expectedLight);

    // Command ON for room_1_fan_1
    // Data: [0x0b, 0x01, 0x2b, 0x02, 0x40, 0x11, 0x01, 0x00]
    // Checksum: XOR -> 0x73 ^ 0xF7 = 0x84
    // Header: F7, Footer: EE
    await executeCommand(ctx, 'room_1_fan_1', 'on', null);
    const expectedFan = Buffer.from([
      0xf7, 0x0b, 0x01, 0x2b, 0x02, 0x40, 0x11, 0x01, 0x00, 0x84, 0xee,
    ]);
    expect(ctx.mockSerialPort.write).toHaveBeenCalledWith(expectedFan);
  });

  it('should generate fan speed command packets via CEL expression', async () => {
    const ctx = await setupTest('hyundai_imazu.homenet_bridge.yaml');

    // Test speed command with percentage value (33% -> level 1)
    // command_speed CEL: (x <= 33 ? [[0x0b, 0x01, 0x2b, 0x02, 0x42, 0x11, 0x01, 0x00], ...])
    ctx.mockSerialPort.write.mockClear();
    await executeCommand(ctx, 'room_1_fan_1', 'speed', 33);

    // Check if any packet was generated
    expect(ctx.mockSerialPort.write).toHaveBeenCalled();

    // Test speed command with percentage value (66% -> level 2)
    ctx.mockSerialPort.write.mockClear();
    await executeCommand(ctx, 'room_1_fan_1', 'speed', 66);

    // Test speed command with percentage value (100% -> level 3)
    ctx.mockSerialPort.write.mockClear();
    await executeCommand(ctx, 'room_1_fan_1', 'speed', 100);

    // Test speed 0
    ctx.mockSerialPort.write.mockClear();
    await executeCommand(ctx, 'room_1_fan_1', 'speed', 0);
    const speed0Call = ctx.mockSerialPort.write.mock.calls[0][0];
    // Currently expects it to be same as Speed 1 (0x42 ... 0x01)
    // 0xf7, 0x0b, 0x01, 0x2b, 0x02, 0x42, 0x11, 0x01, 0x00, ...
    expect(speed0Call[5]).toBe(0x42); // Check byte 5 is 0x42 (Speed command marker in Imazu?)
    expect(speed0Call[7]).toBe(0x01); // Check byte 7 is 0x01 (Level 1)
  });
});

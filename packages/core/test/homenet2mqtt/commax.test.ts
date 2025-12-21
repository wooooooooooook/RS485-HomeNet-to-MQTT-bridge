import { describe, it, expect } from 'vitest';
import { setupTest, processPacket, executeCommand } from './utils';
import { COMMAX_PACKETS } from '../../../simulator/src/commax';
import { Buffer } from 'buffer';

describe('HomeNet to MQTT - Commax Protocol', () => {
  it('should process light packets', async () => {
    const ctx = await setupTest('commax.homenet_bridge.yaml');
    const { stateManager, publishMock } = ctx;

    // Light Breaker (ON) - Index 4
    processPacket(stateManager, COMMAX_PACKETS[4]);

    expect(publishMock).toHaveBeenCalledWith(
      'homenet2mqtt/homedevice1/light_1/state',
      JSON.stringify({ state: 'ON' }),
      expect.objectContaining({ retain: true }),
    );

    // Light Breaker (OFF)
    if (COMMAX_PACKETS[5]) {
      processPacket(stateManager, COMMAX_PACKETS[5]);
      expect(publishMock).toHaveBeenCalledWith(
        'homenet2mqtt/homedevice1/light_1/state',
        JSON.stringify({ state: 'OFF' }),
        expect.objectContaining({ retain: true }),
      );
    }
  });

  it('should generate command packets', async () => {
    const ctx = await setupTest('commax.homenet_bridge.yaml');

    // Command ON for light_1
    // Expected: [0x31, 0x01, 0x01, 0x00, 0x00, 0x00, 0x00, 0x33] (Sum 0x33)
    await executeCommand(ctx, 'light_1', 'on', null);

    const expectedOn = Buffer.from([0x31, 0x01, 0x01, 0x00, 0x00, 0x00, 0x00, 0x33]);
    expect(ctx.mockSerialPort.write).toHaveBeenCalledWith(expectedOn);

    // Command OFF for light_1
    // Expected: [0x31, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x32] (Sum 0x32)
    await executeCommand(ctx, 'light_1', 'off', null);

    const expectedOff = Buffer.from([0x31, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x32]);
    expect(ctx.mockSerialPort.write).toHaveBeenCalledWith(expectedOff);

    // Command Speed 1 for fan_1
    // Data: [0x78, 0x01, 0x02, 0x01, 0x00, 0x00, 0x00]
    // Checksum: 0x78+0x01+0x02+0x01 = 0x7C
    await executeCommand(ctx, 'fan_1', 'speed', 1);
    const expectedFan = Buffer.from([0x78, 0x01, 0x02, 0x01, 0x00, 0x00, 0x00, 0x7c]);
    expect(ctx.mockSerialPort.write).toHaveBeenCalledWith(expectedFan);

    // Command Temperature 25 for heater_1
    // Data: [0x04, 0x01, 0x03, 0x25, 0x00, 0x00, 0x00] (25 -> BCD 0x25)
    // Checksum: 0x04+0x01+0x03+0x25 = 0x2D
    await executeCommand(ctx, 'heater_1', 'temperature', 25);
    const expectedTemp = Buffer.from([0x04, 0x01, 0x03, 0x25, 0x00, 0x00, 0x00, 0x2d]);
    expect(ctx.mockSerialPort.write).toHaveBeenCalledWith(expectedTemp);
  });

  it('should process other device packets', async () => {
    const { stateManager } = await setupTest('commax.homenet_bridge.yaml');

    // Test heating or other devices if available
    if (COMMAX_PACKETS[10]) {
      processPacket(stateManager, COMMAX_PACKETS[10]);
      // Add appropriate expectations based on packet content
    }
  });
});

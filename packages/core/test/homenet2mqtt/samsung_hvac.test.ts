import { describe, it, expect } from 'vitest';
import { setupTest, processPacket } from './utils.js';

describe('HomeNet to MQTT - Samsung HVAC NonNASA Protocol', () => {
  it('should process indoor unit Cmd20 climate packets correctly', async () => {
    const ctx = await setupTest('samsung_hvac.homenet_bridge.yaml');
    const { stateManager, publishMock } = ctx;

    // Frame: 0x32 (Start), SRC=0x20 (Indoor 1), DST=0xC8 (Outdoor), CMD=0x20 (Cmd20)
    // Target temp: 24°C -> 79 (0x4F)
    // Room temp: 22°C -> 77 (0x4D)
    // Pipe in: 20°C -> 75 (0x4B)
    // High fan = 5 (0x05)
    // Power ON | Heat mode = 0x81
    const dataBytes = [0x20, 0xc8, 0x20, 0x4f, 0x4d, 0x4b, 0x05, 0x81, 0x00, 0x00, 0x4b];
    const crc = dataBytes.reduce((acc, b) => acc ^ b, 0);
    const packet = Buffer.from([0x32, ...dataBytes, crc, 0x34]);

    processPacket(stateManager, packet);

    expect(publishMock).toHaveBeenCalledWith(
      'homenet2mqtt/homedevice1/hvac_1/state',
      JSON.stringify({
        target_temperature: 24,
        current_temperature: 22,
        mode: 'heat',
        fan_mode: 'high',
      }),
      expect.objectContaining({ retain: true }),
    );
  });

  it('should process outdoor unit CmdC0 temperature sensor packet', async () => {
    const ctx = await setupTest('samsung_hvac.homenet_bridge.yaml');
    const { stateManager, publishMock } = ctx;

    // Frame: SRC=0xC8 (Outdoor), DST=0xD0, CMD=0xC0
    // Outdoor temp: 15°C -> 70 (0x46)
    const dataBytes = [0xc8, 0xd0, 0xc0, 0x00, 0x00, 0x00, 0x00, 0x46, 0x00, 0x00, 0x00];
    const crc = dataBytes.reduce((a, b) => a ^ b, 0);
    const packet = Buffer.from([0x32, ...dataBytes, crc, 0x34]);

    processPacket(stateManager, packet);

    expect(publishMock).toHaveBeenCalledWith(
      'homenet2mqtt/homedevice1/outdoor_temperature/state',
      JSON.stringify({ value: 15, number: 15 }),
      expect.objectContaining({ retain: true }),
    );
  });
});

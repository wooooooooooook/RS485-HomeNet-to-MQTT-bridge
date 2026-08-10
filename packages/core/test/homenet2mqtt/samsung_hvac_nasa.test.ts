import { describe, it, expect } from 'vitest';
import { setupTest, processPacket } from './utils.js';

describe('HomeNet to MQTT - Samsung HVAC NASA Protocol', () => {
  function computeNasaCrc16(data: number[]): [number, number] {
    let crc = 0;
    for (let i = 3; i < data.length - 3; i++) {
      crc = crc ^ (data[i] << 8);
      for (let j = 0; j < 8; j++) {
        if (crc & 0x8000) {
          crc = ((crc << 1) ^ 0x1021) & 0xffff;
        } else {
          crc = (crc << 1) & 0xffff;
        }
      }
    }
    return [(crc >> 8) & 0xff, crc & 0xff];
  }

  it('should process indoor unit NASA target temperature packet', async () => {
    const ctx = await setupTest('samsung_hvac_nasa.homenet_bridge.yaml');
    const { stateManager, publishMock } = ctx;

    const rawPacket = [
      0x32, 0x00, 0x12, 0x20, 0x00, 0x01, 0x80, 0xff, 0x00, 0xc0, 0x14, 0x01, 0x01, 0x42, 0x01,
      0x00, 0xf0, 0x00, 0x00, 0x34,
    ];
    const [crcHi, crcLo] = computeNasaCrc16(rawPacket);
    rawPacket[17] = crcHi;
    rawPacket[18] = crcLo;

    const packet = Buffer.from(rawPacket);

    processPacket(stateManager, packet);

    expect(publishMock).toHaveBeenCalledWith(
      'homenet2mqtt/homedevice1/hvac_1/state',
      JSON.stringify({ target_temperature: 24 }),
      expect.objectContaining({ retain: true }),
    );
  });

  it('should process outdoor unit NASA outdoor temperature sensor packet', async () => {
    const ctx = await setupTest('samsung_hvac_nasa.homenet_bridge.yaml');
    const { stateManager, publishMock } = ctx;

    const rawPacket = [
      0x32, 0x00, 0x12, 0x10, 0x00, 0x00, 0x80, 0xff, 0x00, 0xc0, 0x14, 0x01, 0x01, 0x82, 0x01,
      0x00, 0x96, 0x00, 0x00, 0x34,
    ];
    const [crcHi, crcLo] = computeNasaCrc16(rawPacket);
    rawPacket[17] = crcHi;
    rawPacket[18] = crcLo;

    const packet = Buffer.from(rawPacket);

    processPacket(stateManager, packet);

    expect(publishMock).toHaveBeenCalledWith(
      'homenet2mqtt/homedevice1/outdoor_temperature/state',
      JSON.stringify({ value: 15, number: 15 }),
      expect.objectContaining({ retain: true }),
    );
  });
});

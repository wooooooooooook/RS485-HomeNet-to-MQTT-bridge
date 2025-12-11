import { describe, it, expect } from 'vitest';
import { setupTest, processPacket, publishMock } from './utils';
import { SAMSUNG_SDS_PACKETS } from '../../../simulator/src/samsung_sds';

describe('HomeNet to MQTT - Samsung SDS Protocol', () => {
  it('should process light packets', async () => {
    const { stateManager } = await setupTest('samsung_sds.homenet_bridge.yaml');

    // Light 1 ON - AC protocol - Index 1
    // 참고: AC 79 00 GR PT -> B0 79 RN BM PT 형태
    processPacket(stateManager, SAMSUNG_SDS_PACKETS[1]);

    expect(publishMock).toHaveBeenCalledWith(
      'homenet2mqtt/homedevice1/light_1/state',
      JSON.stringify({ state: 'ON' }),
      expect.objectContaining({ retain: true }),
    );

    // Light OFF - Index 2
    processPacket(stateManager, SAMSUNG_SDS_PACKETS[2]);
    expect(publishMock).toHaveBeenCalledWith(
      'homenet2mqtt/homedevice1/light_1/state',
      JSON.stringify({ state: 'OFF' }),
      expect.objectContaining({ retain: true }),
    );
  });

  it('should process ventilator packets', async () => {
    const { stateManager } = await setupTest('samsung_sds.homenet_bridge.yaml');

    // Ventilator OFF - C2 protocol - Index 14
    // 참고: C2 4E 00 00 00 PT -> B0 4E XX MM YY PT 형태
    processPacket(stateManager, SAMSUNG_SDS_PACKETS[14]);
    expect(publishMock).toHaveBeenCalledWith(
      'homenet2mqtt/homedevice1/ventilator/state',
      JSON.stringify({ speed: 0, state: 'OFF' }),
      expect.objectContaining({ retain: true }),
    );
  });

  it('should process heating packets', async () => {
    const { stateManager } = await setupTest('samsung_sds.homenet_bridge.yaml');

    // Room heater state - AE protocol - Index 18
    // 참고: AE 7C GR 00 00 00 00 PT -> B0 7C GR TG XX YY FF 32 형태
    // XX: 설정온도, YY: 현재온도 (16진수)
    // Packet: [0xb0, 0x7c, 0x01, 0x00, 0x1a, 0x19, 0xce]
    // Offset 3 = 0x1a (26) = target temp, Offset 4 = 0x19 (25) = current temp
    processPacket(stateManager, SAMSUNG_SDS_PACKETS[18]);

    expect(publishMock).toHaveBeenCalledWith(
      'homenet2mqtt/homedevice1/room_0_heater/state',
      JSON.stringify({
        action: 'off',
        current_temperature: 25,
        target_temperature: 26,
        mode: 'off',
      }),
      expect.objectContaining({ retain: true }),
    );
  });
});

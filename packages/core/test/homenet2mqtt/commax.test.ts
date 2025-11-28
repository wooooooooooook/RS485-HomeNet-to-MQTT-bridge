import { describe, it, expect } from 'vitest';
import { setupTest, processPacket, publishMock } from './utils';
import { COMMAX_PACKETS } from '../../../simulator/src/commax';

describe('HomeNet to MQTT - Commax Protocol', () => {
  it('should process light packets', async () => {
    const { stateManager } = await setupTest('commax.homenet_bridge.yaml');

    // Light Breaker (ON) - Index 4
    processPacket(stateManager, COMMAX_PACKETS[4]);

    expect(publishMock).toHaveBeenCalledWith(
      'homenet/light_1/state',
      JSON.stringify({ state: 'ON' }),
      expect.objectContaining({ retain: true }),
    );

    // Light Breaker (OFF)
    if (COMMAX_PACKETS[5]) {
      processPacket(stateManager, COMMAX_PACKETS[5]);
      expect(publishMock).toHaveBeenCalledWith(
        'homenet/light_1/state',
        JSON.stringify({ state: 'OFF' }),
        expect.objectContaining({ retain: true }),
      );
    }
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

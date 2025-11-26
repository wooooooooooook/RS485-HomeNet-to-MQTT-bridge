import { describe, it, expect } from 'vitest';
import { setupTest, processPacket, publishMock } from './utils';
import { HYUNDAI_IMAZU_PACKETS } from '../../../simulator/src/hyundai_imazu';

describe('HomeNet to MQTT - Hyundai Imazu Protocol', () => {
    it('should process light packets', async () => {
        const { stateManager } = await setupTest('hyundai_imazu.homenet_bridge.yaml');

        // Room 1 Light 2 (ON) - Index 4
        processPacket(stateManager, HYUNDAI_IMAZU_PACKETS[4]);

        expect(publishMock).toHaveBeenCalledWith(
            'homenet/room_1_light_2/state',
            JSON.stringify({ state: 'ON' }),
            expect.objectContaining({ retain: true })
        );

        // Light OFF test
        if (HYUNDAI_IMAZU_PACKETS[5]) {
            processPacket(stateManager, HYUNDAI_IMAZU_PACKETS[5]);
            expect(publishMock).toHaveBeenCalledWith(
                'homenet/room_1_light_2/state',
                JSON.stringify({ state: 'OFF' }),
                expect.objectContaining({ retain: true })
            );
        }
    });

    it('should process additional device packets', async () => {
        const { stateManager } = await setupTest('hyundai_imazu.homenet_bridge.yaml');

        // Test other devices if available (heating, etc.)
        if (HYUNDAI_IMAZU_PACKETS[10]) {
            processPacket(stateManager, HYUNDAI_IMAZU_PACKETS[10]);
            // Add expectations based on device type
        }
    });
});

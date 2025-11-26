import { describe, it, expect } from 'vitest';
import { setupTest, processPacket, publishMock } from './utils';
import { EZVILLE_PACKETS } from '../../../simulator/src/ezville';

describe('HomeNet to MQTT - Ezville Protocol', () => {
    it('should process Ezville packets and publish state', async () => {
        const { stateManager } = await setupTest('ezville.homenet_bridge.yaml');

        // light_1_0 (ON) - Index 4
        // Note: The simulator labels this as light_1_0, but the config/logic maps it to light_1_1
        processPacket(stateManager, EZVILLE_PACKETS[4]);

        expect(publishMock).toHaveBeenCalledWith(
            'homenet/light_1_1/state',
            JSON.stringify({ state: 'ON' }),
            expect.objectContaining({ retain: true })
        );

        // thermostat 1 (HEAT) - Index 29
        processPacket(stateManager, EZVILLE_PACKETS[29]);
        expect(publishMock).toHaveBeenCalledWith(
            'homenet/thermostat_1/state',
            expect.stringMatching(/"mode":"heat"/),
            expect.objectContaining({ retain: true })
        );

        // Gas Valve (OPEN) - Index 40
        processPacket(stateManager, EZVILLE_PACKETS[40]);
        expect(publishMock).toHaveBeenCalledWith(
            'homenet/gas_valve/state',
            JSON.stringify({ state: 'OPEN' }),
            expect.objectContaining({ retain: true })
        );

        // outlet_1_1 (ON) - Index 43
        processPacket(stateManager, EZVILLE_PACKETS[43]);
        expect(publishMock).toHaveBeenCalledWith(
            'homenet/outlet_1_1/state',
            JSON.stringify({ state: 'ON' }),
            expect.objectContaining({ retain: true })
        );
    });
});

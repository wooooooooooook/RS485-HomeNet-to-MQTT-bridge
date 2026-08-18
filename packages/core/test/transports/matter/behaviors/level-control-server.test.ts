import { describe, it, expect, vi } from 'vitest';
import { LevelControlServer } from '../../../../src/transports/matter/behaviors/level-control-server.js';
import { HomenetEntityBehavior } from '../../../../src/transports/matter/behaviors/homenet-entity-behavior.js';

vi.mock('../../../../src/transports/matter/behaviors/homenet-entity-behavior.js', () => ({
  HomenetEntityBehavior: class {
    static id = 'homenetEntity';
  },
}));

describe('LevelControlServer', () => {
  it('does not re-read an expired Homenet entityState after a level command', async () => {
    const state: any = { minLevel: 1, maxLevel: 254, currentLevel: 10 };
    const mockHomenet: any = {
      entityId: 'light_1',
      executeCommand: vi.fn().mockImplementation(async () => {
        Object.defineProperty(mockHomenet, 'entityState', {
          get: () => {
            throw new Error('ExpiredReferenceError');
          },
        });
        return { success: true };
      }),
    };
    const agent = {
      load: vi.fn().mockResolvedValue(mockHomenet),
    };

    const server: any = Object.create(LevelControlServer.prototype);
    Object.defineProperty(server, 'state', { get: () => state });
    Object.defineProperty(server, 'agent', { get: () => agent });

    await server.moveToLevelLogic(128);

    expect(mockHomenet.executeCommand).toHaveBeenCalledWith(
      'light_1',
      'brightness',
      expect.any(Number),
    );
    expect(state.currentLevel).toBe(128);
  });
});

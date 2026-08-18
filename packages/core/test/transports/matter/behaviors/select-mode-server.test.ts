import { describe, it, expect, vi } from 'vitest';
import { SelectModeServer } from '../../../../src/transports/matter/behaviors/select-mode-server.js';
import { HomenetEntityBehavior } from '../../../../src/transports/matter/behaviors/homenet-entity-behavior.js';

vi.mock('../../../../src/transports/matter/behaviors/homenet-entity-behavior.js', () => ({
  HomenetEntityBehavior: class {
    static id = 'homenetEntity';
  },
}));

describe('SelectModeServer', () => {
  it('does not re-read an expired Homenet entityState after mode command', async () => {
    const state: any = { currentMode: 0 };
    const mockHomenet: any = {
      entityId: 'mode_1',
      entityConfig: { options: ['AUTO', 'LOW', 'HIGH'] },
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
      get: vi.fn().mockReturnValue(mockHomenet),
    };

    const server: any = Object.create(SelectModeServer.prototype);
    Object.defineProperty(server, 'state', { get: () => state });
    Object.defineProperty(server, 'agent', { get: () => agent });

    await server.changeToMode({ newMode: 2 });

    expect(mockHomenet.executeCommand).toHaveBeenCalledWith('mode_1', 'select', 'HIGH');
    expect(state.currentMode).toBe(2);
  });

  it('reconciles the optimistic mode when Homenet reports a different option', () => {
    const state: any = { currentMode: 2 };
    const mockHomenet: any = {
      entityConfig: { options: ['AUTO', 'LOW', 'HIGH'] },
    };
    const server: any = Object.create(SelectModeServer.prototype);
    Object.defineProperty(server, 'state', { get: () => state });
    Object.defineProperty(server, 'agent', {
      get: () => ({ get: vi.fn().mockReturnValue(mockHomenet) }),
    });

    server.update({ state: 'LOW' });

    expect(state.currentMode).toBe(1);
  });
});

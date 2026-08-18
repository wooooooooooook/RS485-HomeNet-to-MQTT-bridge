import { describe, it, expect, vi } from 'vitest';
import { DoorLock } from '@matter/main/clusters';
import { LockServer } from '../../../../src/transports/matter/behaviors/lock-server.js';
import { HomenetEntityBehavior } from '../../../../src/transports/matter/behaviors/homenet-entity-behavior.js';

vi.mock('../../../../src/transports/matter/behaviors/homenet-entity-behavior.js', () => ({
  HomenetEntityBehavior: class {
    static id = 'homenetEntity';
  },
}));

vi.mock('../../../../src/transports/matter/utils/apply-patch-state.js', () => ({
  applyPatchState: vi.fn((state, patch) => Object.assign(state, patch)),
}));

describe('LockServer', () => {
  it('does not re-read an expired Homenet entityState after lock command', async () => {
    const state: any = {};
    const mockHomenet: any = {
      entityId: 'lock_1',
      executeCommand: vi.fn().mockImplementation(async () => {
        Object.defineProperty(mockHomenet, 'entityState', {
          get: () => {
            throw new Error('ExpiredReferenceError');
          },
        });
        return { success: true };
      }),
    };
    const agent = { load: vi.fn().mockResolvedValue(mockHomenet) };

    const server: any = Object.create(LockServer.prototype);
    Object.defineProperty(server, 'state', { get: () => state });
    Object.defineProperty(server, 'agent', { get: () => agent });

    await server.lockDoor();

    expect(mockHomenet.executeCommand).toHaveBeenCalledWith('lock_1', 'lock');
    expect(state.lockState).toBe(DoorLock.LockState.Locked);
  });

  it('does not re-read an expired Homenet entityState after unlock command', async () => {
    const state: any = {};
    const mockHomenet: any = {
      entityId: 'lock_1',
      executeCommand: vi.fn().mockImplementation(async () => {
        Object.defineProperty(mockHomenet, 'entityState', {
          get: () => {
            throw new Error('ExpiredReferenceError');
          },
        });
        return { success: true };
      }),
    };
    const agent = { load: vi.fn().mockResolvedValue(mockHomenet) };

    const server: any = Object.create(LockServer.prototype);
    Object.defineProperty(server, 'state', { get: () => state });
    Object.defineProperty(server, 'agent', { get: () => agent });

    await server.unlockDoor();

    expect(mockHomenet.executeCommand).toHaveBeenCalledWith('lock_1', 'unlock');
    expect(state.lockState).toBe(DoorLock.LockState.Unlocked);
  });

  it('reconciles the optimistic lock state when Homenet reports unlocked', () => {
    const state: any = { lockState: DoorLock.LockState.Locked };
    const server: any = Object.create(LockServer.prototype);
    Object.defineProperty(server, 'state', { get: () => state });

    server.update({ state: 'UNLOCKED' });

    expect(state.lockState).toBe(DoorLock.LockState.Unlocked);
  });
});

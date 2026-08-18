// packages/core/src/transports/matter/behaviors/lock-server.ts

import { DoorLockServer as Base } from '@matter/main/behaviors';
import { DoorLock } from '@matter/main/clusters';
import { applyPatchState } from '../utils/apply-patch-state.js';
import { HomenetEntityBehavior } from './homenet-entity-behavior.js';

import LockState = DoorLock.LockState;

export class LockServer extends Base {
  override async initialize() {
    await super.initialize();
    const homenet = await this.agent.load(HomenetEntityBehavior);
    this.update(homenet.entityState);
    this.reactTo(homenet.onChange, this.update, { offline: true });
  }

  private update(entityState: any) {
    const stateVal = entityState?.state;

    let lockState = LockState.Unlocked;
    if (stateVal === 'LOCKED' || stateVal === 'LOCKING') {
      lockState = LockState.Locked;
    } else if (stateVal === 'JAMMED') {
      lockState = LockState.NotFullyLocked;
    }

    applyPatchState(this.state, {
      lockState,
      lockType: DoorLock.LockType.DeadBolt,
      operatingMode: DoorLock.OperatingMode.Normal,
      actuatorEnabled: true,
      // Matter DoorLock bitmap: true = mode NOT supported (inverted semantics)
      supportedOperatingModes: {
        noRemoteLockUnlock: true,
        normal: false, // false = supported
        passage: true,
        privacy: true,
        vacation: true,
        // AlwaysSet (bits 5-15) is mandatory per the Matter spec; matter.js
        // requires supportedOperatingModes.alwaysSet to be 2047.
        alwaysSet: 2047,
      },
    });
  }

  override async lockDoor() {
    // Set lockState immediately for instant UI feedback. Do not re-read
    // homenet.entityState after the command because the entity reference may
    // be stale/expired by then; Homenet onChange performs reconciliation.
    applyPatchState(this.state, { lockState: LockState.Locked });
    const homenet = await this.agent.load(HomenetEntityBehavior);
    await homenet.executeCommand(homenet.entityId, 'lock');
  }

  override async unlockDoor() {
    // Set lockState immediately for instant UI feedback. Do not re-read
    // homenet.entityState after the command because the entity reference may
    // be stale/expired by then; Homenet onChange performs reconciliation.
    applyPatchState(this.state, { lockState: LockState.Unlocked });
    const homenet = await this.agent.load(HomenetEntityBehavior);
    await homenet.executeCommand(homenet.entityId, 'unlock');
  }
}
export namespace LockServer {
  export class State extends Base.State {}
}

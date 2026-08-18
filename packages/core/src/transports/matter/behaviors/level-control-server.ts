// packages/core/src/transports/matter/behaviors/level-control-server.ts

import { LevelControlServer as Base } from '@matter/main/behaviors';
import { LevelControl } from '@matter/main/clusters';
import { applyPatchState } from '../utils/apply-patch-state.js';
import { HomenetEntityBehavior } from './homenet-entity-behavior.js';

const FeaturedBase = Base.with('OnOff', 'Lighting');

export class LevelControlServer extends FeaturedBase {
  override async initialize() {
    // Set default values BEFORE super.initialize() to prevent validation errors.
    if (this.state.currentLevel == null) {
      this.state.currentLevel = 1;
    }
    if (this.state.minLevel == null) {
      this.state.minLevel = 1;
    }
    if (this.state.maxLevel == null) {
      this.state.maxLevel = 254;
    }
    // Force onLevel to null so the base class's handleOnOffChange never
    // overwrites currentLevel when the device turns on.
    this.state.onLevel = null;

    await super.initialize();
    const homenet = await this.agent.load(HomenetEntityBehavior);
    this.update(homenet.entityState);
    this.reactTo(homenet.onChange, this.update, { offline: true });
  }

  private update(entityState: any) {
    const brightness = entityState?.brightness; // 0-255
    const minLevel = 1;
    const maxLevel = 254;

    if (typeof brightness === 'number') {
      const percent = brightness / 255;
      const currentLevel = Math.min(
        maxLevel,
        Math.max(minLevel, Math.round(percent * (maxLevel - minLevel)) + minLevel),
      );

      applyPatchState(this.state, {
        minLevel,
        maxLevel,
        currentLevel,
      });
    }
  }

  override async moveToLevel(request: LevelControl.MoveToLevelRequest) {
    if (request.transitionTime == null) {
      request.transitionTime = 0;
    }
    return super.moveToLevel(request);
  }

  override async moveToLevelWithOnOff(request: LevelControl.MoveToLevelRequest) {
    if (request.transitionTime == null) {
      request.transitionTime = 0;
    }
    return super.moveToLevelWithOnOff(request);
  }

  override step(request: LevelControl.StepRequest) {
    if (request.transitionTime == null) {
      request.transitionTime = 0;
    }
    return super.step(request);
  }

  override stepWithOnOff(request: LevelControl.StepRequest) {
    if (request.transitionTime == null) {
      request.transitionTime = 0;
    }
    return super.stepWithOnOff(request);
  }

  override async moveToLevelLogic(level: number) {
    const minLevel = this.state.minLevel ?? 1;
    const maxLevel = this.state.maxLevel ?? 254;

    const percent = (level - minLevel) / (maxLevel - minLevel);
    const brightness = Math.min(255, Math.max(0, Math.round(percent * 255)));

    // Update currentLevel immediately so controllers get instant feedback.
    // Do not re-read homenet.entityState after executeCommand(): the entity
    // reference may be stale/expired by the time the command completes.
    this.state.currentLevel = level;

    const homenet = await this.agent.load(HomenetEntityBehavior);
    await homenet.executeCommand(homenet.entityId, 'brightness', brightness);
  }
}
export namespace LevelControlServer {
  export class State extends FeaturedBase.State {}
}

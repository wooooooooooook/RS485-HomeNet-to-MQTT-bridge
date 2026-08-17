// packages/core/src/transports/matter/behaviors/fan-control-server.ts

import { FanControlServer as Base } from '@matter/main/behaviors';
import { FanControl } from '@matter/main/clusters';
import { applyPatchState } from '../utils/apply-patch-state.js';
import { HomenetEntityBehavior } from './homenet-entity-behavior.js';

const FeaturedBase = Base.with('MultiSpeed', 'Step');

export class FanControlServer extends FeaturedBase {
  override async initialize() {
    await super.initialize();
    const homenet = await this.agent.load(HomenetEntityBehavior);
    this.update(homenet.entityState);
    this.reactTo(homenet.onChange, this.update, { offline: true });
    this.reactTo(this.events.speedSetting$Changed, this.targetSpeedSettingChanged, {
      offline: true,
    });
  }

  private update(entityState: any, entityConfig?: any) {
    const config = entityConfig ?? (this.agent.get(HomenetEntityBehavior).entityConfig as any);

    // Default steps is 3 (Low, Med, High)
    const speedMax = config.speed_range_max ?? 3;

    // Determine current speed (either 'speed' or 'percentage')
    // state = 'ON' | 'OFF'
    const stateVal = entityState?.state;
    const isOff = stateVal === 'OFF';

    const rawSpeed = entityState?.speed ?? entityState?.percentage ?? 0;

    let speedSetting = 0;
    if (!isOff && typeof rawSpeed === 'number') {
      if (rawSpeed > 3 && rawSpeed <= 100) {
        // percentage mode
        speedSetting = Math.ceil((rawSpeed / 100) * speedMax);
      } else {
        speedSetting = Math.round(rawSpeed);
      }
    }

    // Prevent speedSetting exceeding speedMax
    speedSetting = Math.min(speedMax, Math.max(0, speedSetting));

    let fanModeSequence = FanControl.FanModeSequence.OffLowMedHigh;
    if (speedMax === 1) {
      fanModeSequence = FanControl.FanModeSequence.OffHigh;
    } else if (speedMax === 2) {
      fanModeSequence = FanControl.FanModeSequence.OffLowHigh;
    }

    applyPatchState(this.state, {
      fanMode: speedSetting > 0 ? FanControl.FanMode.On : FanControl.FanMode.Off,
      speedMax: speedMax,
      speedSetting: speedSetting,
      speedCurrent: speedSetting,
      fanModeSequence,
    });
  }

  override async step(request: FanControl.StepRequest) {
    const speedMax = this.state.speedMax ?? 3;
    const lowestSpeed = request.lowestOff ? 0 : 1;
    const currentSpeed = this.state.speedSetting ?? this.state.speedCurrent ?? 0;
    const direction = request.direction;

    let nextSpeed =
      direction === FanControl.StepDirection.Increase ? currentSpeed + 1 : currentSpeed - 1;

    if (request.wrap) {
      if (nextSpeed > speedMax) {
        nextSpeed = lowestSpeed;
      } else if (nextSpeed < lowestSpeed) {
        nextSpeed = speedMax;
      }
    } else {
      nextSpeed = Math.min(speedMax, Math.max(lowestSpeed, nextSpeed));
    }

    await this.targetSpeedSettingChanged(nextSpeed);
  }

  private async targetSpeedSettingChanged(speed: number | null) {
    if (speed == null) return;
    const homenet = await this.agent.load(HomenetEntityBehavior);
    const config = { ...(homenet.entityConfig as any) };
    const entityId = homenet.entityId;
    const speedMax = config.speed_range_max ?? 3;

    // If target speed is 0, turn off the fan
    if (speed === 0) {
      await homenet.executeCommand(entityId, 'off');
      this.update({ state: 'OFF', speed: 0 }, config);
      return;
    }

    // Determine command mapping:
    // If the entity supports 'speed' command, send the speed number directly or map to percentage.
    // If fan uses percentage:
    const hasPercentage = config.command_percentage || config.state_percentage;
    if (hasPercentage) {
      const percent = Math.round((speed / speedMax) * 100);
      await homenet.executeCommand(entityId, 'percentage', percent);
      this.update({ state: 'ON', percentage: percent }, config);
    } else {
      await homenet.executeCommand(entityId, 'speed', speed);
      this.update({ state: 'ON', speed }, config);
    }
  }
}

export namespace FanControlServer {
  export class State extends FeaturedBase.State {}
}

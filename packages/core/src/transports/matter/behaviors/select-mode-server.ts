// packages/core/src/transports/matter/behaviors/select-mode-server.ts

import { ModeSelectServer as Base } from '@matter/main/behaviors';
import { applyPatchState } from '../utils/apply-patch-state.js';
import { HomenetEntityBehavior } from './homenet-entity-behavior.js';

export class SelectModeServer extends Base {
  override async initialize() {
    await super.initialize();
    const homenet = await this.agent.load(HomenetEntityBehavior);

    // Config 에서 options 를 파싱하여 supportedModes 를 빌드
    const config = homenet.entityConfig as any;
    const options = config.options ?? [];

    const modes = options.map((opt: string, idx: number) => ({
      label: opt,
      mode: idx,
      semanticTags: [],
    }));

    applyPatchState(this.state, {
      supportedModes: modes,
    });

    this.update(homenet.entityState);
    this.reactTo(homenet.onChange, this.update, { offline: true });
  }

  private update(entityState: any) {
    const value = entityState?.state ?? entityState?.option;
    const homenet = this.agent.get(HomenetEntityBehavior);
    const config = homenet.entityConfig as any;
    const options = config.options ?? [];

    const idx = options.indexOf(String(value));
    if (idx !== -1) {
      applyPatchState(this.state, {
        currentMode: idx,
      });
    }
  }

  override async changeToMode({ newMode }: { newMode: number }) {
    const homenet = await this.agent.load(HomenetEntityBehavior);
    const config = homenet.entityConfig as any;
    const options = config.options ?? [];

    const option = options[newMode];
    if (option !== undefined) {
      // Optimistic Matter update. Do not re-read homenet.entityState after
      // executeCommand(); Homenet onChange performs reconciliation.
      this.state.currentMode = newMode;
      await homenet.executeCommand(homenet.entityId, 'select', option);
    }
  }
}

export namespace SelectModeServer {
  export class State extends Base.State {}
}
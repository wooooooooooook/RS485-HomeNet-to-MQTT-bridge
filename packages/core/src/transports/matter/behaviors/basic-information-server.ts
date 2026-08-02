// packages/core/src/transports/matter/behaviors/basic-information-server.ts

import crypto from 'node:crypto';
import { VendorId } from '@matter/main';
import { BridgedDeviceBasicInformationServer as Base } from '@matter/main/behaviors';
import { applyPatchState } from '../utils/apply-patch-state.js';
import { trimToLength } from '../utils/trim-to-length.js';
import { HomenetEntityBehavior } from './homenet-entity-behavior.js';

export class BasicInformationServer extends Base {
  override async initialize(): Promise<void> {
    await super.initialize();
    const homenet = await this.agent.load(HomenetEntityBehavior);
    this.update(homenet.entityConfig, homenet.entityState);
    this.reactTo(homenet.onChange, this.updateStateOnly, { offline: true });
  }

  private updateStateOnly(entityState: any) {
    const homenet = this.agent.get(HomenetEntityBehavior);
    this.update(homenet.entityConfig, entityState);
  }

  private update(config: any, entityState: Record<string, any>) {
    const friendlyName = config.name || config.id;
    const model = config.device || 'Homenet Device';

    applyPatchState(this.state, {
      vendorId: VendorId(0xfff1),
      vendorName: 'rs485-homenet',
      productName: trimToLength(model, 32) || 'Homenet Bridge Device',
      productLabel: trimToLength(friendlyName, 64),
      nodeLabel: trimToLength(friendlyName, 32),
      reachable: entityState != null && entityState.state !== 'unavailable',
      serialNumber: crypto.createHash('md5').update(config.id).digest('hex').substring(0, 32),
      uniqueId: crypto.createHash('md5').update(config.id).digest('hex').substring(0, 32),
      hardwareVersion: 1,
      softwareVersion: 1,
      hardwareVersionString: '1.0',
      softwareVersionString: '1.0',
    });
  }
}
export namespace BasicInformationServer {
  export class State extends Base.State {}
}

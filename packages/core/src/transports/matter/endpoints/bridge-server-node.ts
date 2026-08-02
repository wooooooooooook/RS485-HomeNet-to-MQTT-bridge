// packages/core/src/transports/matter/endpoints/bridge-server-node.ts

import crypto from 'node:crypto';
import type { Environment } from '@matter/main';
import { type Endpoint, ServerNode } from '@matter/main/node';
import { VendorId } from '@matter/main/types';
import { trimToLength } from '../utils/trim-to-length.js';

export interface BridgeServerNodeOptions {
  id: string;
  name: string;
  port?: number;
  passcode?: number;
  discriminator?: number;
  vendorId?: number;
  productId?: number;
  productName?: string;
}

export class BridgeServerNode extends ServerNode {
  constructor(env: Environment, options: BridgeServerNodeOptions, aggregator: Endpoint) {
    const name = options.name || 'Homenet Matter Bridge';
    const id = options.id || 'homenet_bridge';

    super({
      type: ServerNode.RootEndpoint,
      id,
      environment: env,
      network: {
        port: options.port ?? 5540,
      },
      commissioning: {
        passcode: options.passcode ?? -1,
        discriminator: options.discriminator ?? -1,
      },
      productDescription: {
        name,
        deviceType: aggregator.type.deviceType,
      },
      basicInformation: {
        uniqueId: id,
        nodeLabel: trimToLength(name, 32) || 'Homenet Bridge',
        vendorId: VendorId(options.vendorId ?? 0xfff1),
        vendorName: 'rs485-homenet',
        productId: options.productId ?? 0x8000,
        productName:
          trimToLength(options.productName ?? 'Homenet Bridge', 32) || 'Homenet Matter Bridge',
        productLabel: trimToLength(name, 64),
        serialNumber: crypto
          .createHash('md5')
          .update(`serial-${id}`)
          .digest('hex')
          .substring(0, 32),
        hardwareVersion: 1,
        softwareVersion: 1,
        hardwareVersionString: '1.0',
        softwareVersionString: '1.0',
      },
      parts: [aggregator],
    });
  }

  async factoryReset() {
    await this.cancel();
    await this.erase();
  }
}

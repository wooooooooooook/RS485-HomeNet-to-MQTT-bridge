// packages/core/src/index.ts
import dotenv from 'dotenv';
import { HomeNetBridge } from './service/bridge.service.js';
import type { BridgeOptions } from './service/bridge.service.js';
import { logger } from './utils/logger.js';
import { eventBus } from './service/event-bus.js';
import type { HomenetBridgeConfig, LambdaConfig } from './config/types.js';

dotenv.config();

export { HomeNetBridge, BridgeOptions, logger, eventBus, HomenetBridgeConfig, LambdaConfig };

export async function createBridge(
  configPath: string,
  mqttUrl: string,
  mqttUsername?: string,
  mqttPassword?: string,
) {
  const bridge = new HomeNetBridge({ configPath, mqttUrl, mqttUsername, mqttPassword });

  await bridge.start();
  return bridge;
}

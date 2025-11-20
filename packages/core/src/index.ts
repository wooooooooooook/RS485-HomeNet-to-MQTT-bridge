// packages/core/src/index.ts
import dotenv from 'dotenv';
import { HomeNetBridge } from './service/bridge.service.js';
import type { BridgeOptions } from './service/bridge.service.js';
import { logger } from './utils/logger.js';
import { eventBus } from './service/event-bus.js';
import type { HomenetBridgeConfig } from './config/types.js';

dotenv.config();

export { HomeNetBridge, BridgeOptions, logger, eventBus, HomenetBridgeConfig };

export async function createBridge(configPath: string, mqttUrl: string) {
  const bridge = new HomeNetBridge({ configPath, mqttUrl });
  await bridge.start();
  return bridge;
}
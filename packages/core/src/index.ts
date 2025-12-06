// packages/core/src/index.ts
import dotenv from 'dotenv';
import { HomeNetBridge } from './service/bridge.service.js';
import type { BridgeOptions } from './service/bridge.service.js';
import { logger } from './utils/logger.js';
import { eventBus } from './service/event-bus.js';
import type { HomenetBridgeConfig, LambdaConfig } from './config/types.js';
import { CommandGenerator } from './protocol/generators/command.generator.js';
import type { EntityConfig } from './domain/entities/base.entity.js';
import { normalizeConfig, validateConfig } from './config/index.js';

dotenv.config();

export {
  HomeNetBridge,
  BridgeOptions,
  logger,
  eventBus,
  HomenetBridgeConfig,
  LambdaConfig,
  CommandGenerator,
  normalizeConfig,
  validateConfig,
};
export type { EntityConfig };

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

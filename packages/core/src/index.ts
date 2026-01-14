// packages/core/src/index.ts
import dotenv from 'dotenv';
import { HomeNetBridge } from './service/bridge.service.js';
import type { BridgeOptions } from './service/bridge.service.js';
import { logger } from './utils/logger.js';
import { logBuffer } from './utils/log-buffer.js';
import { eventBus } from './service/event-bus.js';
import type {
  MqttMessageEvent,
  StateChangedEvent,
  AutomationTriggeredEvent,
  AutomationGuardEvent,
  AutomationActionEvent,
  ScriptActionEvent,
  EntityErrorEvent,
} from './service/event-bus.js';
import type { HomenetBridgeConfig } from './config/types.js';
import { CommandGenerator } from './protocol/generators/command.generator.js';
import type { EntityConfig } from './domain/entities/base.entity.js';
import { normalizeConfig, validateConfig } from './config/index.js';
import { normalizePortId } from './utils/port.js';

dotenv.config();

export {
  HomeNetBridge,
  BridgeOptions,
  logger,
  logBuffer,
  eventBus,
  HomenetBridgeConfig,
  CommandGenerator,
  normalizeConfig,
  normalizePortId,
  validateConfig,
};
export type {
  EntityConfig,
  MqttMessageEvent,
  StateChangedEvent,
  AutomationTriggeredEvent,
  AutomationGuardEvent,
  AutomationActionEvent,
  ScriptActionEvent,
  EntityErrorEvent,
};

export async function createBridge(
  configPath: string,
  mqttUrl: string,
  mqttUsername?: string,
  mqttPassword?: string,
  mqttTopicPrefix?: string,
  configOverride?: HomenetBridgeConfig,
) {
  const bridge = new HomeNetBridge({
    configPath,
    mqttUrl,
    mqttUsername,
    mqttPassword,
    mqttTopicPrefix,
    configOverride,
  });

  await bridge.start();
  return bridge;
}

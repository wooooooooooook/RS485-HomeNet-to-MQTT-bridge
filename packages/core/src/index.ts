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
  MqttPublishEvent,
  AutomationTriggeredEvent,
  AutomationGuardEvent,
  AutomationActionEvent,
  AutomationActionFailedEvent,
  ScriptActionEvent,
  EntityErrorEvent,
  InterfaceLogEvent,
} from './service/event-bus.js';
import type { HomenetBridgeConfig } from './config/types.js';
import type { EntityConfig } from './domain/entities/base.entity.js';
import { normalizeConfig, validateConfig } from './config/index.js';
import { normalizePortId } from './utils/port.js';
import { CelExecutor } from './protocol/cel-executor.js';
import type { ConnectorContext, IntegrationConnector } from './service/connector.interface.js';

dotenv.config();

export {
  HomeNetBridge,
  BridgeOptions,
  logger,
  logBuffer,
  eventBus,
  HomenetBridgeConfig,
  normalizeConfig,
  normalizePortId,
  validateConfig,
  CelExecutor,
};
export type {
  EntityConfig,
  MqttMessageEvent,
  StateChangedEvent,
  MqttPublishEvent,
  AutomationTriggeredEvent,
  AutomationGuardEvent,
  AutomationActionEvent,
  AutomationActionFailedEvent,
  ScriptActionEvent,
  EntityErrorEvent,
  InterfaceLogEvent,
  ConnectorContext,
  IntegrationConnector,
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

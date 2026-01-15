/**
 * Shared type definitions for the service package
 */

import type { HomenetBridgeConfig, HomeNetBridge } from '@rs485-homenet/core';
import type { LogRetentionSettings } from '../log-retention.service.js';

// --- Bridge Types ---

export type BridgeInstance = {
  bridge: HomeNetBridge;
  configFile: string;
  resolvedPath: string;
  config: HomenetBridgeConfig;
};

export type BridgeStatus = 'idle' | 'starting' | 'started' | 'stopped' | 'error' | 'reconnecting';
export type ConfigStatus = 'idle' | 'starting' | 'started' | 'error' | 'stopped' | 'reconnecting';

// --- Config Types ---

export type PersistableHomenetBridgeConfig = HomenetBridgeConfig;

export type BackupFileInfo = {
  filename: string;
  size: number;
  createdAt: string;
};

// --- Frontend Settings Types ---

export type FrontendSettings = {
  toast: {
    stateChange: boolean;
    command: boolean;
  };
  activityLog?: {
    hideAutomationScripts: boolean;
  };
  locale?: string;
  logRetention?: LogRetentionSettings;
};

// --- WebSocket/Stream Types ---

export type StreamEvent =
  | 'status'
  | 'mqtt-message'
  | 'raw-data'
  | 'raw-data-with-interval'
  | 'packet-interval-stats'
  | 'command-packet'
  | 'parsed-packet'
  | 'state-change'
  | 'activity-log-added'
  | 'entity-error';

export type StreamMessage<T = unknown> = {
  event: StreamEvent;
  data: T;
};

export type RawPacketStreamMode = 'all' | 'valid';

export type RawPacketPayload = {
  payload?: string;
  interval?: number | null;
  receivedAt?: string;
  portId?: string;
  topic?: string;
};

export type RawPacketEvent = {
  topic: string;
  payload: string;
  receivedAt: string;
  interval: number | null;
  portId?: string;
  direction?: 'RX' | 'TX';
};

export type StateChangeEvent = {
  entityId: string;
  topic: string;
  payload: string;
  state: Record<string, unknown>;
  timestamp: string;
  portId?: string;
};

export type EntityErrorEvent = {
  entityId: string;
  portId?: string;
  type: 'parse' | 'cel' | 'command';
  message: string;
  timestamp: string;
  context?: Record<string, unknown>;
};

// --- Command/Entity Types ---

export interface CommandInfo {
  entityId: string;
  entityName: string;
  entityType: string;
  commandName: string;
  displayName: string;
  inputType?: 'number' | 'text';
  min?: number;
  max?: number;
  step?: number;
  options?: string[];
  discoveryAlways?: boolean;
  discoveryLinkedId?: string;
}

export interface ConfigEntityInfo {
  entityId: string;
  entityName: string;
  entityType: string;
  portId?: string;
  discoveryAlways?: boolean;
  discoveryLinkedId?: string;
}

import { EventEmitter } from 'events';

export interface MqttMessageEvent {
  topic: string;
  payload: string;
  portId?: string;
}

export interface StateChangedEvent {
  portId: string;
  entityId: string;
  topic: string;
  payload: string;
  state: Record<string, any>;
  oldState: Record<string, any>;
  changes: Record<string, any>;
  timestamp: string;
}

export interface AutomationTriggeredEvent {
  automationId: string;
  triggerType: string;
  portId?: string;
  timestamp: number;
}

export interface AutomationGuardEvent {
  automationId: string;
  triggerType: string;
  result: boolean;
  portId?: string;
  timestamp: number;
}

export interface AutomationActionEvent {
  automationId: string;
  triggerType: string;
  action: string;
  portId?: string;
  timestamp: number;
  actionIndex?: number;
  totalActions?: number;
}

export interface ScriptActionEvent {
  scriptId: string;
  action: string;
  portId?: string;
  timestamp: number;
  /** Original entity ID that triggered this script (for command attribution) */
  sourceEntityId?: string;
}

export type EntityErrorType = 'parse' | 'cel' | 'command';

export interface EntityErrorEvent {
  entityId: string;
  portId?: string;
  type: EntityErrorType;
  message: string;
  timestamp: string;
  context?: Record<string, unknown>;
}

export const eventBus = new EventEmitter();

import { LightEntity } from '../domain/entities/light.entity.js';
import { ClimateEntity } from '../domain/entities/climate.entity.js';
import { ValveEntity } from '../domain/entities/valve.entity.js';
import { ButtonEntity } from '../domain/entities/button.entity.js';
import { SensorEntity } from '../domain/entities/sensor.entity.js';
import { FanEntity } from '../domain/entities/fan.entity.js';
import { SwitchEntity } from '../domain/entities/switch.entity.js';
import { LockEntity } from '../domain/entities/lock.entity.js';
import { NumberEntity } from '../domain/entities/number.entity.js';
import { SelectEntity } from '../domain/entities/select.entity.js';
import { TextSensorEntity } from '../domain/entities/text-sensor.entity.js';
import { TextEntity } from '../domain/entities/text.entity.js';
import { BinarySensorEntity } from '../domain/entities/binary-sensor.entity.js';
import { PacketDefaults, StateNumSchema, StateSchema } from '../protocol/types.js';

export interface DeviceConfig {
  id: string;
  name?: string;
  manufacturer?: string;
  model?: string;
  sw_version?: string;
  area?: string;
}

/**
 * CEL expression string used as a condition.
 * Should evaluate to a boolean.
 */
export type AutomationGuard = string;

/**
 * Trigger based on an entity state change.
 */
export interface AutomationTriggerState {
  type: 'state';
  /** Entity ID to monitor. */
  entity_id: string;
  /**
   * Specific property of the state to monitor (e.g. 'state', 'value').
   * If omitted, triggers on any change to the entity's state object.
   */
  property?: string;
  /**
   * Value to match or condition object (e.g. `{ gt: 10 }`).
   */
  match?: any;
  /**
   * Debounce time in ms (or '1s'). Prevents rapid firing.
   */
  debounce_ms?: number | string;
  /** Additional CEL condition. */
  guard?: AutomationGuard;
}

/**
 * Trigger based on receiving a specific raw packet.
 */
export interface AutomationTriggerPacket {
  type: 'packet';
  /**
   * Schema to match the received packet.
   * `data` field is required. `offset` can be used to skip header.
   */
  match: StateSchema;
  /** Additional CEL condition. */
  guard?: AutomationGuard;
}

/**
 * Trigger based on time interval or cron schedule.
 */
export interface AutomationTriggerSchedule {
  type: 'schedule';
  /** Interval string (e.g. '5m', '1h'). */
  every?: number | string;
  /** Cron expression (e.g. '0 0 * * *'). */
  cron?: string;
  /** Additional CEL condition. */
  guard?: AutomationGuard;
}

/**
 * Trigger executed when the bridge starts up.
 */
export interface AutomationTriggerStartup {
  type: 'startup';
  /** Additional CEL condition. */
  guard?: AutomationGuard;
}

export type AutomationTrigger =
  | AutomationTriggerState
  | AutomationTriggerPacket
  | AutomationTriggerSchedule
  | AutomationTriggerStartup;

/**
 * Action to send a command to an entity.
 */
export interface AutomationActionCommand {
  action: 'command';
  /**
   * Command target string.
   * @example 'id(light_1).command_on()'
   */
  target: string;
  /**
   * Complex input arguments for the command.
   */
  input?: any;
  /**
   * If true, sends command only when queue is empty.
   * Default is false, but implicitly true for schedule triggers.
   */
  low_priority?: boolean;
}

/**
 * Action to publish an MQTT message.
 */
export interface AutomationActionPublish {
  action: 'publish';
  topic: string;
  payload: any;
  retain?: boolean;
}

/**
 * Action to write a log message.
 */
export interface AutomationActionLog {
  action: 'log';
  level?: 'trace' | 'debug' | 'info' | 'warn' | 'error';
  message: string;
}

/**
 * Action to pause execution.
 */
export interface AutomationActionDelay {
  action: 'delay';
  /** Duration in ms or string (e.g. '1s'). */
  milliseconds: number | string;
}

/**
 * Action to run a named script.
 */
export interface AutomationActionScript {
  action: 'script';
  /** Script ID to run. */
  script?: string;
  /** Inline code (not implemented in all contexts). */
  code?: string;
  /** Arguments to pass to the script. */
  args?: Record<string, any>;
}

export type AutomationActionUpdateStateValue = StateSchema | StateNumSchema | any;

/**
 * Action to directly update an entity's state from a packet (used in packet triggers).
 */
export interface AutomationActionUpdateState {
  action: 'update_state';
  target_id: string;
  state: Record<string, AutomationActionUpdateStateValue>;
}

/**
 * Action to send a raw packet to the RS485 bus.
 */
export interface AutomationActionSendPacket {
  action: 'send_packet';
  /** Packet bytes (list of int) or CEL expression string. */
  data: number[] | string;
  /** Whether to append checksum. Default: true. */
  checksum?: boolean;
  /** Whether to prepend header. Default: false. */
  header?: boolean | number[];
  /** Whether to append footer. Default: false. */
  footer?: boolean | number[];
  /** Port ID to send to (if multiple ports). */
  portId?: string;
  /**
   * Wait for specific ACK packet.
   * Can be byte array or CEL expression.
   */
  ack?: number[] | string;
}

/**
 * Conditional action (If-Then-Else).
 */
export interface AutomationActionIf {
  action: 'if';
  /** CEL condition expression. */
  condition: string;
  then: AutomationAction[];
  else?: AutomationAction[];
}

/**
 * Loop action.
 */
export interface AutomationActionRepeat {
  action: 'repeat';
  /** Fixed number of iterations. */
  count?: number;
  /** CEL condition for while loop. */
  while?: string;
  /** Max iterations for safety (default: 100). */
  max?: number;
  actions: AutomationAction[];
}

/**
 * Action to wait for a condition to become true.
 */
export interface AutomationActionWaitUntil {
  action: 'wait_until';
  /** CEL condition expression. */
  condition: string;
  /** Timeout in ms or string (default: 30s). */
  timeout?: number | string;
  /** Polling interval (default: 100ms). */
  check_interval?: number | string;
}

export interface AutomationActionChooseChoice {
  /** CEL condition. */
  condition: string;
  then: AutomationAction[];
}

/**
 * Switch-like conditional action.
 * Executes the first choice whose condition is true.
 */
export interface AutomationActionChoose {
  action: 'choose';
  choices: AutomationActionChooseChoice[];
  /** Executed if no choice matches. */
  default?: AutomationAction[];
}

/**
 * Action to stop the current automation execution.
 */
export interface AutomationActionStop {
  action: 'stop';
  /** Reason for stopping (logged). */
  reason?: string;
}

export type AutomationAction =
  | AutomationActionCommand
  | AutomationActionPublish
  | AutomationActionLog
  | AutomationActionDelay
  | AutomationActionScript
  | AutomationActionUpdateState
  | AutomationActionSendPacket
  | AutomationActionIf
  | AutomationActionRepeat
  | AutomationActionWaitUntil
  | AutomationActionChoose
  | AutomationActionStop;

export type AutomationMode = 'parallel' | 'single' | 'restart' | 'queued';

/**
 * Configuration for an Automation rule.
 */
export interface AutomationConfig {
  /** Unique ID for the automation. */
  id: string;
  /** User-friendly name. */
  name?: string;
  description?: string;
  /**
   * Execution mode when trigger fires while running.
   * - `parallel`: Run multiple instances (default).
   * - `single`: Ignore new triggers while running.
   * - `restart`: Stop current and start new.
   * - `queued`: Queue new triggers.
   */
  mode?: AutomationMode;
  /** List of triggers that start this automation. */
  trigger: AutomationTrigger[];
  /** CEL condition that must be true to run. */
  guard?: AutomationGuard;
  /** @deprecated Use `then` instead. */
  actions?: AutomationAction[];
  /** List of actions to execute. */
  then: AutomationAction[];
  /** Actions to execute if `guard` returns false. */
  else?: AutomationAction[];
  /** Enable or disable this automation. */
  enabled?: boolean;
}

export interface ScriptArg {
  type?: 'string' | 'number' | 'boolean' | 'select';
  description?: string;
  default?: any;
  min?: number;
  max?: number;
  options?: string[];
}

/**
 * Reusable script configuration.
 */
export interface ScriptConfig {
  id: string;
  description?: string;
  actions: AutomationAction[];
  /**
   * Arguments definition for the script.
   * Key is the argument name.
   */
  args?: Record<string, ScriptArg>;
}

/**
 * Serial port configuration.
 */
export interface SerialConfig {
  /** Identifier for this port (e.g. 'default', 'living_room'). */
  portId: string;
  /** Alias for portId. */
  port_id?: string;
  /** Device path (e.g. '/dev/ttyUSB0' or 'socket://IP:PORT'). */
  path: string;
  baud_rate: number;
  data_bits: 5 | 6 | 7 | 8;
  parity: 'none' | 'even' | 'mark' | 'odd' | 'space';
  stop_bits: 1 | 1.5 | 2;
  /** Idle timeout in ms to close connection (optional). */
  serial_idle?: number | string;
}

/**
 * Root configuration structure for HomeNet Bridge (`homenet_bridge` key).
 */
export interface HomenetBridgeConfig {
  /** Global packet defaults (headers, checksums, timings). */
  packet_defaults?: PacketDefaults;
  /** Serial port settings. */
  serial: SerialConfig;
  /** Generic devices list. */
  devices?: DeviceConfig[];
  /** Light entities. */
  light?: LightEntity[];
  /** Climate (HVAC) entities. */
  climate?: ClimateEntity[];
  /** Valve entities (Gas/Water). */
  valve?: ValveEntity[];
  /** Button entities. */
  button?: ButtonEntity[];
  /** Sensor entities. */
  sensor?: SensorEntity[];
  /** Fan entities. */
  fan?: FanEntity[];
  /** Switch entities. */
  switch?: SwitchEntity[];
  /** Lock entities. */
  lock?: LockEntity[];
  /** Number entities. */
  number?: NumberEntity[];
  /** Select entities. */
  select?: SelectEntity[];
  /** Text sensor entities. */
  text_sensor?: TextSensorEntity[];
  /** Text input entities. */
  text?: TextEntity[];
  /** Binary sensor entities. */
  binary_sensor?: BinarySensorEntity[];
  /** Automation rules. */
  automation?: AutomationConfig[];
  /** @deprecated automation의 별칭이며 입력 호환성만 제공합니다. */
  automations?: AutomationConfig[];
  /** Reusable scripts. */
  scripts?: ScriptConfig[];
}

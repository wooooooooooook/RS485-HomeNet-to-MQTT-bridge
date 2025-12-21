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
import { PacketDefaults, StateSchema } from '../protocol/types.js';

export interface DeviceConfig {
  id: string;
  name?: string;
  manufacturer?: string;
  model?: string;
  sw_version?: string;
  area?: string;
}

export type AutomationGuard = string;

export interface AutomationTriggerState {
  type: 'state';
  entity_id: string;
  property?: string;
  match?: any;
  debounce_ms?: number | string;
  guard?: AutomationGuard;
}

export interface AutomationTriggerPacket {
  type: 'packet';
  match: StateSchema;
  guard?: AutomationGuard;
}

export interface AutomationTriggerSchedule {
  type: 'schedule';
  every?: number | string;
  cron?: string;
  guard?: AutomationGuard;
}

export interface AutomationTriggerStartup {
  type: 'startup';
  delay?: number | string;
  guard?: AutomationGuard;
}

export type AutomationTrigger =
  | AutomationTriggerState
  | AutomationTriggerPacket
  | AutomationTriggerSchedule
  | AutomationTriggerStartup;

export interface AutomationActionCommand {
  action: 'command';
  target: string;
  input?: any;
  low_priority?: boolean;
}

export interface AutomationActionPublish {
  action: 'publish';
  topic: string;
  payload: any;
  retain?: boolean;
}

export interface AutomationActionLog {
  action: 'log';
  level?: 'trace' | 'debug' | 'info' | 'warn' | 'error';
  message: string;
}

export interface AutomationActionDelay {
  action: 'delay';
  milliseconds: number | string;
}

export interface AutomationActionScript {
  action: 'script';
  code: string;
}

export type AutomationAction =
  | AutomationActionCommand
  | AutomationActionPublish
  | AutomationActionLog
  | AutomationActionDelay
  | AutomationActionScript;

export interface AutomationConfig {
  id: string;
  name?: string;
  description?: string;
  trigger: AutomationTrigger[];
  guard?: AutomationGuard;
  then: AutomationAction[];
  else?: AutomationAction[];
  enabled?: boolean;
}

export interface SerialConfig {
  portId: string;
  path: string;
  baud_rate: number;
  data_bits: 5 | 6 | 7 | 8;
  parity: 'none' | 'even' | 'mark' | 'odd' | 'space';
  stop_bits: 1 | 1.5 | 2;
}

export interface HomenetBridgeConfig {
  packet_defaults?: PacketDefaults;
  /**
   * 단일 시리얼 포트 설정입니다. 설정 파일에서는 `serial`만 허용하며, 내부적으로
   * 호환성을 위해 `serials`에 동일한 값이 주입됩니다.
   */
  serial: SerialConfig;
  /** @deprecated 입력에서는 허용되지 않으며 normalize 과정에서 채워집니다. */
  serials: SerialConfig[];
  devices?: DeviceConfig[];
  light?: LightEntity[];
  climate?: ClimateEntity[];
  valve?: ValveEntity[];
  button?: ButtonEntity[];
  sensor?: SensorEntity[];
  fan?: FanEntity[];
  switch?: SwitchEntity[];
  lock?: LockEntity[];
  number?: NumberEntity[];
  select?: SelectEntity[];
  text_sensor?: TextSensorEntity[];
  text?: TextEntity[];
  binary_sensor?: BinarySensorEntity[];
  automation?: AutomationConfig[];
}

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
import { PacketDefaults } from '../protocol/types.js';

export interface RetryConfig {
  attempts: number;
  timeout: number;
  interval: number;
}

export interface LambdaConfig {
  type: 'lambda';
  script: string;
}

export interface HomenetBridgeConfig {
  packet_defaults?: PacketDefaults;
  retry?: RetryConfig;
  serial: {
    baud_rate: number;
    data_bits: 5 | 6 | 7 | 8;
    parity: 'none' | 'even' | 'mark' | 'odd' | 'space';
    stop_bits: 1 | 1.5 | 2;
  };
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
}

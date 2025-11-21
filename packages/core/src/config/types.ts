import { LightEntity } from '../domain/entities/light.entity.js';
import { ClimateEntity } from '../domain/entities/climate.entity.js';
import { ValveEntity } from '../domain/entities/valve.entity.js';
import { ButtonEntity } from '../domain/entities/button.entity.js';
import { SensorEntity } from '../domain/entities/sensor.entity.js';
import { FanEntity } from '../domain/entities/fan.entity.js';
import { SwitchEntity } from '../domain/entities/switch.entity.js';
import { BinarySensorEntity } from '../domain/entities/binary-sensor.entity.js';
import { PacketDefaults } from '../protocol/types.js';

export interface LambdaConfig {
  type: 'lambda';
  script: string;
}

export interface HomenetBridgeConfig {
  packet_defaults?: PacketDefaults;
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
  binary_sensor?: BinarySensorEntity[];
}
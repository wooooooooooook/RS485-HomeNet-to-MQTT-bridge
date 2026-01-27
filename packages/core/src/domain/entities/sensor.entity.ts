// packages/core/src/domain/entities/sensor.entity.ts

import { EntityConfig, CommandSchemaOrCEL } from './base.entity.js';
import { StateSchema, StateNumSchemaOrCEL } from '../../protocol/types.js';

export interface SensorEntity extends EntityConfig {
  state: StateSchema;
  state_number?: StateNumSchemaOrCEL;
  command_update?: CommandSchemaOrCEL;
}

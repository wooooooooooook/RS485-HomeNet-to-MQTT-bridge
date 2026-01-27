// packages/core/src/domain/entities/sensor.entity.ts

import { EntityConfig, CommandSchema, CommandSchemaOrCEL } from './base.entity.js';
import { StateSchema, StateNumSchemaOrCEL } from '../../protocol/types.js';

export interface SensorEntity extends EntityConfig {
  type: 'sensor';
  state: StateSchema;
  state_number?: StateNumSchemaOrCEL;
  command_update?: CommandSchemaOrCEL;
}

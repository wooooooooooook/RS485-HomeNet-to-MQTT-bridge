// packages/core/src/domain/entities/number.entity.ts

import { EntityConfig, CommandSchema, CommandSchemaOrCEL } from './base.entity.js';
import { StateSchema, StateNumSchemaOrCEL } from '../../protocol/types.js';

export interface NumberEntity extends EntityConfig {
  state?: StateSchema;
  max_value?: number;
  min_value?: number;
  step?: number;
  state_increment?: StateSchema;
  state_decrement?: StateSchema;
  state_to_min?: StateSchema;
  state_to_max?: StateSchema;
  state_number?: StateNumSchemaOrCEL;
  command_number?: CommandSchemaOrCEL;
  command_update?: CommandSchemaOrCEL;
}

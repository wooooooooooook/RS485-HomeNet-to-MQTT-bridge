// packages/core/src/domain/entities/climate.entity.ts

import { EntityConfig, CommandSchema } from './base.entity.js';
import { StateSchema, StateNumSchema } from '../../protocol/types.js';

export interface ClimateEntity extends EntityConfig {
  type: 'climate';
  state: StateSchema;
  state_off?: StateSchema;
  state_heat?: StateSchema;
  state_cool?: StateSchema;
  state_temperature_current?: StateNumSchema;
  state_temperature_target?: StateNumSchema;
  command_off?: CommandSchema;
  command_heat?: CommandSchema;
  command_cool?: CommandSchema;
  command_temperature?: CommandSchema;
  command_update?: CommandSchema;
}

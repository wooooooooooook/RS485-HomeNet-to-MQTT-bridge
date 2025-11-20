// packages/core/src/domain/entities/fan.entity.ts

import { EntityConfig, CommandSchema } from './base.entity.js';
import { StateSchema, StateNumSchema } from '../../protocol/types.js';

export interface FanEntity extends EntityConfig {
  type: 'fan';
  state: StateSchema;
  state_on?: StateSchema;
  state_off?: StateSchema;
  state_speed?: StateNumSchema;
  command_on?: CommandSchema;
  command_off?: CommandSchema;
  command_speed?: CommandSchema;
  command_update?: CommandSchema;
}

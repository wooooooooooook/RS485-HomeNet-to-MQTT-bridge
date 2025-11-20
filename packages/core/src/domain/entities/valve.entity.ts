// packages/core/src/domain/entities/valve.entity.ts

import { EntityConfig, CommandSchema } from './base.entity.js';
import { StateSchema } from '../../protocol/types.js';

export interface ValveEntity extends EntityConfig {
  type: 'valve';
  state: StateSchema;
  state_open?: StateSchema;
  state_closed?: StateSchema;
  command_open?: CommandSchema;
  command_close?: CommandSchema;
  command_update?: CommandSchema;
}

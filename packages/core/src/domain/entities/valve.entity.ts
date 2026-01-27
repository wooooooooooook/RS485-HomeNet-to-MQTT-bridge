// packages/core/src/domain/entities/valve.entity.ts

import { EntityConfig, CommandSchema, CommandSchemaOrCEL } from './base.entity.js';
import { StateSchema, StateNumSchemaOrCEL } from '../../protocol/types.js';

export interface ValveEntity extends EntityConfig {
  state: StateSchema;
  state_open?: StateSchema;
  state_closed?: StateSchema;
  state_opening?: StateSchema;
  state_closing?: StateSchema;

  // Position support (0-100, where 0 is closed and 100 is fully open)
  state_position?: StateNumSchemaOrCEL;
  command_position?: CommandSchemaOrCEL;

  // Reports whether valve is currently moving
  reports_position?: boolean;

  command_open?: CommandSchemaOrCEL;
  command_close?: CommandSchemaOrCEL;
  command_stop?: CommandSchemaOrCEL;
  command_update?: CommandSchemaOrCEL;
}

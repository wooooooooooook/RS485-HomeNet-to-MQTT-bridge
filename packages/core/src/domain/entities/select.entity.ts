// packages/core/src/domain/entities/select.entity.ts

import { EntityConfig, CommandSchema } from './base.entity.js';
import { StateSchema, StateNumSchema } from '../../protocol/types.js';

export interface SelectStateSchema extends StateNumSchema {
  map?: { [key: number]: string };
}

export interface SelectCommandSchema extends CommandSchema {
  map?: { [key: string]: number };
  value_offset?: number;
}

export interface SelectEntity extends EntityConfig {
  state?: StateSchema;
  options: string[];
  initial_option?: string;
  restore_value?: boolean;
  command_select?: SelectCommandSchema | string;
  state_select?: SelectStateSchema | string; // CEL for parsing state to option string
  command_update?: CommandSchema;
}

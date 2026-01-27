// packages/core/src/domain/entities/light.entity.ts

import { EntityConfig, CommandSchemaOrCEL } from './base.entity.js';
import { StateSchema, StateNumSchemaOrCEL } from '../../protocol/types.js';

export interface LightEntity extends EntityConfig {
  state: StateSchema;
  state_on?: StateSchema;
  state_off?: StateSchema;

  // Brightness support
  state_brightness?: StateNumSchemaOrCEL;
  command_brightness?: CommandSchemaOrCEL;

  // Color temperature support (mireds)
  state_color_temp?: StateNumSchemaOrCEL;
  command_color_temp?: CommandSchemaOrCEL;
  min_mireds?: number;
  max_mireds?: number;

  // RGB color support
  state_red?: StateNumSchemaOrCEL;
  state_green?: StateNumSchemaOrCEL;
  state_blue?: StateNumSchemaOrCEL;
  command_red?: CommandSchemaOrCEL;
  command_green?: CommandSchemaOrCEL;
  command_blue?: CommandSchemaOrCEL;

  // White value support
  state_white?: StateNumSchemaOrCEL;
  command_white?: CommandSchemaOrCEL;

  // Color mode
  state_color_mode?: StateSchema; // 'rgb', 'color_temp', 'white'

  // Effects
  effect_list?: string[];
  state_effect?: StateSchema;
  command_effect?: CommandSchemaOrCEL;

  // Transition support
  default_transition_length?: number;

  command_on?: CommandSchemaOrCEL;
  command_off?: CommandSchemaOrCEL;
  command_update?: CommandSchemaOrCEL;
}

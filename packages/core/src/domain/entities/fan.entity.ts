// packages/core/src/domain/entities/fan.entity.ts

import { EntityConfig, CommandSchema, CommandSchemaOrCEL } from './base.entity.js';
import { StateSchema, StateNumSchemaOrCEL } from '../../protocol/types.js';

export interface FanEntity extends EntityConfig {
  state: StateSchema;
  state_on?: StateSchema;
  state_off?: StateSchema;

  // Speed support (percentage 0-100)
  state_speed?: StateNumSchemaOrCEL;
  command_speed?: CommandSchemaOrCEL;

  // Preset modes (supports both schema-based and CEL expressions)
  preset_modes?: string[];
  state_preset_mode?: StateSchema | CommandSchemaOrCEL; // StateSchema or CEL string returning preset name
  command_preset_mode?: CommandSchemaOrCEL; // CommandSchema or CEL string (uses xstr for preset name)

  // Oscillation
  state_oscillating?: StateSchema;
  command_oscillating?: CommandSchemaOrCEL;

  // Direction (forward/reverse)
  state_direction?: StateSchema;
  command_direction?: CommandSchemaOrCEL;

  // Percentage control (alternative to speed)
  state_percentage?: StateNumSchemaOrCEL;
  command_percentage?: CommandSchemaOrCEL;

  command_on?: CommandSchemaOrCEL;
  command_off?: CommandSchemaOrCEL;
  command_update?: CommandSchemaOrCEL;
}

// packages/core/src/domain/entities/fan.entity.ts

import { EntityConfig, CommandSchema } from './base.entity.js';
import { StateSchema, StateNumSchema } from '../../protocol/types.js';

export interface FanEntity extends EntityConfig {
  type: 'fan';
  state: StateSchema;
  state_on?: StateSchema;
  state_off?: StateSchema;

  // Speed support (percentage 0-100)
  state_speed?: StateNumSchema;
  command_speed?: CommandSchema;

  // Preset modes (supports both schema-based and CEL expressions)
  preset_modes?: string[];
  state_preset_mode?: StateSchema | CommandSchema; // StateSchema or CEL string returning preset name
  command_preset_mode?: CommandSchema; // CommandSchema or CEL string (uses xstr for preset name)

  // Oscillation
  state_oscillating?: StateSchema;
  command_oscillating?: CommandSchema;

  // Direction (forward/reverse)
  state_direction?: StateSchema;
  command_direction?: CommandSchema;

  // Percentage control (alternative to speed)
  state_percentage?: StateNumSchema;
  command_percentage?: CommandSchema;

  command_on?: CommandSchema;
  command_off?: CommandSchema;
  command_update?: CommandSchema;
}

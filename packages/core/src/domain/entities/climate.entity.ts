// packages/core/src/domain/entities/climate.entity.ts

import { EntityConfig, CommandSchema } from './base.entity.js';
import { StateSchema, StateNumSchema } from '../../protocol/types.js';

export interface ClimateEntity extends EntityConfig {
  type: 'climate';
  state: StateSchema;

  // Temperature modes
  state_off?: StateSchema;
  state_heat?: StateSchema;
  state_cool?: StateSchema;
  state_fan_only?: StateSchema;
  state_dry?: StateSchema;
  state_auto?: StateSchema;

  // Temperature
  state_temperature_current?: StateNumSchema;
  state_temperature_target?: StateNumSchema;

  // Humidity
  state_humidity_current?: StateNumSchema;
  state_humidity_target?: StateNumSchema;

  // Actions
  state_action_idle?: StateSchema;
  state_action_heating?: StateSchema;
  state_action_cooling?: StateSchema;
  state_action_drying?: StateSchema;
  state_action_fan?: StateSchema;

  // Swing modes
  state_swing_off?: StateSchema;
  state_swing_both?: StateSchema;
  state_swing_vertical?: StateSchema;
  state_swing_horizontal?: StateSchema;

  // Fan modes
  state_fan_on?: StateSchema;
  state_fan_off?: StateSchema;
  state_fan_auto?: StateSchema;
  state_fan_low?: StateSchema;
  state_fan_medium?: StateSchema;
  state_fan_high?: StateSchema;
  state_fan_middle?: StateSchema;
  state_fan_focus?: StateSchema;
  state_fan_diffuse?: StateSchema;
  state_fan_quiet?: StateSchema;

  // Preset modes
  state_preset_none?: StateSchema;
  state_preset_home?: StateSchema;
  state_preset_away?: StateSchema;
  state_preset_boost?: StateSchema;
  state_preset_comfort?: StateSchema;
  state_preset_eco?: StateSchema;
  state_preset_sleep?: StateSchema;
  state_preset_activity?: StateSchema;

  // Custom modes (CEL)
  state_custom_fan?: CommandSchema; // CEL returning string
  state_custom_preset?: CommandSchema; // CEL returning string

  // Commands - Temperature modes
  command_off?: CommandSchema;
  command_heat?: CommandSchema;
  command_cool?: CommandSchema;
  command_fan_only?: CommandSchema;
  command_dry?: CommandSchema;
  command_auto?: CommandSchema;

  // Commands - Temperature/Humidity
  command_temperature?: CommandSchema;
  command_humidity?: CommandSchema;

  // Commands - Swing
  command_swing_off?: CommandSchema;
  command_swing_both?: CommandSchema;
  command_swing_vertical?: CommandSchema;
  command_swing_horizontal?: CommandSchema;

  // Commands - Fan modes
  command_fan_on?: CommandSchema;
  command_fan_off?: CommandSchema;
  command_fan_auto?: CommandSchema;
  command_fan_low?: CommandSchema;
  command_fan_medium?: CommandSchema;
  command_fan_high?: CommandSchema;
  command_fan_middle?: CommandSchema;
  command_fan_focus?: CommandSchema;
  command_fan_diffuse?: CommandSchema;
  command_fan_quiet?: CommandSchema;

  // Commands - Preset modes
  command_preset_none?: CommandSchema;
  command_preset_home?: CommandSchema;
  command_preset_away?: CommandSchema;
  command_preset_boost?: CommandSchema;
  command_preset_comfort?: CommandSchema;
  command_preset_eco?: CommandSchema;
  command_preset_sleep?: CommandSchema;
  command_preset_activity?: CommandSchema;

  // Commands - Custom modes (CEL)
  command_custom_fan?: CommandSchema; // CEL taking string
  command_custom_preset?: CommandSchema; // CEL taking string

  // Update command
  command_update?: CommandSchema;

  // Custom mode lists
  custom_fan_mode?: string[];
  custom_preset?: string[];
}

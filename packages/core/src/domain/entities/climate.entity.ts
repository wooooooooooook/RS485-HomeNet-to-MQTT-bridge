// packages/core/src/domain/entities/climate.entity.ts

import { EntityConfig, CommandSchemaOrCEL } from './base.entity.js';
import { StateSchema, StateNumSchemaOrCEL } from '../../protocol/types.js';

export interface ClimateEntity extends EntityConfig {
  state: StateSchema;

  // Temperature modes
  state_off?: StateSchema;
  state_heat?: StateSchema;
  state_cool?: StateSchema;
  state_fan_only?: StateSchema;
  state_dry?: StateSchema;
  state_auto?: StateSchema;

  // Temperature
  state_temperature_current?: StateNumSchemaOrCEL;
  state_temperature_target?: StateNumSchemaOrCEL;

  // Humidity
  state_humidity_current?: StateNumSchemaOrCEL;
  state_humidity_target?: StateNumSchemaOrCEL;

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
  state_custom_fan?: CommandSchemaOrCEL; // CEL returning string
  state_custom_preset?: CommandSchemaOrCEL; // CEL returning string

  // Commands - Temperature modes
  command_off?: CommandSchemaOrCEL;
  command_heat?: CommandSchemaOrCEL;
  command_cool?: CommandSchemaOrCEL;
  command_fan_only?: CommandSchemaOrCEL;
  command_dry?: CommandSchemaOrCEL;
  command_auto?: CommandSchemaOrCEL;

  // Commands - Temperature/Humidity
  command_temperature?: CommandSchemaOrCEL;
  command_humidity?: CommandSchemaOrCEL;

  // Commands - Swing
  command_swing_off?: CommandSchemaOrCEL;
  command_swing_both?: CommandSchemaOrCEL;
  command_swing_vertical?: CommandSchemaOrCEL;
  command_swing_horizontal?: CommandSchemaOrCEL;

  // Commands - Fan modes
  command_fan_on?: CommandSchemaOrCEL;
  command_fan_off?: CommandSchemaOrCEL;
  command_fan_auto?: CommandSchemaOrCEL;
  command_fan_low?: CommandSchemaOrCEL;
  command_fan_medium?: CommandSchemaOrCEL;
  command_fan_high?: CommandSchemaOrCEL;
  command_fan_middle?: CommandSchemaOrCEL;
  command_fan_focus?: CommandSchemaOrCEL;
  command_fan_diffuse?: CommandSchemaOrCEL;
  command_fan_quiet?: CommandSchemaOrCEL;

  // Commands - Preset modes
  command_preset_none?: CommandSchemaOrCEL;
  command_preset_home?: CommandSchemaOrCEL;
  command_preset_away?: CommandSchemaOrCEL;
  command_preset_boost?: CommandSchemaOrCEL;
  command_preset_comfort?: CommandSchemaOrCEL;
  command_preset_eco?: CommandSchemaOrCEL;
  command_preset_sleep?: CommandSchemaOrCEL;
  command_preset_activity?: CommandSchemaOrCEL;

  // Commands - Custom modes (CEL)
  command_custom_fan?: CommandSchemaOrCEL; // CEL taking string
  command_custom_preset?: CommandSchemaOrCEL; // CEL taking string

  // Update command
  command_update?: CommandSchemaOrCEL;

  // Custom mode lists
  custom_fan_mode?: string[];
  custom_preset?: string[];
}

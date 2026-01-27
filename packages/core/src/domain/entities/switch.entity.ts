// packages/core/src/domain/entities/switch.entity.ts

import { EntityConfig, CommandSchema } from './base.entity.js';
import { StateSchema } from '../../protocol/types.js';

export interface SwitchEntity extends EntityConfig {
  state: StateSchema;
  state_on?: StateSchema;
  state_off?: StateSchema;
  command_on?: CommandSchema;
  command_off?: CommandSchema;
  command_update?: CommandSchema;
}

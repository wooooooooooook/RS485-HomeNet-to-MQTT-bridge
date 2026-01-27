// packages/core/src/domain/entities/lock.entity.ts

import { EntityConfig, CommandSchema } from './base.entity.js';
import { StateSchema } from '../../protocol/types.js';

export interface LockEntity extends EntityConfig {
  state?: StateSchema;
  state_locked?: StateSchema;
  state_unlocked?: StateSchema;
  state_locking?: StateSchema;
  state_unlocking?: StateSchema;
  state_jammed?: StateSchema;
  command_lock?: CommandSchema;
  command_unlock?: CommandSchema;
  command_update?: CommandSchema;
}

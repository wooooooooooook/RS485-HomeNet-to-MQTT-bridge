// packages/core/src/domain/entities/button.entity.ts

import { EntityConfig } from './base.entity.js';
import { CommandSchema } from './base.entity.js';

export interface ButtonEntity extends EntityConfig {
  command_press: CommandSchema;
}

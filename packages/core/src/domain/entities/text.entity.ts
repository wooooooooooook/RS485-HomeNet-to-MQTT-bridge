// packages/core/src/domain/entities/text.entity.ts

import { EntityConfig, CommandSchema } from './base.entity.js';
import { StateSchema } from '../../protocol/types.js';

export interface TextEntity extends EntityConfig {
  type: 'text';
  state?: StateSchema;
  state_text?: StateSchema; // CEL for extracting text from packet
  min_length?: number;
  max_length?: number;
  pattern?: string; // regex pattern for validation
  mode?: 'text' | 'password';
  command_text?: CommandSchema;
  command_update?: CommandSchema;
}

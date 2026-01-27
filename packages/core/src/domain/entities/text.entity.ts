// packages/core/src/domain/entities/text.entity.ts

import { EntityConfig, CommandSchema, CommandSchemaOrCEL } from './base.entity.js';
import { StateSchema, StateNumSchemaOrCEL, StateSchemaOrCEL } from '../../protocol/types.js';

export interface TextEntity extends EntityConfig {
  state?: StateSchema;
  state_text?: StateSchema | string; // CEL for extracting text from packet
  min_length?: number;
  max_length?: number;
  pattern?: string; // regex pattern for validation
  mode?: 'text' | 'password';
  command_text?: CommandSchemaOrCEL;
  command_update?: CommandSchemaOrCEL;
  initial_value?: string;
}

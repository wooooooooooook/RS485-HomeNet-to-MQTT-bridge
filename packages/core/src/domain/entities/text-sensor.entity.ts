// packages/core/src/domain/entities/text-sensor.entity.ts

import { EntityConfig } from './base.entity.js';
import { StateSchema } from '../../protocol/types.js';

export interface TextSensorEntity extends EntityConfig {
  state?: StateSchema;
  state_text?: StateSchema | string;
  initial_value?: string;
}

import { HomenetBridgeConfig } from '../config/types.js';
import { EntityConfig } from '../domain/entities/base.entity.js';

export const ENTITY_TYPE_KEYS: (keyof HomenetBridgeConfig)[] = [
  'light',
  'climate',
  'valve',
  'button',
  'sensor',
  'fan',
  'switch',
  'binary_sensor',
  'lock',
  'number',
  'select',
  'text',
  'text_sensor',
];

export function findEntityById(
  config: HomenetBridgeConfig,
  entityId: string,
): (EntityConfig & { type: string }) | undefined {
  for (const type of ENTITY_TYPE_KEYS) {
    const entities = config[type] as EntityConfig[] | undefined;
    if (!entities) continue;
    const found = entities.find((entity) => entity.id === entityId);
    if (found) {
      return { ...found, type };
    }
  }
  return undefined;
}

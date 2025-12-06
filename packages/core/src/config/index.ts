import { HomenetBridgeConfig } from './types.js';
import { loadYamlConfig } from './yaml-loader.js';
import { logger } from '../utils/logger.js';
import { parseDuration } from '../utils/duration.js';
import { ENTITY_TYPE_KEYS } from '../utils/entities.js';

export async function loadConfig(configPath: string): Promise<HomenetBridgeConfig> {
  logger.info(`[core] Loading configuration from: ${configPath}`);
  const loadedYaml = await loadYamlConfig(configPath);

  if (!loadedYaml || !(loadedYaml as any).homenet_bridge) {
    throw new Error(
      'Invalid configuration file structure. Missing "homenet_bridge" top-level key.',
    );
  }

  const loadedConfig = (loadedYaml as any).homenet_bridge as HomenetBridgeConfig;

  // Normalize packet_defaults duration values
  if (loadedConfig.packet_defaults) {
    const pd = loadedConfig.packet_defaults;
    if (pd.rx_timeout !== undefined) {
      pd.rx_timeout = parseDuration(pd.rx_timeout as any);
    }
    if (pd.tx_delay !== undefined) {
      pd.tx_delay = parseDuration(pd.tx_delay as any);
    }
    if (pd.tx_timeout !== undefined) {
      pd.tx_timeout = parseDuration(pd.tx_timeout as any);
    }
    logger.debug({ packet_defaults: pd }, '[config] Normalized packet_defaults');
  }

  const hasEntities = ENTITY_TYPE_KEYS.some((type) => loadedConfig[type] && Array.isArray(loadedConfig[type]));

  if (!hasEntities) {
    throw new Error('Configuration file must contain at least one entity (e.g., light, climate).');
  }

  return loadedConfig;
}

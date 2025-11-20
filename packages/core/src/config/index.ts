import { HomenetBridgeConfig } from './types.js';
import { loadYamlConfig } from './yaml-loader.js';
import { logger } from '../utils/logger.js';

export async function loadConfig(configPath: string): Promise<HomenetBridgeConfig> {
    logger.info(`[core] Loading configuration from: ${configPath}`);
    const loadedYaml = await loadYamlConfig(configPath);

    if (!loadedYaml || !(loadedYaml as any).homenet_bridge) {
        throw new Error(
            'Invalid configuration file structure. Missing "homenet_bridge" top-level key.',
        );
    }

    const loadedConfig = (loadedYaml as any).homenet_bridge as HomenetBridgeConfig;
    const entityTypes: (keyof HomenetBridgeConfig)[] = [
        'light',
        'climate',
        'valve',
        'button',
        'sensor',
        'fan',
        'switch',
        'binary_sensor',
    ];
    const hasEntities = entityTypes.some(
        (type) => loadedConfig[type] && Array.isArray(loadedConfig[type]),
    );

    if (!hasEntities) {
        throw new Error(
            'Configuration file must contain at least one entity (e.g., light, climate).',
        );
    }

    return loadedConfig;
}
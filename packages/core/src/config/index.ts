import { HomenetBridgeConfig } from './types.js';
import { loadYamlConfig } from './yaml-loader.js';
import { logger } from '../utils/logger.js';
import { parseDuration } from '../utils/duration.js';
import { ENTITY_TYPE_KEYS } from '../utils/entities.js';

export function normalizeConfig(config: HomenetBridgeConfig) {
  ENTITY_TYPE_KEYS.forEach((type) => {
    const entities = config[type] as Array<Record<string, unknown>> | undefined;
    if (!entities) return;

    entities.forEach((entity) => {
      if (entity && typeof entity === 'object' && !('id' in entity) && 'name' in entity && typeof entity.name === 'string') {
        const slug = entity.name
          .toString()
          .toLowerCase()
          .trim()
          .replace(/[_\s-]+/g, '_')
          .replace(/[^a-z0-9_]/g, '');
        entity.id = slug;
        logger.trace({ entity: entity.name, id: slug }, '[config] Generated entity ID from name');
      }
    });
  });

  if (config.packet_defaults) {
    const pd = config.packet_defaults;
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

  if (config.serial?.parity) {
    config.serial.parity = config.serial.parity.toString().toLowerCase() as HomenetBridgeConfig['serial']['parity'];
  }

  return config;
}

export function validateConfig(config: HomenetBridgeConfig): void {
  const errors: string[] = [];

  if (!config.serial) {
    errors.push('serial 설정이 누락되었습니다.');
  } else {
    const { baud_rate, data_bits, parity, stop_bits } = config.serial;
    const allowedDataBits = [5, 6, 7, 8];
    const allowedParity = ['none', 'even', 'mark', 'odd', 'space'];
    const allowedStopBits = [1, 1.5, 2];

    if (typeof baud_rate !== 'number' || Number.isNaN(baud_rate)) {
      errors.push('serial.baud_rate는 숫자여야 합니다.');
    }
    if (!allowedDataBits.includes(data_bits)) {
      errors.push(`serial.data_bits는 ${allowedDataBits.join(', ')} 중 하나여야 합니다.`);
    }
    if (!allowedParity.includes(parity as string)) {
      errors.push(`serial.parity는 ${allowedParity.join(', ')} 중 하나여야 합니다.`);
    }
    if (!allowedStopBits.includes(stop_bits)) {
      errors.push(`serial.stop_bits는 ${allowedStopBits.join(', ')} 중 하나여야 합니다.`);
    }
  }

  if (config.packet_defaults) {
    const { rx_checksum, rx_checksum2, tx_checksum, tx_checksum2 } = config.packet_defaults;
    if (rx_checksum && rx_checksum2) {
      errors.push('packet_defaults에서 rx_checksum과 rx_checksum2는 동시에 설정할 수 없습니다.');
    }
    if (tx_checksum && tx_checksum2) {
      errors.push('packet_defaults에서 tx_checksum과 tx_checksum2는 동시에 설정할 수 없습니다.');
    }
  }

  const hasEntities = ENTITY_TYPE_KEYS.some((type) => config[type] && Array.isArray(config[type]) && (config[type] as any[]).length > 0);

  if (!hasEntities) {
    errors.push('최소 한 개 이상의 엔터티(light, climate 등)가 설정되어야 합니다.');
  }

  ENTITY_TYPE_KEYS.forEach((type) => {
    const entities = config[type] as Array<Record<string, unknown>> | undefined;
    if (!entities) return;

    if (!Array.isArray(entities)) {
      errors.push(`${String(type)} 항목은 배열이어야 합니다.`);
      return;
    }

    entities.forEach((entity, index) => {
      if (!entity || typeof entity !== 'object') {
        errors.push(`${String(type)}[${index}]는 객체여야 합니다.`);
        return;
      }

      if (!('id' in entity) || typeof entity.id !== 'string' || !entity.id.trim()) {
        errors.push(`${String(type)}[${index}]에 유효한 id(문자열)가 필요합니다.`);
      }
    });
  });

  if (errors.length > 0) {
    throw new Error(`설정 검증에 실패했습니다:\n- ${errors.join('\n- ')}`);
  }
}

export async function loadConfig(configPath: string): Promise<HomenetBridgeConfig> {
  logger.info(`[core] Loading configuration from: ${configPath}`);
  const loadedYaml = await loadYamlConfig(configPath);

  if (!loadedYaml || !(loadedYaml as any).homenet_bridge) {
    throw new Error(
      'Invalid configuration file structure. Missing "homenet_bridge" top-level key.',
    );
  }

  const loadedConfig = normalizeConfig((loadedYaml as any).homenet_bridge as HomenetBridgeConfig);

  validateConfig(loadedConfig);

  return loadedConfig;
}

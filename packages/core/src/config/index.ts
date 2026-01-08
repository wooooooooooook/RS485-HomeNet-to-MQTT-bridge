import yaml from 'js-yaml';
import fs from 'node:fs/promises';
import { HomenetBridgeConfig, SerialConfig } from './types.js';
import { logger } from '../utils/logger.js';
import { parseDuration } from '../utils/duration.js';
import { ENTITY_TYPE_KEYS } from '../utils/entities.js';

async function loadYamlConfig(filePath: string): Promise<any> {
  const fileContent = await fs.readFile(filePath, 'utf8');
  return yaml.load(fileContent);
}

function normalizeSerialConfig(serial: SerialConfig): SerialConfig {
  const normalized = { ...serial };

  if (normalized.portId) {
    normalized.portId = normalized.portId.toString().trim();
  } else {
    normalized.portId = 'default';
    logger.warn('[config] portId가 비어 있어 "default"로 대체합니다.');
  }

  if (normalized.path) {
    normalized.path = normalized.path.toString().trim();
  }

  if (normalized.parity) {
    normalized.parity = normalized.parity.toString().toLowerCase() as SerialConfig['parity'];
  }

  if (normalized.serial_idle === undefined) {
    normalized.serial_idle = parseDuration('10m');
  } else {
    normalized.serial_idle = parseDuration(normalized.serial_idle as any);
  }

  return normalized;
}

export function normalizeConfig(config: HomenetBridgeConfig) {
  const automationAlias = (config as any).automations;
  if (Array.isArray(automationAlias)) {
    if (Array.isArray(config.automation)) {
      config.automation = [...config.automation, ...automationAlias];
      logger.warn('[config] "automations" 키를 "automation" 배열에 병합했습니다.');
    } else {
      config.automation = automationAlias;
      logger.info('[config] "automations" 키를 "automation"으로 처리했습니다.');
    }
  }

  const normalizedSerial = config.serial ? normalizeSerialConfig(config.serial) : undefined;
  if (normalizedSerial) {
    config.serial = normalizedSerial;
    config.serials = [normalizedSerial];
  } else {
    // 비정상 입력을 대비해 기본 구조만 유지하고, 검증 단계에서 에러를 던집니다.
    config.serials = [];
  }

  const portId = normalizedSerial?.portId ?? 'default';
  const usedIds = new Set<string>();
  const usedUniqueIds = new Set<string>();

  ENTITY_TYPE_KEYS.forEach((type) => {
    const entities = config[type] as Array<Record<string, unknown>> | undefined;
    if (!entities) return;

    entities.forEach((entity) => {
      if (
        entity &&
        typeof entity === 'object' &&
        !('id' in entity) &&
        'name' in entity &&
        typeof entity.name === 'string'
      ) {
        const slug = entity.name
          .toString()
          .toLowerCase()
          .trim()
          .replace(/[_\s-]+/g, '_')
          .replace(/[^a-z0-9_]/g, '');
        entity.id = slug;
        logger.trace({ entity: entity.name, id: slug }, '[config] Generated entity ID from name');
      }

      if (entity && typeof entity === 'object' && 'id' in entity) {
        let currentId = (entity as any).id;
        if (typeof currentId === 'string' && currentId.trim().length > 0) {
          currentId = currentId.trim();
          const originalId = currentId;
          let suffix = 2;

          while (usedIds.has(currentId)) {
            currentId = `${originalId}_${suffix}`;
            suffix += 1;
          }

          if (currentId !== originalId) {
            (entity as any).id = currentId;
            logger.warn(
              { original: originalId, new: currentId },
              '[config] Detected duplicate entity ID, renamed to avoid conflict',
            );
          }
          usedIds.add(currentId);
        }
      }

      if (entity && typeof entity === 'object') {
        const idValue = (entity as any).id;
        const uniqueIdValue = (entity as any).unique_id;
        const trimmedUniqueId =
          typeof uniqueIdValue === 'string' ? uniqueIdValue.trim() : undefined;
        const legacyDefault =
          typeof idValue === 'string' && idValue.trim().length > 0 ? `homenet_${idValue}` : '';
        const needsUniqueId = typeof trimmedUniqueId !== 'string' || trimmedUniqueId.length === 0;

        if (needsUniqueId && typeof idValue === 'string' && idValue.trim()) {
          (entity as any).unique_id = `homenet_${portId}_${idValue}`;
          logger.trace(
            { entity: idValue, unique_id: (entity as any).unique_id },
            '[config] Added default unique_id',
          );
        } else if (trimmedUniqueId === legacyDefault && typeof idValue === 'string') {
          (entity as any).unique_id = `homenet_${portId}_${idValue}`;
          logger.info(
            { entity: idValue, unique_id: (entity as any).unique_id },
            '[config] Updated legacy unique_id with portId prefix',
          );
        } else if (trimmedUniqueId) {
          (entity as any).unique_id = trimmedUniqueId;
        }

        const candidateUniqueId = (entity as any).unique_id;
        if (typeof candidateUniqueId === 'string' && candidateUniqueId.trim().length > 0) {
          let uniqueCandidate = candidateUniqueId;
          let suffix = 2;
          while (usedUniqueIds.has(uniqueCandidate)) {
            uniqueCandidate = `${candidateUniqueId}_${suffix}`;
            suffix += 1;
          }

          if (uniqueCandidate !== candidateUniqueId) {
            logger.warn(
              { entity: idValue, unique_id: uniqueCandidate },
              '[config] Detected duplicate unique_id, applied suffix to avoid conflict',
            );
            (entity as any).unique_id = uniqueCandidate;
          }

          usedUniqueIds.add((entity as any).unique_id);
        }
      }
    });
  });

  if (!config.scripts) {
    config.scripts = [];
  }

  if (config.scripts && Array.isArray(config.scripts)) {
    config.scripts.forEach((script) => {
      // script.id가 존재할 때만 처리 (없으면 validateConfig에서 걸러짐)
      if (script && typeof script === 'object' && script.id) {
        let currentId = script.id;
        const originalId = currentId;
        let suffix = 2;

        while (usedIds.has(currentId)) {
          currentId = `${originalId}_${suffix}`;
          suffix += 1;
        }

        if (currentId !== originalId) {
          script.id = currentId;
          logger.warn(
            { original: originalId, new: currentId },
            '[config] Detected duplicate script ID, renamed to avoid conflict',
          );
        }
        usedIds.add(currentId);
      }
    });
  }

  if (config.automation && Array.isArray(config.automation)) {
    config.automation.forEach((auto) => {
      if (auto && typeof auto === 'object' && auto.id) {
        let currentId = auto.id;
        const originalId = currentId;
        let suffix = 2;

        while (usedIds.has(currentId)) {
          currentId = `${originalId}_${suffix}`;
          suffix += 1;
        }

        if (currentId !== originalId) {
          auto.id = currentId;
          logger.warn(
            { original: originalId, new: currentId },
            '[config] Detected duplicate automation ID, renamed to avoid conflict',
          );
        }
        usedIds.add(currentId);
      }

      const hasThen = Array.isArray((auto as any).then);
      const hasActions = Array.isArray((auto as any).actions);
      if (!hasThen && hasActions) {
        (auto as any).then = (auto as any).actions;
        delete (auto as any).actions;
      }

      if (!auto.trigger) return;
      const hasSchedule = auto.trigger.some((t) => t.type === 'schedule');
      if (hasSchedule) {
        const injectLowPriority = (actions: any[] | undefined) => {
          if (!actions) return;
          actions.forEach((action) => {
            if (action.action === 'command' && action.low_priority === undefined) {
              action.low_priority = true;
            }
          });
        };
        injectLowPriority(auto.then);
        injectLowPriority(auto.else);
      }
    });
  }

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

  return config;
}

export function validateConfig(
  config: HomenetBridgeConfig,
  rawConfig?: Partial<HomenetBridgeConfig> | null,
): void {
  const errors: string[] = [];

  if (rawConfig && (rawConfig as any).serials !== undefined) {
    errors.push('serials 키는 더 이상 지원되지 않습니다. serial을 사용하세요.');
  }

  if ((config as any).mqtt_topic_prefix !== undefined) {
    errors.push(
      'mqtt_topic_prefix는 더 이상 설정 파일에 정의할 수 없습니다. MQTT_TOPIC_PREFIX 환경변수를 사용하세요.',
    );
  }

  if (!config.serial) {
    errors.push('serial 설정은 필수입니다.');
  }

  if (!config.serials || !Array.isArray(config.serials) || config.serials.length === 0) {
    errors.push('serial 설정에 최소 1개 이상의 포트가 필요합니다.');
  } else if (config.serials.length !== 1) {
    errors.push(
      '각 설정 파일에는 단일 serial만 선언할 수 있습니다. 파일을 분리하여 포트를 나눠주세요.',
    );
  }

  if (config.serial) {
    const allowedDataBits = [5, 6, 7, 8];
    const allowedParity = ['none', 'even', 'mark', 'odd', 'space'];
    const allowedStopBits = [1, 1.5, 2];

    const serial = config.serial;
    if ((serial as any).mqtt_topic_prefix !== undefined) {
      errors.push(
        'serial.mqtt_topic_prefix는 지원되지 않습니다. MQTT_TOPIC_PREFIX 환경변수를 사용하세요.',
      );
    }
    if (!serial.portId || typeof serial.portId !== 'string') {
      errors.push('serial.portId는 필수 문자열입니다.');
    }

    if (!serial.path || typeof serial.path !== 'string' || !serial.path.trim()) {
      errors.push('serial.path는 비어 있지 않은 문자열이어야 합니다.');
    }

    if (typeof serial.baud_rate !== 'number' || Number.isNaN(serial.baud_rate)) {
      errors.push('serial.baud_rate는 숫자여야 합니다.');
    }
    if (!allowedDataBits.includes(serial.data_bits)) {
      errors.push(`serial.data_bits는 ${allowedDataBits.join(', ')} 중 하나여야 합니다.`);
    }
    if (!allowedParity.includes(serial.parity as string)) {
      errors.push(`serial.parity는 ${allowedParity.join(', ')} 중 하나여야 합니다.`);
    }
    if (!allowedStopBits.includes(serial.stop_bits)) {
      errors.push(`serial.stop_bits는 ${allowedStopBits.join(', ')} 중 하나여야 합니다.`);
    }
    if (
      serial.serial_idle !== undefined &&
      (typeof serial.serial_idle !== 'number' || Number.isNaN(serial.serial_idle))
    ) {
      errors.push('serial.serial_idle은 숫자(ms) 또는 duration 문자열이어야 합니다.');
    } else if (typeof serial.serial_idle === 'number' && serial.serial_idle < 0) {
      errors.push('serial.serial_idle은 0 이상이어야 하며, 0이면 비활성화됩니다.');
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

  if (config.scripts !== undefined) {
    if (!Array.isArray(config.scripts)) {
      errors.push('scripts 항은 배열이어야 합니다.');
    } else {
      const scriptIds = new Set<string>();
      config.scripts.forEach((script, index) => {
        if (!script || typeof script !== 'object') {
          errors.push(`scripts[${index}]는 객체여야 합니다.`);
          return;
        }

        if (typeof script.id !== 'string' || !script.id.trim()) {
          errors.push(`scripts[${index}]에 유효한 id(문자열)가 필요합니다.`);
        } else {
          scriptIds.add(script.id);
        }

        if (!Array.isArray(script.actions) || script.actions.length === 0) {
          errors.push(`scripts[${index}]에는 최소 1개의 action이 필요합니다.`);
        } else {
          script.actions.forEach((action, actionIndex) => {
            if (
              !action ||
              typeof action !== 'object' ||
              typeof (action as any).action !== 'string'
            ) {
              errors.push(
                `scripts[${index}].actions[${actionIndex}]에 유효한 action 필드가 필요합니다.`,
              );
            }
          });
        }
      });
    }
  }

  if (rawConfig) {
    const rawAutomationList = (rawConfig as any).automation as Array<
      Record<string, unknown>
    > | null;
    const rawAutomationsAlias = (rawConfig as any).automations as Array<
      Record<string, unknown>
    > | null;
    const candidates = [rawAutomationList, rawAutomationsAlias].filter((value) =>
      Array.isArray(value),
    ) as Array<Array<Record<string, unknown>>>;

    candidates.forEach((rawAutomations) => {
      rawAutomations.forEach((automation, index) => {
        if (!automation || typeof automation !== 'object') {
          return;
        }
        if ('then' in automation && 'actions' in automation) {
          errors.push(`automation[${index}]에서는 then과 actions를 동시에 정의할 수 없습니다.`);
        }
      });
    });
  }

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

  const rawConfig = (loadedYaml as any).homenet_bridge as HomenetBridgeConfig;
  const normalizedInput = JSON.parse(JSON.stringify(rawConfig)) as HomenetBridgeConfig;
  const loadedConfig = normalizeConfig(normalizedInput);

  validateConfig(loadedConfig, rawConfig);

  return loadedConfig;
}

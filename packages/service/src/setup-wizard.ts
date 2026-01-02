import type { Express } from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';
import yaml from 'js-yaml';
import { type HomenetBridgeConfig, normalizeConfig, normalizePortId } from '@rs485-homenet/core';
import type { SerialConfig } from '@rs485-homenet/core/config/types';
import { createSerialPortConnection } from '@rs485-homenet/core/transports/serial/serial.factory';

type SetupWizardState = {
  defaultConfigName: string | null;
  hasDefaultConfig: boolean;
  hasInitMarker: boolean;
  requiresInitialization: boolean;
  configFiles: string[];
};

type SetupWizardService = {
  getInitializationState: () => Promise<SetupWizardState>;
  registerRoutes: (app: Express) => void;
};

type SetupWizardDeps = {
  configDir: string;
  examplesDir: string;
  defaultConfigFilename: string;
  configInitMarker: string;
  configRestartFlag: string;
  envConfigFilesSource: string | null;
  fileExists: (targetPath: string) => Promise<boolean>;
  dumpConfigToYaml: (config: any, options?: yaml.DumpOptions) => string;
  saveBackup: (configPath: string, config: any, reason: string) => Promise<string>;
  triggerRestart: () => Promise<void>;
  serialTestRateLimiter: { check: (key: string) => boolean };
  configRateLimiter?: { check: (key: string) => boolean };
  logger: {
    info: (msg: string | Record<string, unknown>, ...args: unknown[]) => void;
    warn: (msg: string | Record<string, unknown>, ...args: unknown[]) => void;
    error: (msg: string | Record<string, unknown>, ...args: unknown[]) => void;
  };
  getLoadedConfigs: () => HomenetBridgeConfig[];
};

const EMPTY_CONFIG_SENTINEL = '__empty__';
const SERIAL_DATA_BITS = [5, 6, 7, 8] as const;
const SERIAL_PARITY = ['none', 'even', 'mark', 'odd', 'space'] as const;
const SERIAL_STOP_BITS = [1, 1.5, 2] as const;

const ENTITY_TYPE_KEYS = [
  'light',
  'climate',
  'valve',
  'button',
  'sensor',
  'fan',
  'switch',
  'lock',
  'number',
  'select',
  'text_sensor',
  'text',
  'binary_sensor',
] as const;

const DEFAULT_PACKET_DEFAULTS = {
  rx_timeout: '10ms',
  tx_timeout: '500ms',
  tx_delay: '50ms',
  tx_retry_cnt: 3,
};

const applySerialPathToConfig = (
  configObject: unknown,
  serialPath: string,
  portId?: string,
  packetDefaults?: Record<string, unknown>,
): boolean => {
  if (!configObject || typeof configObject !== 'object') {
    return false;
  }

  const bridgeConfig =
    (configObject as Record<string, unknown>).homenet_bridge ||
    (configObject as Record<string, unknown>).homenetBridge ||
    configObject;

  if (!bridgeConfig || typeof bridgeConfig !== 'object') {
    return false;
  }

  let updated = false;
  const normalizedPath = serialPath.trim();
  const normalizedPortId = portId?.trim();

  if ((bridgeConfig as Record<string, unknown>).serial) {
    const serial = (bridgeConfig as Record<string, unknown>).serial as Record<string, unknown>;
    const updatedSerial: Record<string, unknown> = { ...serial, path: normalizedPath };
    if (normalizedPortId) {
      updatedSerial.portId = normalizedPortId;
    }
    (bridgeConfig as Record<string, unknown>).serial = updatedSerial;
    updated = true;
  }

  const serials = (bridgeConfig as Record<string, unknown>).serials;
  if (Array.isArray(serials)) {
    (bridgeConfig as Record<string, unknown>).serials = serials.map((serial: unknown) => {
      if (!serial || typeof serial !== 'object') return serial;
      const updatedSerial: Record<string, unknown> = {
        ...(serial as Record<string, unknown>),
        path: normalizedPath,
      };
      if (normalizedPortId) {
        updatedSerial.portId = normalizedPortId;
      }
      return updatedSerial;
    });
    updated = true;
  }

  // Apply packet defaults
  if (packetDefaults) {
    (bridgeConfig as Record<string, unknown>).packet_defaults = { ...packetDefaults };
    updated = true;
  }

  return updated;
};

const parseSerialConfigPayload = (
  payload: unknown,
): { serialConfig?: SerialConfig; error?: string } => {
  if (!payload || typeof payload !== 'object') {
    return { error: 'SERIAL_CONFIG_REQUIRED' };
  }

  const data = payload as Record<string, unknown>;
  const portId = typeof data.portId === 'string' ? data.portId.trim() : '';
  const pathValue = typeof data.path === 'string' ? data.path.trim() : '';
  const baudRateValue = Number(data.baud_rate);
  const dataBitsValue = Number(data.data_bits);
  const parityValue = typeof data.parity === 'string' ? data.parity : '';
  const stopBitsValue = Number(data.stop_bits);

  if (!portId) {
    return { error: 'SERIAL_PORT_ID_REQUIRED' };
  }

  if (!pathValue) {
    return { error: 'SERIAL_PATH_REQUIRED' };
  }

  if (!Number.isFinite(baudRateValue) || baudRateValue <= 0) {
    return { error: 'SERIAL_BAUD_RATE_INVALID' };
  }

  if (!SERIAL_DATA_BITS.includes(dataBitsValue as SerialConfig['data_bits'])) {
    return { error: 'SERIAL_DATA_BITS_INVALID' };
  }

  if (!SERIAL_PARITY.includes(parityValue as SerialConfig['parity'])) {
    return { error: 'SERIAL_PARITY_INVALID' };
  }

  if (!SERIAL_STOP_BITS.includes(stopBitsValue as SerialConfig['stop_bits'])) {
    return { error: 'SERIAL_STOP_BITS_INVALID' };
  }

  return {
    serialConfig: {
      portId,
      path: pathValue,
      baud_rate: baudRateValue,
      data_bits: dataBitsValue as SerialConfig['data_bits'],
      parity: parityValue as SerialConfig['parity'],
      stop_bits: stopBitsValue as SerialConfig['stop_bits'],
    },
  };
};

const buildEmptyConfig = (
  serialConfig: SerialConfig,
  packetDefaults?: Record<string, unknown>,
) => ({
  homenet_bridge: {
    serial: serialConfig,
    ...(packetDefaults && { packet_defaults: packetDefaults }),
  },
});

const extractSerialConfig = (config: HomenetBridgeConfig): SerialConfig | null => {
  if (Array.isArray(config.serials) && config.serials.length > 0) {
    return config.serials[0];
  }

  const legacySerial = (config as { serial?: SerialConfig }).serial;
  return legacySerial ?? null;
};

const collectSerialPackets = async (
  serialPath: string,
  serialConfig: SerialConfig,
  options?: { maxPackets?: number; timeoutMs?: number },
): Promise<string[]> => {
  const maxPackets = options?.maxPackets ?? 5;
  const timeoutMs = options?.timeoutMs ?? 5000;
  const packets: string[] = [];
  const port = await createSerialPortConnection(serialPath, serialConfig, timeoutMs);

  return new Promise<string[]>((resolve, reject) => {
    let finished = false;

    const cleanup = async () => {
      if (finished) return;
      finished = true;
      port.off('data', onData);
      port.off('error', onError);

      if (
        typeof (port as any).isOpen === 'boolean' &&
        (port as any).isOpen &&
        typeof (port as any).close === 'function'
      ) {
        await new Promise<void>((resolveClose) => (port as any).close(() => resolveClose()));
      } else {
        port.destroy();
      }

      // Wait for OS to release lock
      await new Promise((r) => setTimeout(r, 500));
    };

    const timeout = setTimeout(async () => {
      await cleanup();
      resolve(packets);
    }, timeoutMs);

    const resolveWithTimeout = async (value: string[]) => {
      clearTimeout(timeout);
      await cleanup();
      resolve(value);
    };

    const rejectWithTimeout = async (error: Error) => {
      clearTimeout(timeout);
      await cleanup();
      reject(error);
    };

    const onData = (data: Buffer) => {
      packets.push(data.toString('hex').toUpperCase());
      if (packets.length >= maxPackets) {
        resolveWithTimeout(packets);
      }
    };

    const onError = (error: Error) => {
      rejectWithTimeout(error);
    };

    port.on('data', onData);
    port.once('error', onError);
  });
};

export const createSetupWizardService = ({
  configDir,
  examplesDir,
  defaultConfigFilename,
  configInitMarker,
  configRestartFlag,
  envConfigFilesSource,
  fileExists,
  dumpConfigToYaml,
  saveBackup,
  triggerRestart,
  serialTestRateLimiter,
  configRateLimiter,
  logger,
  getLoadedConfigs,
}: SetupWizardDeps): SetupWizardService => {
  let isSerialTestRunning = false;

  const listExampleConfigs = async (): Promise<string[]> => {
    try {
      const files = await fs.readdir(examplesDir);
      return files.filter((file) => file.endsWith('.yaml'));
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      if (err.code === 'ENOENT') return [];
      throw error;
    }
  };

  const getDefaultConfigFilename = async (): Promise<string | null> => {
    const defaultPath = path.join(configDir, defaultConfigFilename);

    if (await fileExists(defaultPath)) return defaultConfigFilename;
    return null;
  };

  const getInitializationState = async (): Promise<SetupWizardState> => {
    const [defaultConfigName, hasInitMarker, allFiles] = await Promise.all([
      getDefaultConfigFilename(),
      fileExists(configInitMarker),
      fs.readdir(configDir).catch(() => []),
    ]);

    const configFiles = allFiles.filter(
      (file) => file === defaultConfigFilename || /\.homenet_bridge\.ya?ml$/.test(file),
    );

    return {
      defaultConfigName,
      hasDefaultConfig: Boolean(defaultConfigName),
      hasInitMarker,
      requiresInitialization: !hasInitMarker,
      configFiles,
    };
  };

  const getNextConfigFilename = async (): Promise<string> => {
    const files = await fs.readdir(configDir).catch(() => []);
    const bridgeFiles = files.filter((f) => /^default(_\d+)?\.homenet_bridge\.yaml$/.test(f));

    if (bridgeFiles.length === 0) return defaultConfigFilename;

    let maxSuffix = 1;
    for (const file of bridgeFiles) {
      if (file === defaultConfigFilename) continue;
      const match = file.match(/^default_(\d+)\.homenet_bridge\.yaml$/);
      if (match) {
        const suffix = parseInt(match[1], 10);
        if (suffix > maxSuffix) maxSuffix = suffix;
      }
    }

    return `default_${maxSuffix + 1}.homenet_bridge.yaml`;
  };

  const checkDuplicateSerial = async (
    targetPath: string,
    targetPortId?: string,
  ): Promise<{ error: string } | null> => {
    const loadedConfigs = getLoadedConfigs();

    for (const config of loadedConfigs) {
      if (!config) continue;

      const serials = config.serials || (config.serial ? [config.serial] : []);

      for (let i = 0; i < serials.length; i++) {
        const serial = serials[i];
        if (!serial) continue;

        if (serial.path === targetPath) {
          return { error: 'SERIAL_PATH_DUPLICATE' };
        }

        if (targetPortId) {
          const existingPortId = normalizePortId(serial.portId, i);
          if (existingPortId === targetPortId) {
            return { error: 'PORT_ID_DUPLICATE' };
          }
        }
      }
    }
    return null;
  };

  const registerRoutes = (app: Express) => {
    app.get('/api/config/examples', async (_req, res) => {
      try {
        const [state, examples] = await Promise.all([
          getInitializationState(),
          listExampleConfigs(),
        ]);

        res.json({
          configRoot: configDir,
          examples,
          defaultConfigName: state.defaultConfigName,
          requiresInitialization: state.requiresInitialization,
          hasInitMarker: state.hasInitMarker,
          hasCustomConfig: envConfigFilesSource !== 'default',
        });
      } catch (error) {
        logger.error({ err: error }, '[service] Failed to list example configs');
        res.status(500).json({ error: '예제 설정을 불러오지 못했습니다.' });
      }
    });

    app.get('/api/config/examples/:filename/serial', async (req, res) => {
      try {
        const { filename } = req.params;

        if (!filename || filename.includes('/') || filename.includes('\\')) {
          return res.status(400).json({ error: 'INVALID_FILENAME' });
        }

        const examples = await listExampleConfigs();
        if (!examples.includes(filename)) {
          return res.status(404).json({ error: 'EXAMPLE_NOT_FOUND' });
        }

        const sourcePath = path.join(examplesDir, filename);

        try {
          const rawContent = await fs.readFile(sourcePath, 'utf-8');
          const parsedConfig = yaml.load(rawContent) as Record<string, unknown>;

          const bridgeConfig =
            parsedConfig.homenet_bridge || parsedConfig.homenetBridge || parsedConfig;

          if (!bridgeConfig || typeof bridgeConfig !== 'object') {
            return res.status(400).json({ error: 'SERIAL_CONFIG_MISSING' });
          }

          const bridgeObj = bridgeConfig as Record<string, unknown>;
          let serialConfig: Record<string, unknown> | null = null;

          if (bridgeObj.serial && typeof bridgeObj.serial === 'object') {
            serialConfig = bridgeObj.serial as Record<string, unknown>;
          } else if (Array.isArray(bridgeObj.serials) && bridgeObj.serials.length > 0) {
            serialConfig = bridgeObj.serials[0] as Record<string, unknown>;
          }

          const packetDefaults = bridgeObj.packet_defaults || DEFAULT_PACKET_DEFAULTS;

          if (!serialConfig) {
            return res.status(400).json({ error: 'SERIAL_CONFIG_MISSING' });
          }

          // Exclude 'path' from response as user needs to enter this
          const { path: _path, ...serialSettings } = serialConfig;

          res.json({
            ok: true,
            serial: serialSettings,
            packetDefaults,
          });
        } catch (error) {
          logger.error(
            { err: error, sourcePath },
            '[service] Failed to read example config for serial info',
          );
          return res.status(500).json({ error: 'EXAMPLE_READ_FAILED' });
        }
      } catch (error) {
        logger.error({ err: error }, '[service] Failed to get example serial config');
        res.status(500).json({ error: 'UNKNOWN_ERROR' });
      }
    });

    app.get('/api/config/examples/:filename/entities', async (req, res) => {
      try {
        const { filename } = req.params;

        if (!filename || filename.includes('/') || filename.includes('\\')) {
          return res.status(400).json({ error: 'INVALID_FILENAME' });
        }

        const examples = await listExampleConfigs();
        if (!examples.includes(filename)) {
          return res.status(404).json({ error: 'EXAMPLE_NOT_FOUND' });
        }

        const sourcePath = path.join(examplesDir, filename);
        let parsedConfig: Record<string, any>;

        try {
          const rawContent = await fs.readFile(sourcePath, 'utf-8');
          parsedConfig = yaml.load(rawContent) as Record<string, any>;
        } catch (error) {
          logger.error(
            { err: error, sourcePath },
            '[service] Failed to read example config for entities',
          );
          return res.status(500).json({ error: 'EXAMPLE_READ_FAILED' });
        }

        const bridgeConfig =
          parsedConfig.homenet_bridge || parsedConfig.homenetBridge || parsedConfig;

        // Normalize to ensure IDs are generated
        try {
          normalizeConfig(parsedConfig as HomenetBridgeConfig);
        } catch (e) {
          // Ignore validation errors, we just want ID generation
        }

        if (!bridgeConfig || typeof bridgeConfig !== 'object') {
          return res.status(200).json({ entities: {} });
        }

        const entities: Record<string, any[]> = {};

        for (const type of ENTITY_TYPE_KEYS) {
          const items = bridgeConfig[type];
          if (Array.isArray(items) && items.length > 0) {
            entities[type] = items.map((item: any) => ({
              id: item.id,
              name: item.name || item.id,
            }));
          }
        }

        res.json({ entities });
      } catch (error) {
        logger.error({ err: error }, '[service] Failed to get example entities');
        res.status(500).json({ error: 'UNKNOWN_ERROR' });
      }
    });

    app.post('/api/config/examples/test-serial', async (req, res) => {
      if (!serialTestRateLimiter.check(req.ip || 'unknown')) {
        logger.warn({ ip: req.ip }, '[service] Serial test rate limit exceeded');
        return res.status(429).json({ error: 'Too many requests' });
      }

      if (isSerialTestRunning) {
        return res.status(409).json({ error: 'TEST_ALREADY_RUNNING' });
      }
      isSerialTestRunning = true;

      try {
        const { filename, serialPath, serialConfig, portId } = req.body || {};

        if (typeof filename !== 'string' || filename.includes('/') || filename.includes('\\')) {
          return res.status(400).json({ error: 'INVALID_FILENAME' });
        }

        if (filename === EMPTY_CONFIG_SENTINEL) {
          const parsed = parseSerialConfigPayload(serialConfig);
          if (!parsed.serialConfig) {
            return res.status(400).json({ error: parsed.error });
          }

          const packets = await collectSerialPackets(
            parsed.serialConfig.path,
            parsed.serialConfig,
            {
              maxPackets: 10,
              timeoutMs: 3000,
            },
          );

          res.json({
            ok: true,
            portId: normalizePortId(parsed.serialConfig.portId || 'raw', 0),
            packets,
          });
          return;
        }

        if (typeof serialPath !== 'string' || !serialPath.trim()) {
          return res.status(400).json({ error: 'SERIAL_PATH_REQUIRED' });
        }

        const examples = await listExampleConfigs();
        if (!examples.includes(filename)) {
          return res.status(404).json({ error: 'EXAMPLE_NOT_FOUND' });
        }

        const sourcePath = path.join(examplesDir, filename);
        let parsedConfig: unknown;

        try {
          const rawContent = await fs.readFile(sourcePath, 'utf-8');
          parsedConfig = yaml.load(rawContent);
        } catch (error) {
          logger.error(
            { err: error, sourcePath },
            '[service] Failed to read example config for test',
          );
          return res.status(500).json({ error: 'EXAMPLE_READ_FAILED' });
        }

        const serialPathValue = serialPath.trim();
        const portIdValue = typeof portId === 'string' ? portId.trim() : undefined;

        if (!applySerialPathToConfig(parsedConfig, serialPathValue, portIdValue)) {
          return res.status(400).json({ error: 'SERIAL_CONFIG_MISSING' });
        }

        const bridgeConfig =
          (parsedConfig as Record<string, unknown>).homenet_bridge ||
          (parsedConfig as Record<string, unknown>).homenetBridge ||
          parsedConfig;

        const normalized = normalizeConfig(
          JSON.parse(JSON.stringify(bridgeConfig)) as HomenetBridgeConfig,
        );
        const serialConfigValue = extractSerialConfig(normalized);

        if (!serialConfigValue) {
          return res.status(400).json({ error: 'SERIAL_CONFIG_MISSING' });
        }

        const packets = await collectSerialPackets(serialPathValue, serialConfigValue, {
          maxPackets: 10,
          timeoutMs: 3000,
        });

        res.json({
          ok: true,
          portId: normalizePortId(serialConfigValue.portId || 'raw', 0),
          packets,
        });
      } catch (error) {
        logger.error({ err: error }, '[service] Failed to test serial path during setup');
        const err = error as Error & { code?: string };
        res.status(500).json({
          error: 'SERIAL_TEST_FAILED',
          details: err.code || err.message || 'Unknown error',
        });
      } finally {
        isSerialTestRunning = false;
      }
    });

    app.post('/api/config/check-duplicate-serial', async (req, res) => {
      try {
        const { serialPath, portId } = req.body || {};
        const validation = await checkDuplicateSerial(serialPath, portId);
        if (validation) {
          return res.status(400).json({ error: validation.error });
        }
        res.json({ ok: true });
      } catch (error) {
        logger.error({ err: error }, '[service] Failed to check duplicate serial');
        res.status(500).json({ error: 'UNKNOWN_ERROR' });
      }
    });

    app.post('/api/config/examples/select', async (req, res) => {
      if (configRateLimiter && !configRateLimiter.check(req.ip || 'unknown')) {
        logger.warn({ ip: req.ip }, '[service] Setup wizard rate limit exceeded');
        return res.status(429).json({ error: 'Too many requests' });
      }

      try {
        const state = await getInitializationState();
        const {
          filename,
          serialPath,
          serialConfig,
          portId,
          packetDefaults,
          selectedEntities,
          mode,
        } = req.body || {};

        if (mode !== 'add' && !state.requiresInitialization) {
          return res.status(400).json({ error: 'INITIALIZATION_NOT_ALLOWED' });
        }
        if (typeof filename !== 'string' || filename.includes('/') || filename.includes('\\')) {
          return res.status(400).json({ error: 'INVALID_FILENAME' });
        }

        let targetFilename = defaultConfigFilename;
        if (mode === 'add') {
          // Duplication Check
          if (typeof serialPath === 'string') {
            const validation = await checkDuplicateSerial(serialPath.trim(), portId?.trim());
            if (validation) {
              return res.status(400).json({ error: validation.error });
            }
          }

          targetFilename = await getNextConfigFilename();
        }

        const targetPath = path.join(configDir, targetFilename);

        let updatedYaml = '';
        let serialPathValue = '';

        if (filename === EMPTY_CONFIG_SENTINEL) {
          const parsed = parseSerialConfigPayload(serialConfig);
          if (!parsed.serialConfig) {
            return res.status(400).json({ error: parsed.error });
          }

          serialPathValue = parsed.serialConfig.path;
          const emptyConfig = buildEmptyConfig(parsed.serialConfig, packetDefaults);
          updatedYaml = dumpConfigToYaml(emptyConfig, { lineWidth: 120 });
        } else {
          if (typeof serialPath !== 'string' || !serialPath.trim()) {
            return res.status(400).json({ error: 'SERIAL_PATH_REQUIRED' });
          }

          const examples = await listExampleConfigs();
          if (!examples.includes(filename)) {
            return res.status(404).json({ error: 'EXAMPLE_NOT_FOUND' });
          }

          const sourcePath = path.join(examplesDir, filename);
          serialPathValue = serialPath.trim();
          const portIdValue = typeof portId === 'string' ? portId.trim() : undefined;

          let parsedConfig: unknown;
          try {
            const rawContent = await fs.readFile(sourcePath, 'utf-8');
            parsedConfig = yaml.load(rawContent);
            // Normalize to ensure IDs are generated for matching
            try {
              normalizeConfig(parsedConfig as HomenetBridgeConfig);
            } catch (e) {
              // Ignore errors
            }
          } catch (error) {
            logger.error({ err: error, sourcePath }, '[service] Failed to read example config');
            return res.status(500).json({ error: 'EXAMPLE_READ_FAILED' });
          }

          if (
            !applySerialPathToConfig(parsedConfig, serialPathValue, portIdValue, packetDefaults)
          ) {
            return res.status(400).json({ error: 'SERIAL_CONFIG_MISSING' });
          }

          // Filter entities if selectedEntities is provided
          // selectedEntities structure: { [type]: [id1, id2, ...] }
          if (selectedEntities && typeof selectedEntities === 'object') {
            const bridgeConfig =
              (parsedConfig as any).homenet_bridge ||
              (parsedConfig as any).homenetBridge ||
              parsedConfig;

            if (bridgeConfig && typeof bridgeConfig === 'object') {
              for (const type of ENTITY_TYPE_KEYS) {
                // If the type is not in selectedEntities, it means NO entities of that type were selected
                // (assuming the UI sends all types).
                // However, to be safe, if a type key is missing from selectedEntities, we might assume
                // the user didn't touch it?
                // The requirements say "Entity Type - Entity Name hierarchy... default select all".
                // So if we receive selectedEntities, it should be the definitive list.
                // But let's check if the key exists in selectedEntities to avoid accidental deletion if UI doesn't send it.

                if (type in selectedEntities) {
                  const allowedIds = new Set(selectedEntities[type] || []);
                  const items = bridgeConfig[type];
                  if (Array.isArray(items)) {
                    const filtered = items.filter((item: any) => allowedIds.has(item.id));
                    if (filtered.length > 0) {
                      bridgeConfig[type] = filtered;
                    } else {
                      delete bridgeConfig[type];
                    }
                  }
                }
              }
            }
          }

          updatedYaml = dumpConfigToYaml(parsedConfig, { lineWidth: 120 });

          const bridgeConfigForCleanup =
            (parsedConfig as any).homenet_bridge ||
            (parsedConfig as any).homenetBridge ||
            parsedConfig;

          if (bridgeConfigForCleanup && typeof bridgeConfigForCleanup === 'object') {
            delete bridgeConfigForCleanup.serials;
          }

          updatedYaml = dumpConfigToYaml(parsedConfig, { lineWidth: 120 });
        }

        await fs.mkdir(configDir, { recursive: true });

        if (mode !== 'add' && (await fileExists(targetPath))) {
          try {
            const existingContent = await fs.readFile(targetPath, 'utf-8');
            const existingConfig = yaml.load(existingContent);
            if (existingConfig && typeof existingConfig === 'object') {
              const backupPath = await saveBackup(targetPath, existingConfig, 'init_overwrite');
              logger.info(`[service] Backed up existing config to ${path.basename(backupPath)}`);
            }
          } catch (err) {
            logger.warn({ err }, '[service] Failed to backup existing config during init');
          }
        }

        await fs.writeFile(targetPath, updatedYaml, 'utf-8');
        await fs.writeFile(configRestartFlag, 'restart', 'utf-8');

        logger.info(
          { filename, targetPath, serialPath: serialPathValue },
          '[service] Default config seeded from setup wizard',
        );

        res.json({
          ok: true,
          target: targetFilename,
          restartScheduled: true,
          requiresManualConfigUpdate: envConfigFilesSource !== 'default',
        });

        await triggerRestart();
      } catch (error) {
        logger.error({ err: error }, '[service] Failed to select example config');
        res.status(500).json({ error: '기본 설정 생성에 실패했습니다.' });
      }
    });
  };

  return {
    getInitializationState,
    registerRoutes,
  };
};

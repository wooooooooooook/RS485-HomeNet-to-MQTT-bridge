import type { Express } from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';
import yaml from 'js-yaml';
import {
  type HomenetBridgeConfig,
  normalizeConfig,
  normalizePortId,
} from '@rs485-homenet/core';
import type { SerialConfig } from '@rs485-homenet/core/config/types';
import { createSerialPortConnection } from '@rs485-homenet/core/transports/serial/serial.factory';

type SetupWizardState = {
  defaultConfigName: string | null;
  hasDefaultConfig: boolean;
  hasInitMarker: boolean;
  requiresInitialization: boolean;
};

type SetupWizardService = {
  getInitializationState: () => Promise<SetupWizardState>;
  registerRoutes: (app: Express) => void;
};

type SetupWizardDeps = {
  configDir: string;
  examplesDir: string;
  defaultConfigFilename: string;
  legacyDefaultConfigFilename: string;
  configInitMarker: string;
  configRestartFlag: string;
  envConfigFilesSource: string | null;
  fileExists: (targetPath: string) => Promise<boolean>;
  dumpConfigToYaml: (config: any, options?: yaml.DumpOptions) => string;
  saveBackup: (configPath: string, config: any, reason: string) => Promise<string>;
  triggerRestart: () => Promise<void>;
  serialTestRateLimiter: { check: (key: string) => boolean };
  logger: {
    info: (msg: string | Record<string, unknown>, ...args: unknown[]) => void;
    warn: (msg: string | Record<string, unknown>, ...args: unknown[]) => void;
    error: (msg: string | Record<string, unknown>, ...args: unknown[]) => void;
  };
};

const EMPTY_CONFIG_SENTINEL = '__empty__';
const SERIAL_DATA_BITS = [5, 6, 7, 8] as const;
const SERIAL_PARITY = ['none', 'even', 'mark', 'odd', 'space'] as const;
const SERIAL_STOP_BITS = [1, 1.5, 2] as const;

const applySerialPathToConfig = (configObject: unknown, serialPath: string): boolean => {
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

  if ((bridgeConfig as Record<string, unknown>).serial) {
    const serial = (bridgeConfig as Record<string, unknown>).serial as Record<string, unknown>;
    (bridgeConfig as Record<string, unknown>).serial = { ...serial, path: normalizedPath };
    updated = true;
  }

  const serials = (bridgeConfig as Record<string, unknown>).serials;
  if (Array.isArray(serials)) {
    (bridgeConfig as Record<string, unknown>).serials = serials.map((serial: unknown) => {
      if (!serial || typeof serial !== 'object') return serial;
      return { ...(serial as Record<string, unknown>), path: normalizedPath };
    });
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

const buildEmptyConfig = (serialConfig: SerialConfig) => ({
  homenet_bridge: {
    serial: serialConfig,
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
  const port = await createSerialPortConnection(serialPath, serialConfig);

  return new Promise<string[]>((resolve, reject) => {
    let finished = false;

    const cleanup = () => {
      if (finished) return;
      finished = true;
      port.off('data', onData);
      port.off('error', onError);
      port.destroy();
    };

    const timeout = setTimeout(() => {
      cleanup();
      resolve(packets);
    }, timeoutMs);

    const resolveWithTimeout = (value: string[]) => {
      clearTimeout(timeout);
      cleanup();
      resolve(value);
    };

    const rejectWithTimeout = (error: Error) => {
      clearTimeout(timeout);
      cleanup();
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
  legacyDefaultConfigFilename,
  configInitMarker,
  configRestartFlag,
  envConfigFilesSource,
  fileExists,
  dumpConfigToYaml,
  saveBackup,
  triggerRestart,
  serialTestRateLimiter,
  logger,
}: SetupWizardDeps): SetupWizardService => {
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
    const legacyDefaultPath = path.join(configDir, legacyDefaultConfigFilename);

    if (await fileExists(defaultPath)) return defaultConfigFilename;
    if (await fileExists(legacyDefaultPath)) return legacyDefaultConfigFilename;
    return null;
  };

  const getInitializationState = async (): Promise<SetupWizardState> => {
    const [defaultConfigName, hasInitMarker] = await Promise.all([
      getDefaultConfigFilename(),
      fileExists(configInitMarker),
    ]);

    return {
      defaultConfigName,
      hasDefaultConfig: Boolean(defaultConfigName),
      hasInitMarker,
      requiresInitialization: !hasInitMarker,
    };
  };

  const registerRoutes = (app: Express) => {
    app.get('/api/config/examples', async (_req, res) => {
      try {
        const [state, examples] = await Promise.all([getInitializationState(), listExampleConfigs()]);

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

    app.post('/api/config/examples/test-serial', async (req, res) => {
      if (!serialTestRateLimiter.check(req.ip || 'unknown')) {
        logger.warn({ ip: req.ip }, '[service] Serial test rate limit exceeded');
        return res.status(429).json({ error: 'Too many requests' });
      }

      try {
        const { filename, serialPath, serialConfig } = req.body || {};

        if (typeof filename !== 'string' || filename.includes('/') || filename.includes('\\')) {
          return res.status(400).json({ error: 'INVALID_FILENAME' });
        }

        if (filename === EMPTY_CONFIG_SENTINEL) {
          const parsed = parseSerialConfigPayload(serialConfig);
          if (!parsed.serialConfig) {
            return res.status(400).json({ error: parsed.error });
          }

          const packets = await collectSerialPackets(parsed.serialConfig.path, parsed.serialConfig, {
            maxPackets: 10,
            timeoutMs: 6000,
          });

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

        if (!applySerialPathToConfig(parsedConfig, serialPathValue)) {
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
          timeoutMs: 6000,
        });

        res.json({
          ok: true,
          portId: normalizePortId(serialConfigValue.portId || 'raw', 0),
          packets,
        });
      } catch (error) {
        logger.error({ err: error }, '[service] Failed to test serial path during setup');
        res.status(500).json({ error: 'SERIAL_TEST_FAILED' });
      }
    });

    app.post('/api/config/examples/select', async (req, res) => {
      try {
        const state = await getInitializationState();
        if (!state.requiresInitialization) {
          return res.status(400).json({ error: 'INITIALIZATION_NOT_ALLOWED' });
        }

        const { filename, serialPath, serialConfig } = req.body || {};
        if (typeof filename !== 'string' || filename.includes('/') || filename.includes('\\')) {
          return res.status(400).json({ error: 'INVALID_FILENAME' });
        }

        const targetPath = path.join(configDir, defaultConfigFilename);

        let updatedYaml = '';
        let serialPathValue = '';

        if (filename === EMPTY_CONFIG_SENTINEL) {
          const parsed = parseSerialConfigPayload(serialConfig);
          if (!parsed.serialConfig) {
            return res.status(400).json({ error: parsed.error });
          }

          serialPathValue = parsed.serialConfig.path;
          const emptyConfig = buildEmptyConfig(parsed.serialConfig);
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

          let parsedConfig: unknown;
          try {
            const rawContent = await fs.readFile(sourcePath, 'utf-8');
            parsedConfig = yaml.load(rawContent);
          } catch (error) {
            logger.error({ err: error, sourcePath }, '[service] Failed to read example config');
            return res.status(500).json({ error: 'EXAMPLE_READ_FAILED' });
          }

          if (!applySerialPathToConfig(parsedConfig, serialPathValue)) {
            return res.status(400).json({ error: 'SERIAL_CONFIG_MISSING' });
          }

          updatedYaml = dumpConfigToYaml(parsedConfig, { lineWidth: 120 });
        }

        await fs.mkdir(configDir, { recursive: true });

        if (await fileExists(targetPath)) {
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
        await fs.writeFile(configInitMarker, new Date().toISOString(), 'utf-8');
        await fs.writeFile(configRestartFlag, 'restart', 'utf-8');

        logger.info(
          { filename, targetPath, serialPath: serialPathValue },
          '[service] Default config seeded from setup wizard',
        );

        res.json({
          ok: true,
          target: defaultConfigFilename,
          restartScheduled: true,
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

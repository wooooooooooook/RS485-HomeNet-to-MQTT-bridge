import fs from 'node:fs/promises';
import path from 'node:path';
import yaml from 'js-yaml';
import { type HomenetBridgeConfig, normalizePortId } from '@rs485-homenet/core';
import type { SerialConfig } from '@rs485-homenet/core/config/types';
import { createSerialPortConnection } from '@rs485-homenet/core/transports/serial/serial.factory';

export type SetupWizardState = {
  defaultConfigName: string | null;
  hasDefaultConfig: boolean;
  hasInitMarker: boolean;
  requiresInitialization: boolean;
  configFiles: string[];
};

export type SetupWizardDeps = {
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

export type SetupWizardService = {
  getInitializationState: () => Promise<SetupWizardState>;
  listExampleConfigs: () => Promise<string[]>;
  getDefaultConfigFilename: () => Promise<string | null>;
  getNextConfigFilename: () => Promise<string>;
  checkDuplicateSerial: (
    targetPath: string,
    targetPortId?: string,
  ) => Promise<{ error: string } | null>;
  // Exposed for route handler usage
  deps: SetupWizardDeps;
  // Constants exposed for route handlers if needed, or helper methods
  applySerialPathToConfig: typeof applySerialPathToConfig;
  parseSerialConfigPayload: typeof parseSerialConfigPayload;
  buildEmptyConfig: typeof buildEmptyConfig;
  extractSerialConfig: typeof extractSerialConfig;
  collectSerialPackets: typeof collectSerialPackets;
};

export const EMPTY_CONFIG_SENTINEL = '__empty__';
export const SERIAL_DATA_BITS = [5, 6, 7, 8] as const;
export const SERIAL_PARITY = ['none', 'even', 'mark', 'odd', 'space'] as const;
export const SERIAL_STOP_BITS = [1, 1.5, 2] as const;

export const ENTITY_TYPE_KEYS = [
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

export const DEFAULT_PACKET_DEFAULTS = {
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

export const createSetupWizardService = (deps: SetupWizardDeps): SetupWizardService => {
  const {
    configDir,
    examplesDir,
    defaultConfigFilename,
    configInitMarker,
    fileExists,
    getLoadedConfigs,
  } = deps;

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

      const serial = config.serial;
      if (!serial) continue;

      if (serial.path === targetPath) {
        return { error: 'SERIAL_PATH_DUPLICATE' };
      }

      if (targetPortId) {
        const existingPortId = normalizePortId(serial.portId, 0);
        if (existingPortId === targetPortId) {
          return { error: 'PORT_ID_DUPLICATE' };
        }
      }
    }
    return null;
  };

  return {
    getInitializationState,
    listExampleConfigs,
    getDefaultConfigFilename,
    getNextConfigFilename,
    checkDuplicateSerial,
    deps,
    applySerialPathToConfig,
    parseSerialConfigPayload,
    buildEmptyConfig,
    extractSerialConfig,
    collectSerialPackets,
  };
};

import express from 'express';
import path from 'node:path';
import fs from 'node:fs/promises';
import dotenv from 'dotenv';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import { WebSocketServer } from 'ws';
import { dumpConfigToYaml } from './utils/yaml-dumper.js';
import {
  HomeNetBridge,
  HomenetBridgeConfig,
  logger,
  normalizeConfig,
  normalizePortId,
  validateConfig,
} from '@rs485-homenet/core';
import type {
  SerialConfig,
} from '@rs485-homenet/core/config/types';
import { activityLogService } from './activity-log.service.js';
import { logCollectorService } from './log-collector.service.js';
import { RawPacketLoggerService } from './raw-packet-logger.service.js';
import { LogRetentionService, type LogRetentionSettings } from './log-retention.service.js';
import { RateLimiter } from './utils/rate-limiter.js';
import { createSetupWizardService } from './setup-wizard.js';
import { createConfigEditorService } from './config-editor.js';

import type {
  BridgeInstance,
  BridgeStatus,
  ConfigStatus,
  PersistableHomenetBridgeConfig,
  BackupFileInfo,
  FrontendSettings,
  RawPacketStreamMode,
  CommandInfo,
  ConfigEntityInfo,
} from './types/index.js';
import {
  CONFIG_DIR,
  FRONTEND_SETTINGS_FILE,
  DEFAULT_CONFIG_FILENAME,
  CONFIG_INIT_MARKER,
  CONFIG_RESTART_FLAG,
  ENTITY_TYPE_KEYS,
  SUPPORTED_LOCALES,
  BASE_MQTT_PREFIX,
} from './utils/constants.js';
import {
  fileExists,
  parseEnvList,
  triggerRestart,
} from './utils/helpers.js';
import {
  initializeBackupDir,
  listBackupFiles,
  resolveBackupPath,
  saveBackup,
  cleanupBackups,
  deleteBackupFile,
} from './services/backup.service.js';
import { loadFrontendSettings } from './services/frontend-settings.service.js';
import { registerRoutes } from './routes/index.js';
import { createPacketStreamHandler } from './websocket/packet-stream.js';

dotenv.config();

// --- Path Constants ---
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Backup functions are now imported from ./services/backup.service.js

const stripLegacyKeysBeforeSave = (config: HomenetBridgeConfig): PersistableHomenetBridgeConfig => {
  const { serials: _legacySerials, ...configToSave } = config;
  return configToSave;
};

const envConfigFiles = (() => {
  const parsed = parseEnvList('CONFIG_FILES', 'CONFIG_FILE', '설정 파일');
  if (parsed.values.length > 0) {
    return parsed;
  }

  return { source: 'default', values: [DEFAULT_CONFIG_FILENAME] } as const;
})();

// --- Application State ---
const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server, path: '/api/packets/stream' });
const port = process.env.PORT ? Number(process.env.PORT) : 3000;

// Security: Rate Limiters
const globalRateLimiter = new RateLimiter(60000, 300); // 300 requests per minute (General DoS protection)
const commandRateLimiter = new RateLimiter(10000, 20); // 20 requests per 10 seconds
const configRateLimiter = new RateLimiter(60000, 20); // 20 requests per minute
const serialTestRateLimiter = new RateLimiter(60000, 20); // 20 requests per minute
const latencyTestRateLimiter = new RateLimiter(60000, 10); // 10 requests per minute

const setupWizardService = createSetupWizardService({
  configDir: CONFIG_DIR,
  examplesDir: path.resolve(__dirname, '../../core/config/examples'),
  defaultConfigFilename: DEFAULT_CONFIG_FILENAME,
  configInitMarker: CONFIG_INIT_MARKER,
  configRestartFlag: CONFIG_RESTART_FLAG,
  envConfigFilesSource: envConfigFiles.source,
  fileExists,
  dumpConfigToYaml,
  saveBackup,
  triggerRestart,
  serialTestRateLimiter,
  configRateLimiter,
  logger,
  getLoadedConfigs: () => currentConfigs,
});

const configEditorService = createConfigEditorService({
  configDir: CONFIG_DIR,
  defaultConfigFilename: DEFAULT_CONFIG_FILENAME,
  configRestartFlag: CONFIG_RESTART_FLAG,
  fileExists,
  dumpConfigToYaml,
  saveBackup,
  triggerRestart,
  configRateLimiter,
  logger,
});

// BridgeInstance type is now imported from ./types/index.js

let bridges: BridgeInstance[] = [];
let currentConfigFiles: string[] = [];
let currentConfigs: HomenetBridgeConfig[] = [];

let currentRawConfigs: HomenetBridgeConfig[] = [];
let currentConfigErrors: (string | null)[] = [];
let currentConfigStatuses: ConfigStatus[] = [];
let bridgeStatus: BridgeStatus = 'idle';
let bridgeError: string | null = null;
let bridgeStartPromise: Promise<void> | null = null;

// FrontendSettings functions are now imported from ./services/frontend-settings.service.js

// --- Express Middleware & Setup ---
app.disable('x-powered-by');
app.use((_req, res, next) => {
  // 보안 헤더 설정
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  // Referrer 정보 노출 최소화
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  // CSP: 스크립트 및 스타일 인라인 허용 (Svelte 호환), WebSocket 허용
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' ws: wss: https://raw.githubusercontent.com;",
  );
  // 민감한 브라우저 기능 비활성화
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  next();
});
// Payload 크기 제한 설정 (DoS 방지)
app.use(express.json({ limit: '1mb' }));

// Global Rate Limiter Middleware
app.use((req, res, next) => {
  if (!globalRateLimiter.check(req.ip || 'unknown')) {
    return res.status(429).json({ error: 'Too many requests' });
  }
  next();
});

setupWizardService.registerRoutes(app);
configEditorService.registerRoutes(app);

// --- Service Initializations ---
activityLogService.addLog('log.service_started');
const rawPacketLogger = new RawPacketLoggerService(CONFIG_DIR);
const logRetentionService = new LogRetentionService(CONFIG_DIR);

// Register modular routes (system, packets, gallery, logs, backups, utils)
registerRoutes(app, {
  configRateLimiter,
  latencyTestRateLimiter,
  commandRateLimiter,
  getBridges: () => bridges,
  getCurrentConfigs: () => currentConfigs,
  getCurrentConfigFiles: () => currentConfigFiles,
  getCurrentRawConfigs: () => currentRawConfigs,
  // System Routes Context
  getCurrentConfigErrors: () => currentConfigErrors,
  getCurrentConfigStatuses: () => currentConfigStatuses,
  getBridgeStatus: () => bridgeStatus,
  getBridgeError: () => bridgeError,
  isBridgeStarting: () => !!bridgeStartPromise,

  setCurrentConfigs: (index: number, config: HomenetBridgeConfig) => {
    currentConfigs[index] = config;
  },
  setCurrentRawConfigs: (index: number, config: HomenetBridgeConfig) => {
    currentRawConfigs[index] = config;
  },
  rebuildPortMappings: () => rebuildPortMappings(),
  stripLegacyKeysBeforeSave,
  // Logs routes context
  rawPacketLogger: {
    getStatus: () => rawPacketLogger.getStatus(),
    start: (meta: any, options: any) => rawPacketLogger.start(meta, options),
    stop: () => rawPacketLogger.stop(),
    getFilePath: (filename: string) => rawPacketLogger.getFilePath(filename),
  },
  logRetentionService, // Pass the service instance directly
  logCollectorService: {
    getPublicStatus: () => logCollectorService.getPublicStatus(),
    updateConsent: (consent: boolean) => logCollectorService.updateConsent(consent),
  },
  getRawPacketMode: (value: unknown) => getRawPacketMode(value),
  configDir: CONFIG_DIR,
  activityLogService: {
    getRecentLogs: () => activityLogService.getRecentLogs(),
  },
  triggerRestart: async () => triggerRestart(),
});

// WebSocket handling is now in websocket/packet-stream.ts
const packetStreamHandler = createPacketStreamHandler({
  wss,
  getBridges: () => bridges,
  getCurrentConfigs: () => currentConfigs,
});

// Export rebuildPortMappings from packetStreamHandler
const rebuildPortMappings = packetStreamHandler.rebuildPortMappings;
const latestStates = packetStreamHandler.getLatestStates();

// Helper to get raw packet mode
const getRawPacketMode = (value: unknown): RawPacketStreamMode => {
  return value === 'valid' ? 'valid' : 'all';
};

packetStreamHandler.registerGlobalEventHandlers();
packetStreamHandler.registerPacketStream();

app.get('/api/packets/stream', (_req, res) => {
  res.status(426).json({ error: '이 엔드포인트는 WebSocket 전용입니다.' });
});

// --- Static Serving & Error Handling ---
// Serve static files AFTER API routes to prevent API requests from being served as static files
app.use(
  express.static(path.resolve(__dirname, '../static'), {
    setHeaders: (res, filePath) => {
      if (filePath.endsWith('.js')) {
        res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
      } else if (filePath.endsWith('.css')) {
        res.setHeader('Content-Type', 'text/css; charset=utf-8');
      }
    },
  }),
);

// Fallback to index.html for SPA routing (must be AFTER static files and API routes)
app.get('*', (_req, res, next) => {
  res.sendFile(path.resolve(__dirname, '../static', 'index.html'), (err) => err && next());
});

app.use(
  (err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    logger.error({ err }, '[service] Request error');
    if (res.headersSent) return;
    res.status(500).json({ error: 'Internal Server Error' });
  },
);

// --- Bridge Management ---
const loadConfigFile = async (configPath: string): Promise<HomenetBridgeConfig> => {
  const fileContent = await fs.readFile(configPath, 'utf8');
  const loadedYaml = yaml.load(fileContent) as {
    homenet_bridge: HomenetBridgeConfig;
  };

  if (!loadedYaml || !loadedYaml.homenet_bridge) {
    throw new Error('Invalid configuration file format. Missing "homenet_bridge" top-level key.');
  }

  const rawConfig = loadedYaml.homenet_bridge;
  const normalized = normalizeConfig(JSON.parse(JSON.stringify(rawConfig)) as HomenetBridgeConfig);
  validateConfig(normalized, rawConfig);

  return normalized;
};

const resolveConfigPath = (filename: string) => {
  if (path.isAbsolute(filename)) return filename;
  if (filename.includes('/') || filename.includes('\\')) {
    return path.resolve(filename);
  }
  return path.join(CONFIG_DIR, filename);
};

const stopAllBridges = async (options?: { preserveStatus?: boolean }) => {
  if (bridges.length === 0) return;

  logger.info('[service] Stopping existing bridges...');
  await Promise.allSettled(bridges.map((instance) => instance.bridge.stop()));
  bridges = [];
  if (!options?.preserveStatus) {
    bridgeStatus = 'stopped';
  }
};

/**
 * Checks for duplicate portIds across loaded configuration files and auto-fixes them if found.
 * Returns true if duplicates were found and fixed, false otherwise.
 */
async function checkAndFixDuplicatePortIds(
  filenames: string[],
  resolvedPaths: string[],
): Promise<{ needsRestart: boolean; fixedFiles: string[] }> {
  const fixedFiles: string[] = [];
  const usedPortIds = new Map<string, { filename: string; index: number }>();
  const portIdUpdates: { pathIndex: number; originalPortId: string; newPortId: string }[] = [];

  // Step 1: Read each config file and collect portIds, checking for duplicates
  for (let i = 0; i < resolvedPaths.length; i++) {
    const configPath = resolvedPaths[i];
    const filename = filenames[i];

    try {
      const fileContent = await fs.readFile(configPath, 'utf8');
      const loadedYaml = yaml.load(fileContent) as { homenet_bridge?: HomenetBridgeConfig };

      if (!loadedYaml?.homenet_bridge?.serial) {
        continue;
      }

      const serial = loadedYaml.homenet_bridge.serial;
      const portId = (serial.portId || 'default').toString().trim();

      if (usedPortIds.has(portId)) {
        const existing = usedPortIds.get(portId)!;
        logger.warn(
          {
            portId,
            existingFile: existing.filename,
            duplicateFile: filename,
          },
          '[service] Duplicate portId detected. Auto-fixing...',
        );

        // Append suffix to duplicate portId
        let suffix = 2;
        let newPortId = `${portId}_${suffix}`;
        while (usedPortIds.has(newPortId)) {
          suffix += 1;
          newPortId = `${portId}_${suffix}`;
        }

        portIdUpdates.push({
          pathIndex: i,
          originalPortId: portId,
          newPortId,
        });

        usedPortIds.set(newPortId, { filename, index: i });
      } else {
        usedPortIds.set(portId, { filename, index: i });
      }
    } catch (err) {
      // Ignore file read errors (will be handled in loadAndStartBridges)
      logger.debug({ err, configPath }, '[service] Failed to read config for portId check');
    }
  }

  // Step 2: If duplicates found, modify and save the config files
  if (portIdUpdates.length === 0) {
    return { needsRestart: false, fixedFiles: [] };
  }

  for (const update of portIdUpdates) {
    const configPath = resolvedPaths[update.pathIndex];
    const filename = filenames[update.pathIndex];

    try {
      const fileContent = await fs.readFile(configPath, 'utf8');
      const loadedYaml = yaml.load(fileContent) as { homenet_bridge: HomenetBridgeConfig };

      // Create backup
      await saveBackup(configPath, loadedYaml, 'portid-fix');

      // Update portId
      loadedYaml.homenet_bridge.serial!.portId = update.newPortId;

      // Save the modified config
      const updatedYaml = dumpConfigToYaml(loadedYaml);
      await fs.writeFile(configPath, updatedYaml, 'utf-8');

      logger.info(
        {
          filename,
          originalPortId: update.originalPortId,
          newPortId: update.newPortId,
        },
        '[service] Fixed duplicate portId and saved configuration file.',
      );

      fixedFiles.push(filename);
    } catch (err) {
      logger.error({ err, configPath }, '[service] Error occurred while fixing duplicate portId.');
    }
  }

  return { needsRestart: fixedFiles.length > 0, fixedFiles };
}

async function loadAndStartBridges(filenames: string[]) {
  if (filenames.length === 0) {
    throw new Error('No configuration files provided.');
  }

  if (bridgeStartPromise) {
    await bridgeStartPromise.catch(() => { });
  }

  bridgeStartPromise = (async () => {
    await stopAllBridges();
    latestStates.clear();

    bridgeStatus = 'starting';
    bridgeError = null;

    const resolvedPaths = filenames.map(resolveConfigPath);
    logger.info(`[service] Loading configuration files: ${filenames.join(', ')}`);

    // Check for duplicate portIds when multiple config files exist
    if (filenames.length > 1) {
      const { needsRestart, fixedFiles } = await checkAndFixDuplicatePortIds(
        filenames,
        resolvedPaths,
      );

      if (needsRestart) {
        logger.warn(
          { fixedFiles },
          '[service] Duplicate portId(s) fixed. Restarting to apply changes...',
        );

        bridgeStatus = 'error';
        bridgeError = `Duplicate portId(s) auto-fixed (${fixedFiles.join(', ')}). Restarting...`;
        bridgeStartPromise = null;

        // Trigger restart
        await triggerRestart();

        // Handle immediate restart in dev environment
        setTimeout(async () => {
          if (process.env.npm_lifecycle_event === 'dev') {
            logger.info('[service] Dev mode detected. Touching file to trigger restart...');
            try {
              const now = new Date();
              await fs.utimes(__filename, now, now);
            } catch (err) {
              logger.error({ err }, '[service] Failed to touch file for dev restart');
            }
          } else {
            logger.info('[service] Exiting process to apply portId fixes...');
            process.exit(0);
          }
        }, 500);

        return;
      }
    }

    // Load configs individually, capturing errors per config
    const loadResults: { config: HomenetBridgeConfig | null; error: string | null }[] = [];
    for (const configPath of resolvedPaths) {
      try {
        const config = await loadConfigFile(configPath);
        loadResults.push({ config, error: null });
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Unknown error loading config';
        logger.error({ err, configPath }, '[service] Failed to load config file');
        loadResults.push({ config: null, error: errorMessage });
      }
    }

    // Check if at least one config loaded successfully
    const successfulConfigs = loadResults.filter((r) => r.config !== null);
    if (successfulConfigs.length === 0) {
      bridgeStatus = 'error';
      bridgeError = 'All configuration files failed to load.';
      // Still populate currentConfigFiles and errors for UI display
      currentConfigFiles = filenames;
      currentConfigs = [];
      currentRawConfigs = [];
      currentConfigErrors = loadResults.map((r) => r.error);
      currentConfigStatuses = loadResults.map(() => 'error' as const);
      bridgeStartPromise = null;
      return;
    }

    const mqttUrl = process.env.MQTT_URL?.trim() || 'mqtt://mq:1883';
    const mqttUsername = process.env.MQTT_USER?.trim() || undefined;
    const mqttPassword = process.env.MQTT_PASSWD?.trim() || undefined;

    const newBridges: BridgeInstance[] = [];
    const newConfigErrors: (string | null)[] = [];
    const newConfigStatuses: ('idle' | 'starting' | 'started' | 'error' | 'stopped')[] = [];
    const loadedConfigs: HomenetBridgeConfig[] = [];
    const loadedConfigFilesForCollector: { name: string; content: string; portIds?: string[] }[] =
      [];

    // 1. Instantiate bridges only for successfully loaded configs
    for (let i = 0; i < filenames.length; i += 1) {
      const result = loadResults[i];
      if (result.config) {
        const bridge = new HomeNetBridge({
          configPath: resolvedPaths[i],
          mqttUrl,
          mqttUsername,
          mqttPassword,
          mqttTopicPrefix: BASE_MQTT_PREFIX,
          configOverride: result.config,
        });

        newBridges.push({
          bridge,
          configFile: filenames[i],
          resolvedPath: resolvedPaths[i],
          config: result.config,
        });

        loadedConfigs.push(result.config);
        newConfigErrors.push(null);
        newConfigStatuses.push('starting');

        // Read file content for log collector
        try {
          const content = await fs.readFile(resolvedPaths[i], 'utf-8');
          const portIds =
            result.config.serials?.map((s, idx) => normalizePortId(s.portId, idx)) || [];
          loadedConfigFilesForCollector.push({ name: filenames[i], content, portIds });
        } catch {
          // Ignore read error for log collector
        }
      } else {
        // Config failed to load - add placeholder entries
        loadedConfigs.push({} as HomenetBridgeConfig); // Empty placeholder
        newConfigErrors.push(result.error);
        newConfigStatuses.push('error');
      }
    }

    currentConfigFiles = filenames;
    currentRawConfigs = loadedConfigs;
    currentConfigs = loadedConfigs;
    currentConfigErrors = newConfigErrors;
    currentConfigStatuses = newConfigStatuses;
    bridges = newBridges;
    rebuildPortMappings();

    // 2. Init LogCollector with successfully loaded bridges
    await logCollectorService.init(
      bridges.map((b) => b.bridge),
      loadedConfigFilesForCollector,
    );

    // 3. Mark service as started effectively immediately, so API is available
    bridgeStatus = 'started';
    bridgeStartPromise = null; // Allow API access immediately

    const successCount = newBridges.length;
    const failCount = loadResults.filter((r) => r.config === null).length;
    logger.info(
      `[service] Bridge service initialized with ${successCount} config(s) (${failCount} failed). Starting connections in background...`,
    );

    // 4. Start all bridges in background (non-blocking for API)
    // We do not await this Promise.all, so the function returns and releases the lock.
    Promise.all(
      newBridges.map(async (instance) => {
        // Find the original index in filenames array
        const originalIndex = filenames.indexOf(instance.configFile);
        try {
          await instance.bridge.start();
          if (originalIndex !== -1) {
            currentConfigStatuses[originalIndex] = 'started';
          }
        } catch (err) {
          logger.error(
            { err, configFile: instance.configFile },
            '[service] Failed to start bridge instance',
          );
          if (originalIndex !== -1) {
            currentConfigStatuses[originalIndex] = 'error';
            currentConfigErrors[originalIndex] =
              err instanceof Error ? err.message : 'Unknown error during bridge start';
          }
          // Remove failed bridge from the bridges array to prevent
          // "Bridge not initialized" errors when executing commands on other bridges
          const failedIndex = bridges.indexOf(instance);
          if (failedIndex !== -1) {
            bridges.splice(failedIndex, 1);
            logger.info(
              { configFile: instance.configFile },
              '[service] Removed failed bridge instance from active bridges',
            );
          }
        }
      }),
    ).catch((err) => {
      // Should not happen as individual promises catch errors, but just in case
      logger.error({ err }, '[service] Unexpected error in background startup');
    });
  })();

  // We return a resolved promise immediately so the caller doesn't wait
  // The actual initialization (loading config) is awaited above,
  // but the connection phase (bridge.start) happens in background after bridgeStartPromise is cleared.
  // Wait, the wrapper IIFE is async, so `bridgeStartPromise` is the Promise of that IIFE.
  // We need to make sure `bridgeStartPromise` variable itself is cleared/resolved when we want API to follow.
  // The current logic assigns the IIFE promise to `bridgeStartPromise`.
  // To make it non-blocking for API check `if (bridgeStartPromise)`, we set `bridgeStartPromise = null` inside the IIFE.
  // This is already done in step 3.
  return Promise.resolve();
}

// --- Server Initialization ---
server.listen(port, async () => {
  logger.info(`Service listening on port ${port}`);
  try {
    // Initialize backup directory
    await initializeBackupDir();

    // Initialize log cache service with saved settings
    const frontendSettings = await loadFrontendSettings();
    await logRetentionService.init(frontendSettings.logRetention);

    // Connect activity log service to respect caching enabled state
    activityLogService.setEnabledCallback(() => logRetentionService.isEnabled());
    if (!logRetentionService.isEnabled()) {
      activityLogService.clearLogs();
    }

    logger.info('[service] Initializing bridge on startup...');
    const initState = await setupWizardService.getInitializationState();

    if (initState.requiresInitialization) {
      bridgeStatus = 'error';
      bridgeError = 'CONFIG_INITIALIZATION_REQUIRED';
      currentConfigFiles = [];
      logger.warn(
        '[service] No default configuration found and .initialized is missing. Exposing example list for selection.',
      );
      return;
    }

    const configFilesFromEnv = envConfigFiles.values;
    const discoveredConfigFiles = (await fs.readdir(CONFIG_DIR)).filter(
      (file: string) =>
        file === DEFAULT_CONFIG_FILENAME || /^default_\d+\.homenet_bridge\.ya?ml$/.test(file),
    );

    const shouldPersistInitMarker =
      !initState.hasInitMarker && Boolean(initState.defaultConfigName);

    const availableConfigFiles = (() => {
      if (!initState.hasInitMarker && initState.defaultConfigName) {
        const sourceConfigs =
          envConfigFiles.source !== 'default' ? configFilesFromEnv : discoveredConfigFiles;
        const remaining = sourceConfigs.filter((file) => file !== initState.defaultConfigName);
        return [initState.defaultConfigName, ...remaining];
      }

      return envConfigFiles.source !== 'default' ? configFilesFromEnv : discoveredConfigFiles;
    })();

    const uniqueConfigFiles = [...new Set(availableConfigFiles)];

    if (uniqueConfigFiles.length === 0) {
      // 설정 파일이 없으면 초기 설정 마법사 표시
      bridgeStatus = 'error';
      bridgeError = 'CONFIG_INITIALIZATION_REQUIRED';
      currentConfigFiles = [];
      logger.warn('[service] No configuration files found. Showing setup wizard.');
      return;
    }

    logger.info(
      {
        configFiles: uniqueConfigFiles.map((file) => path.basename(file)),
        configRoot: CONFIG_DIR,
      },
      '[service] Starting bridge with configuration files',
    );

    await loadAndStartBridges(uniqueConfigFiles);

    // 브리지 시작 성공 후 .restart-required 파일 삭제
    if (await fileExists(CONFIG_RESTART_FLAG)) {
      await fs.unlink(CONFIG_RESTART_FLAG).catch(() => { });
      logger.info('[service] Cleared .restart-required flag');
    }

    if (shouldPersistInitMarker && !(await fileExists(CONFIG_INIT_MARKER))) {
      await fs.writeFile(CONFIG_INIT_MARKER, new Date().toISOString(), 'utf-8');
    }
  } catch (err) {
    logger.error({ err }, '[service] Initial bridge start failed');
    bridgeStatus = 'error';
    bridgeError = err instanceof Error ? err.message : 'Initial start failed.';
  }
});

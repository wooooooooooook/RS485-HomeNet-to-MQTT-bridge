import express from 'express';
import path from 'node:path';
import fs from 'node:fs/promises';
import dotenv from 'dotenv';
import { createServer, type IncomingMessage } from 'node:http';
import { fileURLToPath } from 'node:url';
import yaml, { Type } from 'js-yaml';
import { WebSocket, WebSocketServer } from 'ws';
import { dumpConfigToYaml } from './utils/yaml-dumper.js';
import {
  createBridge,
  HomeNetBridge,
  HomenetBridgeConfig,
  logger,
  eventBus,
  normalizeConfig,
  normalizePortId,
  validateConfig,
  StateChangedEvent,
  MqttMessageEvent,
} from '@rs485-homenet/core';
import type { SerialConfig } from '@rs485-homenet/core/config/types';
import { createSerialPortConnection } from '@rs485-homenet/core/transports/serial/serial.factory';
import { activityLogService } from './activity-log.service.js';
import { logCollectorService } from './log-collector.service.js';
import { RateLimiter } from './utils/rate-limiter.js';

dotenv.config();

// --- Constants ---
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// CONFIG_ROOT 환경 변수 처리: 상대 경로는 process.cwd() 기준으로 해석
const resolveConfigRoot = (): string => {
  const configRoot = process.env.CONFIG_ROOT;
  if (!configRoot) {
    return path.resolve(__dirname, '../../core/config');
  }
  // 절대 경로인 경우 그대로 사용, 상대 경로인 경우 cwd 기준으로 resolve
  return path.isAbsolute(configRoot) ? configRoot : path.resolve(process.cwd(), configRoot);
};

const CONFIG_DIR = resolveConfigRoot();
const FRONTEND_SETTINGS_FILE = path.join(CONFIG_DIR, 'frontend-setting.json');
const DEFAULT_CONFIG_FILENAME = 'default.homenet_bridge.yaml';
const LEGACY_DEFAULT_CONFIG_FILENAME = 'default.yaml';
const CONFIG_INIT_MARKER = path.join(CONFIG_DIR, '.initialized');
const CONFIG_RESTART_FLAG = path.join(CONFIG_DIR, '.restart-required');
const EXAMPLES_DIR = path.resolve(__dirname, '../../core/config/examples');
type PersistableHomenetBridgeConfig = Omit<HomenetBridgeConfig, 'serials'> & {
  serials?: HomenetBridgeConfig['serials'];
};

const fileExists = async (targetPath: string): Promise<boolean> => {
  try {
    await fs.access(targetPath);
    return true;
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code === 'ENOENT') return false;
    throw error;
  }
};

const stripLegacyKeysBeforeSave = (config: HomenetBridgeConfig): PersistableHomenetBridgeConfig => {
  const { serials: _legacySerials, ...configToSave } = config;
  return configToSave;
};

const parseEnvList = (
  primaryKey: string,
  legacyKey: string,
  label: string,
): { source: string | null; values: string[] } => {
  const raw = process.env[primaryKey] ?? process.env[legacyKey];
  const source = process.env[primaryKey] ? primaryKey : process.env[legacyKey] ? legacyKey : null;

  if (!raw) return { source, values: [] };

  const values = raw
    .split(',')
    .map((value) => value.trim())
    .filter((value) => value.length > 0);

  if (values.length === 0) {
    throw new Error(`[service] ${source}에 최소 1개 이상의 ${label}을 지정하세요.`);
  }

  if (!raw.includes(',')) {
    logger.warn(
      `[service] ${source}에 단일 값이 입력되었습니다. 쉼표로 구분된 배열 형식(${source}=item1,item2)` +
        ' 사용을 권장합니다.',
    );
  }

  if (source === legacyKey && primaryKey !== legacyKey) {
    logger.warn(`[service] ${legacyKey} 대신 ${primaryKey} 환경 변수를 사용하도록 전환해주세요.`);
  }

  return { source, values };
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
      packets.push(data.toString('hex'));
      if (packets.length >= maxPackets) {
        resolveWithTimeout(packets);
      }
    };

    const onError = (err: Error) => {
      rejectWithTimeout(err);
    };

    port.on('data', onData);
    port.once('error', onError);
  });
};

const envConfigFiles = (() => {
  const parsed = parseEnvList('CONFIG_FILES', 'CONFIG_FILE', '설정 파일');
  if (parsed.values.length > 0) {
    return parsed;
  }

  return { source: 'default', values: [DEFAULT_CONFIG_FILENAME] } as const;
})();

const listExampleConfigs = async (): Promise<string[]> => {
  try {
    const files = await fs.readdir(EXAMPLES_DIR);
    return files.filter((file) => file.endsWith('.yaml'));
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code === 'ENOENT') return [];
    throw error;
  }
};

const getDefaultConfigFilename = async (): Promise<string | null> => {
  const defaultPath = path.join(CONFIG_DIR, DEFAULT_CONFIG_FILENAME);
  const legacyDefaultPath = path.join(CONFIG_DIR, LEGACY_DEFAULT_CONFIG_FILENAME);

  if (await fileExists(defaultPath)) return DEFAULT_CONFIG_FILENAME;
  if (await fileExists(legacyDefaultPath)) return LEGACY_DEFAULT_CONFIG_FILENAME;
  return null;
};

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

const extractSerialConfig = (config: HomenetBridgeConfig): SerialConfig | null => {
  if (Array.isArray(config.serials) && config.serials.length > 0) {
    return config.serials[0];
  }

  const legacySerial = (config as { serial?: SerialConfig }).serial;
  return legacySerial ?? null;
};

const triggerRestart = async () => {
  // .restart-required 파일만 생성하고 종료하지 않음
  // HA 애드온에서는 run.sh가 이 파일을 감지하여 재시작 처리
  // 개발 환경에서는 수동으로 컨테이너 재시작 필요
  await fs.writeFile(CONFIG_RESTART_FLAG, new Date().toISOString(), 'utf-8');
  logger.info('[service] Restart required. Please restart the addon/container to apply changes.');
};

const normalizeTopicParts = (topic: string) => topic.split('/').filter(Boolean);

// --- Application State ---
const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server, path: '/api/packets/stream' });
const port = process.env.PORT ? Number(process.env.PORT) : 3000;

// --- Packet History Cache ---
const commandPacketHistory: unknown[] = [];
const parsedPacketHistory: unknown[] = [];
const MAX_PACKET_HISTORY = 1000;

// Security: Rate Limiters
const commandRateLimiter = new RateLimiter(10000, 20); // 20 requests per 10 seconds
const configRateLimiter = new RateLimiter(60000, 5); // 5 requests per minute
const serialTestRateLimiter = new RateLimiter(30000, 4); // 4 requests per 30 seconds
const latencyTestRateLimiter = new RateLimiter(60000, 3); // 3 requests per minute

eventBus.on('command-packet', (packet: unknown) => {
  commandPacketHistory.push(packet);
  if (commandPacketHistory.length > MAX_PACKET_HISTORY) {
    commandPacketHistory.shift();
  }
});

eventBus.on('parsed-packet', (packet: unknown) => {
  parsedPacketHistory.push(packet);
  if (parsedPacketHistory.length > MAX_PACKET_HISTORY) {
    parsedPacketHistory.shift();
  }
});

type BridgeInstance = {
  bridge: HomeNetBridge;
  configFile: string;
  resolvedPath: string;
  config: HomenetBridgeConfig;
};

let bridges: BridgeInstance[] = [];
let currentConfigFiles: string[] = [];
let currentConfigs: HomenetBridgeConfig[] = [];

let currentRawConfigs: HomenetBridgeConfig[] = [];
let currentConfigErrors: (string | null)[] = [];
let currentConfigStatuses: ('idle' | 'starting' | 'started' | 'error' | 'stopped')[] = [];
let bridgeStatus: 'idle' | 'starting' | 'started' | 'stopped' | 'error' = 'idle';
let bridgeError: string | null = null;
let bridgeStartPromise: Promise<void> | null = null;

type FrontendSettings = {
  toast: {
    stateChange: boolean;
    command: boolean;
  };
  locale?: string;
};

const DEFAULT_FRONTEND_SETTINGS: FrontendSettings = {
  toast: {
    stateChange: false,
    command: true,
  },
};

const ENTITY_TYPE_KEYS: (keyof HomenetBridgeConfig)[] = [
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
];

const BASE_MQTT_PREFIX = (process.env.MQTT_TOPIC_PREFIX || 'homenet2mqtt').toString().trim();
const BASE_PREFIX_PARTS = normalizeTopicParts(BASE_MQTT_PREFIX);

const normalizeFrontendSettings = (value: Partial<FrontendSettings> | null | undefined) => {
  return {
    toast: {
      stateChange:
        typeof value?.toast?.stateChange === 'boolean'
          ? value.toast.stateChange
          : DEFAULT_FRONTEND_SETTINGS.toast.stateChange,
      command:
        typeof value?.toast?.command === 'boolean'
          ? value.toast.command
          : DEFAULT_FRONTEND_SETTINGS.toast.command,
    },
    locale: typeof value?.locale === 'string' ? value.locale : undefined,
  };
};

const saveFrontendSettings = async (settings: FrontendSettings) => {
  await fs.mkdir(CONFIG_DIR, { recursive: true });
  await fs.writeFile(FRONTEND_SETTINGS_FILE, JSON.stringify(settings, null, 2), 'utf-8');
};

const loadFrontendSettings = async (): Promise<FrontendSettings> => {
  try {
    const data = await fs.readFile(FRONTEND_SETTINGS_FILE, 'utf-8');
    const parsed = JSON.parse(data);
    return normalizeFrontendSettings(parsed);
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code === 'ENOENT') {
      await saveFrontendSettings(DEFAULT_FRONTEND_SETTINGS);
      return DEFAULT_FRONTEND_SETTINGS;
    }
    throw error;
  }
};

// --- Express Middleware & Setup ---
app.disable('x-powered-by');
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  next();
});
app.use(express.json());

// --- API Endpoints ---
app.get('/api/packets/command/history', (_req, res) => {
  res.json(commandPacketHistory);
});

app.get('/api/packets/parsed/history', (_req, res) => {
  res.json(parsedPacketHistory);
});

app.get('/api/activity/recent', (_req, res) => {
  res.json(activityLogService.getRecentLogs());
});

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok' });
});

app.post('/api/bridge/:portId/latency-test', async (req, res) => {
  if (!latencyTestRateLimiter.check(req.ip || 'unknown')) {
    logger.warn({ ip: req.ip }, '[service] Latency test rate limit exceeded');
    return res.status(429).json({ error: 'Too many requests' });
  }

  const { portId } = req.params;

  if (bridges.length === 0) {
    return res.status(503).json({ error: 'BRIDGE_NOT_STARTED' });
  }

  // Find the bridge instance managing this port
  let targetBridgeInstance: BridgeInstance | undefined;

  // Try to find by direct match or normalize
  for (const instance of bridges) {
    // Check all serials in this instance
    const serials = instance.config.serials || [];
    for (let i = 0; i < serials.length; i++) {
      const pId = normalizePortId(serials[i].portId, i);
      if (pId === portId) {
        targetBridgeInstance = instance;
        break;
      }
    }
    if (targetBridgeInstance) break;
  }

  if (!targetBridgeInstance) {
    return res.status(404).json({ error: 'BRIDGE_NOT_FOUND_FOR_PORT', portId });
  }

  try {
    logger.info({ portId }, '[service] Starting latency test');
    const startTime = Date.now();
    const stats = await targetBridgeInstance.bridge.runLatencyTest(portId);

    const elapsed = Date.now() - startTime;
    if (elapsed < 5000) {
      await new Promise((resolve) => setTimeout(resolve, 5000 - elapsed));
    }

    res.json(stats);
  } catch (error) {
    logger.error({ err: error, portId }, '[service] Latency test failed');
    res.status(500).json({ error: error instanceof Error ? error.message : 'Latency test failed' });
  }
});

app.get('/api/bridge/info', async (_req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');

  // If a startup is in progress, tell the client to wait.
  if (bridgeStartPromise) {
    return res.status(503).json({ error: 'BRIDGE_STARTING' });
  }

  // Return info even when no configs loaded successfully (to show errors)
  if (currentConfigFiles.length === 0) {
    return res.json({
      configFiles: [],
      bridges: [],
      mqttUrl: process.env.MQTT_URL?.trim() || 'mqtt://mq:1883',
      status: 'error',
      error: bridgeError || 'BRIDGE_NOT_CONFIGURED',
      topic: `${BASE_MQTT_PREFIX}/homedevice1/raw`,
    });
  }

  const bridgesInfo = currentConfigFiles.map((configFile, configIndex) => {
    const config = currentConfigs[configIndex];
    const configError = currentConfigErrors[configIndex];
    const configStatus = currentConfigStatuses[configIndex] || 'idle';

    // Handle case where config failed to load (empty object or null)
    if (configError || !config || !config.serials) {
      return {
        configFile,
        serials: [],
        mqttTopicPrefix: BASE_MQTT_PREFIX,
        topic: `${BASE_MQTT_PREFIX}/homedevice1/raw`,
        error: configError || 'Config not loaded',
        status: configStatus,
      };
    }

    const serialTopics =
      config.serials?.map((serial: HomenetBridgeConfig['serials'][number], index: number) => {
        const portId = normalizePortId(serial.portId, index);
        return {
          portId,
          path: serial.path,
          baudRate: serial.baud_rate,
          topic: `${BASE_MQTT_PREFIX}/${portId}`,
        };
      }) ?? [];

    return {
      configFile,
      serials: serialTopics,
      mqttTopicPrefix: BASE_MQTT_PREFIX,
      topic: `${serialTopics[0]?.topic || `${BASE_MQTT_PREFIX}/homedevice1`}/raw`,
      error: configError || undefined,
      status: configStatus,
    };
  });

  const firstTopic = bridgesInfo[0]?.topic ?? `${BASE_MQTT_PREFIX}/homedevice1/raw`;

  // .restart-required 파일 존재 여부 확인
  const restartRequired = await fileExists(CONFIG_RESTART_FLAG);

  res.json({
    configFiles: currentConfigFiles,
    bridges: bridgesInfo,
    mqttUrl: process.env.MQTT_URL?.trim() || 'mqtt://mq:1883',
    status: bridgeStatus,
    error: bridgeError,
    topic: firstTopic,
    restartRequired,
  });
});

app.get('/api/frontend-settings', async (_req, res) => {
  try {
    const settings = await loadFrontendSettings();
    res.json({ settings });
  } catch (error) {
    logger.error({ err: error }, '[service] Failed to load frontend settings');
    res.status(500).json({ error: '프론트 설정을 불러오지 못했습니다.' });
  }
});

app.put('/api/frontend-settings', async (req, res) => {
  try {
    const payload = normalizeFrontendSettings(req.body?.settings ?? req.body);
    await saveFrontendSettings(payload);
    res.json({ settings: payload });
  } catch (error) {
    logger.error({ err: error }, '[service] Failed to save frontend settings');
    res.status(500).json({ error: '프론트 설정을 저장하지 못했습니다.' });
  }
});

app.get('/api/log-sharing/status', async (_req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  const status = await logCollectorService.getPublicStatus();
  res.json(status);
});

app.post('/api/log-sharing/consent', async (req, res) => {
  const { consent } = req.body;
  if (typeof consent !== 'boolean') {
    return res.status(400).json({ error: 'consent must be boolean' });
  }
  await logCollectorService.updateConsent(consent);

  // 로그 동의 완료 시 .initialized 마커 생성 (초기화 프로세스 완료)
  if (!(await fileExists(CONFIG_INIT_MARKER))) {
    await fs.writeFile(CONFIG_INIT_MARKER, new Date().toISOString(), 'utf-8');
    logger.info('[service] Initialization complete, .initialized marker created');
  }

  const status = await logCollectorService.getPublicStatus();
  res.json(status);
});

type StreamEvent =
  | 'status'
  | 'mqtt-message'
  | 'raw-data'
  | 'raw-data-with-interval'
  | 'packet-interval-stats'
  | 'command-packet'
  | 'parsed-packet'
  | 'state-change'
  | 'activity-log-added';

type StreamMessage<T = unknown> = {
  event: StreamEvent;
  data: T;
};

type RawPacketPayload = {
  payload?: string;
  interval?: number | null;
  receivedAt?: string;
  portId?: string;
  topic?: string;
};

type RawPacketEvent = {
  topic: string;
  payload: string;
  receivedAt: string;
  interval: number | null;
  portId?: string;
};

type StateChangeEvent = {
  entityId: string;
  topic: string;
  payload: string;
  state: Record<string, unknown>;
  timestamp: string;
  portId?: string;
};

// 최근 상태를 UI에 재전송하기 위한 캐시
const latestStates = new Map<string, StateChangeEvent>();
let topicPrefixToPortId = new Map<string, string>();

const rebuildPortMappings = () => {
  const nextMap = new Map<string, string>();

  currentConfigs.forEach((config) => {
    config.serials?.forEach((serial: SerialConfig, index: number) => {
      const portId = normalizePortId(serial.portId, index);
      nextMap.set(portId, portId);
    });
  });

  topicPrefixToPortId = nextMap;
};

const extractEntityIdFromTopic = (topic: string) => {
  const parts = normalizeTopicParts(topic);
  if (parts.length >= 3) {
    return parts[parts.length - 2];
  }
  return parts.at(-1) ?? topic;
};

const extractPortIdFromTopic = (topic: string) => {
  const parts = normalizeTopicParts(topic);

  const hasBasePrefix =
    BASE_PREFIX_PARTS.length > 0 &&
    BASE_PREFIX_PARTS.every((segment, index) => parts[index] === segment);

  if (hasBasePrefix && parts.length > BASE_PREFIX_PARTS.length) {
    const inferred = parts[BASE_PREFIX_PARTS.length];
    return topicPrefixToPortId.get(inferred) ?? inferred;
  }

  if (parts.length >= 2) {
    const inferred = parts[1];
    return topicPrefixToPortId.get(inferred) ?? inferred;
  }
  return undefined;
};

const isStateTopic = (topic: string) => {
  const parts = normalizeTopicParts(topic);
  return parts.length >= 3 && parts[parts.length - 1] === 'state';
};

const normalizeRawPacket = (data: RawPacketPayload): RawPacketEvent => {
  const portId = data.portId ?? 'raw';
  const topic = data.topic ?? `${BASE_MQTT_PREFIX}/${portId}/raw`;

  return {
    topic,
    payload: typeof data.payload === 'string' ? data.payload : '',
    receivedAt: data.receivedAt ?? new Date().toISOString(),
    interval: typeof data.interval === 'number' ? data.interval : null,
    portId,
  };
};

const stopAllRawPacketListeners = () => {
  bridges.forEach((instance) => instance.bridge.stopRawPacketListener());
};

const startAllRawPacketListeners = () => {
  bridges.forEach((instance) => instance.bridge.startRawPacketListener());
};

const sendStreamEvent = <T>(socket: WebSocket, event: StreamEvent, payload: T) => {
  if (socket.readyState !== WebSocket.OPEN) return;
  const message: StreamMessage<T> = { event, data: payload };
  socket.send(JSON.stringify(message));
};

const getRequestUrl = (req?: IncomingMessage) => {
  if (!req?.url) return null;
  const host = req.headers?.host || 'localhost';
  return new URL(req.url, `http://${host}`);
};

const broadcastStreamEvent = <T>(event: StreamEvent, payload: T) => {
  wss.clients.forEach((client) => {
    sendStreamEvent(client, event, payload);
  });
};

const rawPacketSubscribers = new Set<WebSocket>();

const sendToRawSubscribers = <T>(event: StreamEvent, payload: T) => {
  rawPacketSubscribers.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      sendStreamEvent(client, event, payload);
    }
  });
};

const registerGlobalEventHandlers = () => {
  const broadcastStateChange = (stateChangeEvent: StateChangeEvent) => {
    latestStates.set(stateChangeEvent.topic, stateChangeEvent);
    broadcastStreamEvent('state-change', stateChangeEvent);
  };
  eventBus.on('state:changed', (event: StateChangedEvent) => broadcastStateChange(event));
  eventBus.on('mqtt-message', (data: MqttMessageEvent) => {
    const receivedAt = new Date().toISOString();
    const portId = data.portId ?? extractPortIdFromTopic(data.topic);
    broadcastStreamEvent('mqtt-message', {
      topic: data.topic,
      payload: data.payload,
      receivedAt,
      portId,
    });
    if (isStateTopic(data.topic)) {
      let parsedState: Record<string, unknown> = {};
      try {
        parsedState = JSON.parse(data.payload) as Record<string, unknown>;
      } catch {
        parsedState = {};
      }
      const stateChangeEvent: StateChangeEvent = {
        entityId: extractEntityIdFromTopic(data.topic),
        topic: data.topic,
        payload: data.payload,
        state: parsedState,
        timestamp: receivedAt,
        portId,
      };
      broadcastStateChange(stateChangeEvent);
    }
  });
  eventBus.on('command-packet', (data: unknown) => {
    broadcastStreamEvent('command-packet', data);
  });
  eventBus.on('parsed-packet', (data: unknown) => {
    broadcastStreamEvent('parsed-packet', data);
  });
  eventBus.on('raw-data-with-interval', (data: RawPacketPayload) => {
    sendToRawSubscribers('raw-data-with-interval', normalizeRawPacket(data));
  });
  eventBus.on('packet-interval-stats', (data: unknown) => {
    sendToRawSubscribers('packet-interval-stats', data);
  });
  eventBus.on('activity-log:added', (data: unknown) => {
    broadcastStreamEvent('activity-log-added', data);
  });
};

activityLogService.addLog('log.service_started');

const registerPacketStream = () => {
  wss.on('connection', (socket: WebSocket, req: IncomingMessage) => {
    const requestUrl = getRequestUrl(req);
    const streamMqttUrl = resolveMqttUrl(
      requestUrl?.searchParams.get('mqttUrl') ?? '',
      process.env.MQTT_URL?.trim() || 'mqtt://mq:1883',
    );
    sendStreamEvent(socket, 'status', {
      state: 'connected',
      mqttUrl: streamMqttUrl,
    });
    latestStates.forEach((state) => sendStreamEvent(socket, 'state-change', state));
    socket.on('message', (message: string) => {
      try {
        const parsed = JSON.parse(message);
        if (parsed.command === 'start') {
          if (!rawPacketSubscribers.has(socket)) {
            const wasEmpty = rawPacketSubscribers.size === 0;
            rawPacketSubscribers.add(socket);
            if (wasEmpty) {
              logger.info('[service] UI requested to start streaming raw packets.');
              startAllRawPacketListeners();
            }
          }
        } else if (parsed.command === 'stop') {
          if (rawPacketSubscribers.has(socket)) {
            rawPacketSubscribers.delete(socket);
            if (rawPacketSubscribers.size === 0) {
              logger.info('[service] UI requested to stop streaming raw packets.');
              stopAllRawPacketListeners();
            }
          }
        }
      } catch (error) {
        logger.warn(
          {
            err: error,
          },
          '[service] Invalid WebSocket message received',
        );
      }
    });
    const heartbeat = setInterval(() => {
      if (socket.readyState === WebSocket.OPEN) {
        socket.ping();
      }
    }, 15000);
    socket.on('close', () => {
      clearInterval(heartbeat);
      if (rawPacketSubscribers.has(socket)) {
        rawPacketSubscribers.delete(socket);
        if (rawPacketSubscribers.size === 0) {
          stopAllRawPacketListeners();
        }
      }
    });
    socket.on('error', () => {
      clearInterval(heartbeat);
      if (rawPacketSubscribers.has(socket)) {
        rawPacketSubscribers.delete(socket);
        if (rawPacketSubscribers.size === 0) {
          stopAllRawPacketListeners();
        }
      }
    });
  });
};
registerGlobalEventHandlers();
registerPacketStream();

app.get('/api/packets/stream', (_req, res) => {
  res.status(426).json({ error: '이 엔드포인트는 WebSocket 전용입니다.' });
});

// --- Command API Endpoints ---
interface CommandInfo {
  entityId: string;
  entityName: string;
  entityType: string;
  commandName: string;
  displayName: string;
  inputType?: 'number' | 'text';
  min?: number;
  max?: number;
  step?: number;
  options?: string[];
}

function extractCommands(config: HomenetBridgeConfig): CommandInfo[] {
  const commands: CommandInfo[] = [];

  // All entity types (same as discovery-manager)
  const entityTypeKeys: (keyof HomenetBridgeConfig & string)[] = [
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
  ];

  for (const entityType of entityTypeKeys) {
    const entities = config[entityType] as Array<Record<string, unknown>> | undefined;
    if (!entities) continue;

    for (const entity of entities) {
      const entityId = entity.id as string;
      const entityName = (entity.name as string) || entityId;

      // Dynamically find all command_* properties in the entity
      for (const key of Object.keys(entity)) {
        if (!key.startsWith('command_')) continue;

        const commandData = entity[key];
        if (!commandData) continue;

        const commandSuffix = key.replace('command_', '');
        const displayCommandName = commandSuffix.charAt(0).toUpperCase() + commandSuffix.slice(1);

        const cmdInfo: CommandInfo = {
          entityId,
          entityName,
          entityType,
          commandName: key,
          displayName: `${entityName} ${displayCommandName}`,
        };

        // Detect input types based on command name and entity type
        if (
          key === 'command_temperature' ||
          key === 'command_speed' ||
          key === 'command_brightness' ||
          key === 'command_percentage' ||
          key === 'command_position'
        ) {
          cmdInfo.inputType = 'number';

          // Get visual config for temperature bounds (climate)
          const visual = entity.visual as
            | { min_temperature?: string; max_temperature?: string; temperature_step?: string }
            | undefined;
          if (visual && key === 'command_temperature') {
            const parseTemp = (val?: string) =>
              val ? parseInt(val.replace(/[^\d]/g, '')) : undefined;
            cmdInfo.min = parseTemp(visual.min_temperature) ?? 5;
            cmdInfo.max = parseTemp(visual.max_temperature) ?? 40;
            cmdInfo.step = parseTemp(visual.temperature_step) ?? 1;
          } else if (key === 'command_brightness') {
            cmdInfo.min = 0;
            cmdInfo.max = 255;
            cmdInfo.step = 1;
          } else if (
            key === 'command_percentage' ||
            key === 'command_speed' ||
            key === 'command_position'
          ) {
            cmdInfo.min = 0;
            cmdInfo.max = 100;
            cmdInfo.step = 1;
          }
        }

        // Number entity
        if (entityType === 'number' && key === 'command_number') {
          cmdInfo.inputType = 'number';
          cmdInfo.min = (entity.min_value as number) ?? 0;
          cmdInfo.max = (entity.max_value as number) ?? 100;
          cmdInfo.step = (entity.step as number) ?? 1;
        }

        // Select entity
        if (entityType === 'select' && key === 'command_option') {
          cmdInfo.inputType = 'text';
          cmdInfo.options = (entity.options as string[]) ?? [];
        }

        // Text entity
        if (entityType === 'text' && key === 'command_text') {
          cmdInfo.inputType = 'text';
        }

        commands.push(cmdInfo);
      }
    }
  }

  return commands;
}

/**
 * Find which config file (by index) contains the given portId.
 * Returns -1 if not found.
 */
const findConfigIndexByPortId = (portId: string): number => {
  for (let i = 0; i < currentConfigs.length; i += 1) {
    const config = currentConfigs[i];
    const serials = Array.isArray(config.serial)
      ? config.serial
      : config.serial
        ? [config.serial]
        : [];
    for (let j = 0; j < serials.length; j += 1) {
      const serial = serials[j] as { portId?: string };
      const configPortId = normalizePortId(serial.portId, j);
      if (configPortId === portId) {
        return i;
      }
    }
  }
  return -1;
};

/**
 * Find which config file (by index) contains the given entity.
 * Returns -1 if not found.
 */
const findConfigIndexForEntity = (entityId: string): number => {
  for (let i = 0; i < currentConfigs.length; i += 1) {
    const config = currentConfigs[i];
    for (const type of ENTITY_TYPE_KEYS) {
      const entities = config[type] as Array<any> | undefined;
      if (Array.isArray(entities) && entities.some((entity) => entity.id === entityId)) {
        return i;
      }
    }
  }
  return -1;
};

const findBridgeForEntity = (entityId: string): BridgeInstance | undefined => {
  for (let i = 0; i < currentConfigs.length; i += 1) {
    const config = currentConfigs[i];
    for (const type of ENTITY_TYPE_KEYS) {
      const entities = config[type] as Array<any> | undefined;
      if (Array.isArray(entities) && entities.some((entity) => entity.id === entityId)) {
        return bridges.find((instance) => instance.configFile === currentConfigFiles[i]);
      }
    }
  }

  return undefined;
};

const getInitializationState = async () => {
  const [defaultConfigName, hasInitMarker] = await Promise.all([
    getDefaultConfigFilename(),
    fileExists(CONFIG_INIT_MARKER),
  ]);

  return {
    defaultConfigName,
    hasDefaultConfig: Boolean(defaultConfigName),
    hasInitMarker,
    requiresInitialization: !hasInitMarker,
  };
};

app.get('/api/config/examples', async (_req, res) => {
  try {
    const [state, examples] = await Promise.all([getInitializationState(), listExampleConfigs()]);

    res.json({
      configRoot: CONFIG_DIR,
      examples,
      defaultConfigName: state.defaultConfigName,
      requiresInitialization: state.requiresInitialization,
      hasInitMarker: state.hasInitMarker,
      hasCustomConfig: envConfigFiles.source !== 'default',
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
    const { filename, serialPath } = req.body || {};

    if (typeof filename !== 'string' || filename.includes('/') || filename.includes('\\')) {
      return res.status(400).json({ error: 'INVALID_FILENAME' });
    }

    if (typeof serialPath !== 'string' || !serialPath.trim()) {
      return res.status(400).json({ error: 'SERIAL_PATH_REQUIRED' });
    }

    const examples = await listExampleConfigs();
    if (!examples.includes(filename)) {
      return res.status(404).json({ error: 'EXAMPLE_NOT_FOUND' });
    }

    const sourcePath = path.join(EXAMPLES_DIR, filename);
    let parsedConfig: unknown;

    try {
      const rawContent = await fs.readFile(sourcePath, 'utf-8');
      parsedConfig = yaml.load(rawContent);
    } catch (error) {
      logger.error({ err: error, sourcePath }, '[service] Failed to read example config for test');
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
    const serialConfig = extractSerialConfig(normalized);

    if (!serialConfig) {
      return res.status(400).json({ error: 'SERIAL_CONFIG_MISSING' });
    }

    const packets = await collectSerialPackets(serialPathValue, serialConfig, {
      maxPackets: 10,
      timeoutMs: 6000,
    });

    res.json({
      ok: true,
      portId: normalizePortId(serialConfig.portId || 'raw', 0),
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

    const { filename, serialPath } = req.body || {};
    if (typeof filename !== 'string' || filename.includes('/') || filename.includes('\\')) {
      return res.status(400).json({ error: 'INVALID_FILENAME' });
    }

    if (typeof serialPath !== 'string' || !serialPath.trim()) {
      return res.status(400).json({ error: 'SERIAL_PATH_REQUIRED' });
    }

    const examples = await listExampleConfigs();
    if (!examples.includes(filename)) {
      return res.status(404).json({ error: 'EXAMPLE_NOT_FOUND' });
    }

    const sourcePath = path.join(EXAMPLES_DIR, filename);
    const targetPath = path.join(CONFIG_DIR, DEFAULT_CONFIG_FILENAME);
    const serialPathValue = serialPath.trim();

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

    const updatedYaml = dumpConfigToYaml(parsedConfig, { lineWidth: 120 });

    await fs.mkdir(CONFIG_DIR, { recursive: true });
    await fs.writeFile(targetPath, updatedYaml, 'utf-8');
    await fs.writeFile(CONFIG_INIT_MARKER, new Date().toISOString(), 'utf-8');
    await fs.writeFile(CONFIG_RESTART_FLAG, 'restart', 'utf-8');

    logger.info(
      { filename, targetPath, serialPath: serialPathValue },
      '[service] Default config seeded from example',
    );

    res.json({
      ok: true,
      target: DEFAULT_CONFIG_FILENAME,
      restartScheduled: true,
    });

    await triggerRestart();
  } catch (error) {
    logger.error({ err: error }, '[service] Failed to select example config');
    res.status(500).json({ error: '기본 설정 생성에 실패했습니다.' });
  }
});

app.get('/api/commands', (_req, res) => {
  if (currentConfigs.length === 0) {
    return res.status(400).json({ error: 'Config not loaded' });
  }

  const commands = currentConfigs.flatMap((config, index) =>
    extractCommands(config).map((command) => ({
      ...command,
      configFile: currentConfigFiles[index],
    })),
  );
  res.json({ commands });
});

app.get('/api/config/raw/:entityId', (req, res) => {
  if (currentRawConfigs.length === 0) {
    return res.status(400).json({ error: 'Config not loaded' });
  }

  const { entityId } = req.params;
  let foundEntity: any = null;

  for (const rawConfig of currentRawConfigs) {
    for (const type of ENTITY_TYPE_KEYS) {
      const entities = rawConfig[type] as Array<any> | undefined;
      if (Array.isArray(entities)) {
        foundEntity = entities.find((e) => e.id === entityId);
        if (foundEntity) break;
      }
    }
    if (foundEntity) break;
  }

  if (foundEntity) {
    res.json({
      yaml: dumpConfigToYaml(foundEntity),
    });
  } else {
    res.status(404).json({ error: 'Entity not found in config' });
  }
});

app.post('/api/config/update', async (req, res) => {
  if (!configRateLimiter.check(req.ip || 'unknown')) {
    logger.warn({ ip: req.ip }, '[service] Config update rate limit exceeded');
    return res.status(429).json({ error: 'Too many requests' });
  }

  const {
    entityId,
    yaml: newEntityYaml,
    portId,
  } = req.body as { entityId: string; yaml: string; portId?: string };

  // Find config by portId if provided, otherwise fallback to finding by entityId
  let configIndex = portId ? findConfigIndexByPortId(portId) : findConfigIndexForEntity(entityId);
  if (configIndex === -1) {
    return res.status(404).json({ error: 'Entity not found in any loaded config' });
  }

  const targetConfigFile = currentConfigFiles[configIndex];

  try {
    // 1. Parse new YAML snippet
    let newEntity: any;
    try {
      newEntity = yaml.load(newEntityYaml);
    } catch (e) {
      return res.status(400).json({ error: 'Invalid YAML format' });
    }

    if (!newEntity || typeof newEntity !== 'object') {
      return res.status(400).json({ error: 'Invalid YAML content' });
    }

    // Ensure ID matches or at least exists
    if (newEntity.id && newEntity.id !== entityId) {
      // Warning: ID changed. This might duplicate if we just push,
      // but here we are replacing the *found* index.
      // So effectively we are renaming the entity in the config.
      logger.warn(`[service] Entity ID changed from ${entityId} to ${newEntity.id} during update`);
    }

    // 2. Read full config
    const configPath = path.join(CONFIG_DIR, targetConfigFile);
    const fileContent = await fs.readFile(configPath, 'utf8');
    const loadedYamlFromFile = yaml.load(fileContent) as {
      homenet_bridge: PersistableHomenetBridgeConfig;
    };

    if (!loadedYamlFromFile.homenet_bridge) {
      throw new Error('Invalid config file structure');
    }

    // Normalize the loaded config to ensure IDs are present
    const normalizedFullConfig = normalizeConfig(
      loadedYamlFromFile.homenet_bridge as HomenetBridgeConfig,
    );

    // 3. Find and update entity
    let found = false;
    for (const type of ENTITY_TYPE_KEYS) {
      const list = normalizedFullConfig[type] as any[]; // Use normalizedFullConfig here
      if (Array.isArray(list)) {
        const index = list.findIndex((e) => e.id === entityId);
        if (index !== -1) {
          list[index] = newEntity;
          found = true;
          break;
        }
      }
    }

    if (!found) {
      return res.status(404).json({ error: 'Entity not found in current config' });
    }

    // After updating normalizedFullConfig, we need to dump it back to YAML.
    // However, the original structure of `loadedYamlFromFile` (with `homenet_bridge` key)
    // needs to be preserved for dumping. So we will update the `loadedYamlFromFile.homenet_bridge`
    // with the content of `normalizedFullConfig` before dumping.
    loadedYamlFromFile.homenet_bridge = stripLegacyKeysBeforeSave(normalizedFullConfig); // Update the original object with normalized content

    // 4. Backup
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = `${configPath}.${timestamp}.bak`;
    await fs.copyFile(configPath, backupPath);

    // 5. Write new config
    // Note: This will strip comments and might alter formatting.
    const newFileContent = dumpConfigToYaml(loadedYamlFromFile);

    await fs.writeFile(configPath, newFileContent, 'utf8');

    // 6. Update in-memory raw config (this also needs to be normalized)
    currentRawConfigs[configIndex] = normalizedFullConfig;
    currentConfigs[configIndex] = normalizedFullConfig;
    rebuildPortMappings();

    logger.info(
      `[service] Config updated for entity ${entityId}. Backup created at ${path.basename(backupPath)}`,
    );
    res.json({ success: true, backup: path.basename(backupPath) });
  } catch (err) {
    logger.error({ err }, '[service] Failed to update config');
    res.status(500).json({ error: err instanceof Error ? err.message : 'Update failed' });
  }
});

app.post('/api/entities/rename', async (req, res) => {
  const { entityId, newName, portId } = req.body as {
    entityId?: string;
    newName?: string;
    portId?: string;
  };

  if (!entityId || typeof entityId !== 'string') {
    return res.status(400).json({ error: 'entityId가 필요합니다.' });
  }

  if (!newName || typeof newName !== 'string' || !newName.trim()) {
    return res.status(400).json({ error: '새 이름을 입력해주세요.' });
  }

  // Find config by portId if provided, otherwise fallback to finding by entityId
  const configIndex = portId ? findConfigIndexByPortId(portId) : findConfigIndexForEntity(entityId);
  if (configIndex === -1) {
    return res.status(404).json({ error: 'Entity not found in any loaded config' });
  }

  const targetConfigFile = currentConfigFiles[configIndex];

  try {
    const configPath = path.join(CONFIG_DIR, targetConfigFile);
    const fileContent = await fs.readFile(configPath, 'utf8');
    const loadedYamlFromFile = yaml.load(fileContent) as {
      homenet_bridge: PersistableHomenetBridgeConfig;
    };

    if (!loadedYamlFromFile.homenet_bridge) {
      throw new Error('Invalid config file structure');
    }

    const normalizedConfig = normalizeConfig(
      loadedYamlFromFile.homenet_bridge as HomenetBridgeConfig,
    );

    let targetEntity: any | null = null;
    for (const type of ENTITY_TYPE_KEYS) {
      const list = normalizedConfig[type] as any[] | undefined;
      if (!Array.isArray(list)) continue;
      const found = list.find((entry) => entry.id === entityId);
      if (found) {
        targetEntity = found;
        break;
      }
    }

    if (!targetEntity) {
      return res.status(404).json({ error: 'Entity not found in current config' });
    }

    const trimmedName = newName.trim();
    const uniqueId = targetEntity.unique_id || `homenet_${entityId}`;
    targetEntity.name = trimmedName;
    if (!targetEntity.unique_id) {
      targetEntity.unique_id = uniqueId;
    }

    loadedYamlFromFile.homenet_bridge = stripLegacyKeysBeforeSave(normalizedConfig);

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = `${configPath}.${timestamp}.bak`;
    await fs.copyFile(configPath, backupPath);

    const newFileContent = dumpConfigToYaml(loadedYamlFromFile);

    await fs.writeFile(configPath, newFileContent, 'utf8');

    currentRawConfigs[configIndex] = normalizedConfig;
    currentConfigs[configIndex] = normalizedConfig;
    rebuildPortMappings();

    const targetBridge = bridges.find((instance) => instance.configFile === targetConfigFile);
    targetBridge?.bridge.renameEntity(entityId, trimmedName, uniqueId);

    logger.info(
      `[service] Entity ${entityId} renamed to '${trimmedName}'. Backup created at ${path.basename(backupPath)}`,
    );

    res.json({
      success: true,
      entityId,
      newName: trimmedName,
      uniqueId,
      backup: path.basename(backupPath),
    });
  } catch (error) {
    logger.error({ err: error }, '[service] Failed to rename entity');
    res.status(500).json({ error: error instanceof Error ? error.message : 'Rename failed' });
  }
});

app.post('/api/entities/:entityId/revoke-discovery', (req, res) => {
  const { entityId } = req.params;
  if (!entityId) return res.status(400).json({ error: 'entityId required' });

  const bridgeInstance = findBridgeForEntity(entityId);
  if (!bridgeInstance) {
    return res.status(404).json({ error: 'Entity not found or bridge not active' });
  }

  const result = bridgeInstance.bridge.revokeDiscovery(entityId);
  if (result.success) {
    res.json({ success: true });
  } else {
    res.status(500).json({ error: result.error });
  }
});

app.delete('/api/entities/:entityId', async (req, res) => {
  const { entityId } = req.params;
  const portId = req.query.portId as string | undefined;

  // Find config by portId if provided, otherwise fallback to finding by entityId
  const configIndex = portId ? findConfigIndexByPortId(portId) : findConfigIndexForEntity(entityId);
  if (configIndex === -1) {
    return res.status(404).json({ error: 'Entity not found in any loaded config' });
  }

  const targetConfigFile = currentConfigFiles[configIndex];

  try {
    const configPath = path.join(CONFIG_DIR, targetConfigFile);
    const fileContent = await fs.readFile(configPath, 'utf8');
    const loadedYamlFromFile = yaml.load(fileContent) as {
      homenet_bridge: PersistableHomenetBridgeConfig;
    };

    if (!loadedYamlFromFile.homenet_bridge) {
      throw new Error('Invalid config file structure');
    }

    // Normalize to ensure we can match IDs accurately
    const normalizedConfig = normalizeConfig(
      loadedYamlFromFile.homenet_bridge as HomenetBridgeConfig,
    );

    let found = false;
    for (const type of ENTITY_TYPE_KEYS) {
      const list = normalizedConfig[type] as any[];
      if (Array.isArray(list)) {
        const index = list.findIndex((e) => e.id === entityId);
        if (index !== -1) {
          list.splice(index, 1);
          found = true;
          break;
        }
      }
    }

    if (!found) {
      return res.status(404).json({ error: 'Entity not found in config' });
    }

    // Update the original object structure with the modified data
    loadedYamlFromFile.homenet_bridge = stripLegacyKeysBeforeSave(normalizedConfig);

    // Backup
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = `${configPath}.${timestamp}.bak`;
    await fs.copyFile(configPath, backupPath);

    // Write new config
    const newFileContent = dumpConfigToYaml(loadedYamlFromFile);

    await fs.writeFile(configPath, newFileContent, 'utf8');

    // Update in-memory config
    currentRawConfigs[configIndex] = normalizedConfig;
    currentConfigs[configIndex] = normalizedConfig;
    rebuildPortMappings();

    logger.info(
      `[service] Entity ${entityId} deleted. Backup created at ${path.basename(backupPath)}`,
    );
    res.json({ success: true, backup: path.basename(backupPath) });
  } catch (err) {
    logger.error({ err }, '[service] Failed to delete entity');
    res.status(500).json({ error: err instanceof Error ? err.message : 'Delete failed' });
  }
});

app.post('/api/commands/execute', async (req, res) => {
  if (!commandRateLimiter.check(req.ip || 'unknown')) {
    return res.status(429).json({ error: 'Too many requests' });
  }

  const { entityId, commandName, value } = req.body as {
    entityId?: string;
    commandName?: string;
    value?: number | string;
  };

  if (!entityId || !commandName) {
    return res.status(400).json({ error: 'entityId and commandName are required' });
  }

  if (bridges.length === 0) {
    return res.status(400).json({ error: 'Bridge not started' });
  }

  // Convert command_on -> on, command_off -> off, etc.
  const cmdName = commandName.replace('command_', '');

  const targetBridge = findBridgeForEntity(entityId);

  if (!targetBridge) {
    return res.status(404).json({ error: 'Entity not found in loaded configs' });
  }

  const result = await targetBridge.bridge.executeCommand(entityId, cmdName, value);

  if (result.success) {
    res.json({
      success: true,
      entityId,
      commandName: cmdName,
      value,
      packet: result.packet,
    });
  } else {
    res.status(400).json({ error: result.error });
  }
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

async function loadAndStartBridges(filenames: string[]) {
  if (filenames.length === 0) {
    throw new Error('No configuration files provided.');
  }

  if (bridgeStartPromise) {
    await bridgeStartPromise.catch(() => {});
  }

  bridgeStartPromise = (async () => {
    await stopAllBridges();
    latestStates.clear();

    bridgeStatus = 'starting';
    bridgeError = null;

    const resolvedPaths = filenames.map(resolveConfigPath);
    logger.info(`[service] Loading configuration files: ${filenames.join(', ')}`);

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
    const loadedConfigFilesForCollector: { name: string; content: string }[] = [];

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
          loadedConfigFilesForCollector.push({ name: filenames[i], content });
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

function resolveMqttUrl(queryValue: unknown, defaultValue?: string) {
  const url = queryValue || defaultValue || 'mqtt://mq:1883';
  return url.toString().trim();
}

// --- Server Initialization ---
server.listen(port, async () => {
  logger.info(`Service listening on port ${port}`);
  try {
    logger.info('[service] Initializing bridge on startup...');
    const initState = await getInitializationState();

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
      (file) =>
        file === DEFAULT_CONFIG_FILENAME ||
        file === LEGACY_DEFAULT_CONFIG_FILENAME ||
        /\.homenet_bridge\.ya?ml$/.test(file),
    );

    const shouldPersistInitMarker =
      !initState.hasInitMarker && Boolean(initState.defaultConfigName);

    const availableConfigFiles = (() => {
      if (!initState.hasInitMarker && initState.defaultConfigName) {
        const remaining = (
          configFilesFromEnv.length > 0 ? configFilesFromEnv : discoveredConfigFiles
        ).filter((file) => file !== initState.defaultConfigName);
        return [initState.defaultConfigName, ...remaining];
      }

      return configFilesFromEnv.length > 0 ? configFilesFromEnv : discoveredConfigFiles;
    })();

    const uniqueConfigFiles = [...new Set(availableConfigFiles)];

    if (uniqueConfigFiles.length === 0) {
      throw new Error('No homenet_bridge configuration files found in config directory.');
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
      await fs.unlink(CONFIG_RESTART_FLAG).catch(() => {});
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

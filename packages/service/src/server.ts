import express from 'express';
import path from 'node:path';
import fs from 'node:fs/promises';
import dotenv from 'dotenv';
import { createServer, type IncomingMessage } from 'node:http';
import { fileURLToPath } from 'node:url';
import yaml, { Type } from 'js-yaml';
import { WebSocket, WebSocketServer } from 'ws';
import {
  createBridge,
  HomeNetBridge,
  HomenetBridgeConfig,
  logger,
  eventBus,
  LambdaConfig,
  normalizeConfig,
  normalizePortId,
  validateConfig,
} from '@rs485-homenet/core';
import { activityLogService } from './activity-log.service.js';
import { logCollectorService } from './log-collector.service.js';

// Define a custom YAML type for !lambda
const LambdaType = new Type('!lambda', {
  kind: 'scalar',
  construct: (data: string): LambdaConfig => {
    return { type: 'lambda', script: data };
  },
});

// Create a schema that includes the custom LambdaType
const HOMENET_BRIDGE_SCHEMA = yaml.DEFAULT_SCHEMA.extend([LambdaType]);

dotenv.config();

// --- Constants ---
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CONFIG_DIR = process.env.CONFIG_ROOT || path.resolve(__dirname, '../../core/config');
const FRONTEND_SETTINGS_FILE = path.join(CONFIG_DIR, 'frontend-setting.json');
type PersistableHomenetBridgeConfig = Omit<HomenetBridgeConfig, 'serials'> & {
  serials?: HomenetBridgeConfig['serials'];
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

const envConfigFiles = parseEnvList('CONFIG_FILES', 'CONFIG_FILE', '설정 파일');

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
let bridgeStatus: 'idle' | 'starting' | 'started' | 'stopped' | 'error' = 'idle';
let bridgeError: string | null = null;
let bridgeStartPromise: Promise<void> | null = null;

type FrontendSettings = {
  toast: {
    stateChange: boolean;
    command: boolean;
  };
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
  };
};

const saveFrontendSettings = async (settings: FrontendSettings) => {
  await fs.mkdir(CONFIG_DIR, { recursive: true });
  await fs.writeFile(
    FRONTEND_SETTINGS_FILE,
    JSON.stringify(settings, null, 2),
    'utf-8',
  );
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
  const { portId } = req.params;

  if (bridges.length === 0) {
    return res.status(503).json({ error: 'Bridge not started' });
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
    return res.status(404).json({ error: 'Bridge not found for port ' + portId });
  }

  try {
    logger.info({ portId }, '[service] Starting latency test');
    const stats = await targetBridgeInstance.bridge.runLatencyTest(portId);
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
    return res.status(503).json({ error: 'Bridge is starting...' });
  }

  if (currentConfigs.length === 0) {
    return res.json({
      configFiles: currentConfigFiles,
      bridges: [],
      mqttUrl: process.env.MQTT_URL?.trim() || 'mqtt://mq:1883',
      status: 'error',
      error: bridgeError || '브리지가 설정되지 않았거나 시작에 실패했습니다.',
      topic: `${BASE_MQTT_PREFIX}/homedevice1/raw`,
    });
  }

  const bridgesInfo = currentConfigs.map((config, configIndex) => {
    const serialTopics = config.serials?.map((serial: HomenetBridgeConfig['serials'][number], index: number) => {
      const portId = normalizePortId(serial.portId, index);
      return {
        portId,
        path: serial.path,
        baudRate: serial.baud_rate,
        topic: `${BASE_MQTT_PREFIX}/${portId}`,
      };
    }) ?? [];

    return {
      configFile: currentConfigFiles[configIndex],
      serials: serialTopics,
      mqttTopicPrefix: BASE_MQTT_PREFIX,
      topic: `${serialTopics[0]?.topic || `${BASE_MQTT_PREFIX}/homedevice1`}/raw`,
    };
  });

  const firstTopic = bridgesInfo[0]?.topic ?? `${BASE_MQTT_PREFIX}/homedevice1/raw`;

  res.json({
    configFiles: currentConfigFiles,
    bridges: bridgesInfo,
    mqttUrl: process.env.MQTT_URL?.trim() || 'mqtt://mq:1883',
    status: bridgeStatus,
    error: bridgeError,
    topic: firstTopic,
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
    config.serials?.forEach((serial, index) => {
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
  eventBus.on('state:changed', broadcastStateChange);
  eventBus.on('mqtt-message', (data: { topic: string; payload: string; portId?: string }) => {
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

activityLogService.addLog('서비스가 시작되었습니다.');

const registerPacketStream = () => {
  wss.on('connection', (socket: WebSocket, req: IncomingMessage) => {
    const requestUrl = getRequestUrl(req);
    const streamMqttUrl = resolveMqttUrl(
      requestUrl?.searchParams.get('mqttUrl') ?? '',
      process.env.MQTT_URL?.trim() || 'mqtt://mq:1883',
    );
    sendStreamEvent(socket, 'status', {
      state: 'connected',
      mqttUrl: streamMqttUrl
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
        logger.warn({
          err: error
        }, '[service] Invalid WebSocket message received');
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
      const entityName = entity.name as string || entityId;

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
        if (key === 'command_temperature' || key === 'command_speed' || key === 'command_brightness' || key === 'command_percentage' || key === 'command_position') {
          cmdInfo.inputType = 'number';

          // Get visual config for temperature bounds (climate)
          const visual = entity.visual as { min_temperature?: string; max_temperature?: string; temperature_step?: string } | undefined;
          if (visual && key === 'command_temperature') {
            const parseTemp = (val?: string) => val ? parseInt(val.replace(/[^\d]/g, '')) : undefined;
            cmdInfo.min = parseTemp(visual.min_temperature) ?? 5;
            cmdInfo.max = parseTemp(visual.max_temperature) ?? 40;
            cmdInfo.step = parseTemp(visual.temperature_step) ?? 1;
          } else if (key === 'command_brightness') {
            cmdInfo.min = 0;
            cmdInfo.max = 255;
            cmdInfo.step = 1;
          } else if (key === 'command_percentage' || key === 'command_speed' || key === 'command_position') {
            cmdInfo.min = 0;
            cmdInfo.max = 100;
            cmdInfo.step = 1;
          }
        }

        // Number entity
        if (entityType === 'number' && key === 'command_number') {
          cmdInfo.inputType = 'number';
          cmdInfo.min = entity.min_value as number ?? 0;
          cmdInfo.max = entity.max_value as number ?? 100;
          cmdInfo.step = entity.step as number ?? 1;
        }

        // Select entity
        if (entityType === 'select' && key === 'command_option') {
          cmdInfo.inputType = 'text';
          cmdInfo.options = entity.options as string[] ?? [];
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
    res.json({ yaml: yaml.dump(foundEntity, { styles: { '!!int': 'hexadecimal' } }).replace(/\b0x([0-9a-fA-F])\b/g, '0x0$1') });
  } else {
    res.status(404).json({ error: 'Entity not found in config' });
  }
});

app.post('/api/config/update', async (req, res) => {
  const { entityId, yaml: newEntityYaml } = req.body as { entityId: string; yaml: string };

  if (currentConfigFiles.length !== 1) {
    return res.status(500).json({ error: '단일 설정 파일이 로드된 경우에만 수정할 수 있습니다.' });
  }

  const targetConfigFile = currentConfigFiles[0];

  try {
    // 1. Parse new YAML snippet
    let newEntity: any;
    try {
      newEntity = yaml.load(newEntityYaml, { schema: HOMENET_BRIDGE_SCHEMA });
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
    const loadedYamlFromFile = yaml.load(fileContent, { schema: HOMENET_BRIDGE_SCHEMA }) as {
      homenet_bridge: PersistableHomenetBridgeConfig;
    };

    if (!loadedYamlFromFile.homenet_bridge) {
      throw new Error('Invalid config file structure');
    }

    // Normalize the loaded config to ensure IDs are present
    const normalizedFullConfig = normalizeConfig(loadedYamlFromFile.homenet_bridge as HomenetBridgeConfig);

    // 3. Find and update entity
    let found = false;
    for (const type of ENTITY_TYPE_KEYS) {
      const list = normalizedFullConfig[type] as any[]; // Use normalizedFullConfig here
      if (Array.isArray(list)) {
        const index = list.findIndex(e => e.id === entityId);
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
    const newFileContent = yaml.dump(loadedYamlFromFile, { // Dump the full object
      schema: HOMENET_BRIDGE_SCHEMA,
      styles: { '!!int': 'hexadecimal' },
      noRefs: true,
      lineWidth: -1 // Try to avoid wrapping lines excessively
    });

    await fs.writeFile(configPath, newFileContent, 'utf8');

    // 6. Update in-memory raw config (this also needs to be normalized)
    currentRawConfigs = [normalizedFullConfig]; // Update with normalized config
    currentConfigs = [normalizedFullConfig]; // Ensure bridge uses normalized config
    rebuildPortMappings();

    logger.info(`[service] Config updated for entity ${entityId}. Backup created at ${path.basename(backupPath)}`);
    res.json({ success: true, backup: path.basename(backupPath) });
  } catch (err) {
    logger.error({ err }, '[service] Failed to update config');
    res.status(500).json({ error: err instanceof Error ? err.message : 'Update failed' });
  }
});

app.post('/api/entities/rename', async (req, res) => {
  const { entityId, newName } = req.body as { entityId?: string; newName?: string };

  if (!entityId || typeof entityId !== 'string') {
    return res.status(400).json({ error: 'entityId가 필요합니다.' });
  }

  if (!newName || typeof newName !== 'string' || !newName.trim()) {
    return res.status(400).json({ error: '새 이름을 입력해주세요.' });
  }

  if (currentConfigFiles.length !== 1) {
    return res.status(500).json({ error: '단일 설정 파일이 로드된 경우에만 엔터티 이름을 변경할 수 있습니다.' });
  }

  try {
    const configPath = path.join(CONFIG_DIR, currentConfigFiles[0]);
    const fileContent = await fs.readFile(configPath, 'utf8');
    const loadedYamlFromFile = yaml.load(fileContent, { schema: HOMENET_BRIDGE_SCHEMA }) as {
      homenet_bridge: PersistableHomenetBridgeConfig;
    };

    if (!loadedYamlFromFile.homenet_bridge) {
      throw new Error('Invalid config file structure');
    }

    const normalizedConfig = normalizeConfig(loadedYamlFromFile.homenet_bridge as HomenetBridgeConfig);

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

    const newFileContent = yaml.dump(loadedYamlFromFile, {
      schema: HOMENET_BRIDGE_SCHEMA,
      styles: { '!!int': 'hexadecimal' },
      noRefs: true,
      lineWidth: -1,
    });

    await fs.writeFile(configPath, newFileContent, 'utf8');

    currentRawConfigs = [normalizedConfig];
    currentConfigs = [normalizedConfig];
    rebuildPortMappings();

    const targetBridge = bridges.find((instance) => instance.configFile === currentConfigFiles[0]);
    targetBridge?.bridge.renameEntity(entityId, trimmedName, uniqueId);

    logger.info(
      `[service] Entity ${entityId} renamed to '${trimmedName}'. Backup created at ${path.basename(backupPath)}`,
    );

    res.json({ success: true, entityId, newName: trimmedName, uniqueId, backup: path.basename(backupPath) });
  } catch (error) {
    logger.error({ err: error }, '[service] Failed to rename entity');
    res.status(500).json({ error: error instanceof Error ? error.message : 'Rename failed' });
  }
});

app.post('/api/commands/execute', async (req, res) => {
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
    const message = err instanceof Error ? err.message : 'Internal Server Error';
    res.status(500).json({ error: message });
  },
);

// --- Bridge Management ---
const loadConfigFile = async (configPath: string): Promise<HomenetBridgeConfig> => {
  const fileContent = await fs.readFile(configPath, 'utf8');
  const loadedYaml = yaml.load(fileContent, { schema: HOMENET_BRIDGE_SCHEMA }) as {
    homenet_bridge: HomenetBridgeConfig;
  };

  if (!loadedYaml || !loadedYaml.homenet_bridge) {
    throw new Error('Invalid configuration file format. Missing "homenet_bridge" top-level key.');
  }

  const rawConfig = loadedYaml.homenet_bridge;
  const normalized = normalizeConfig(
    JSON.parse(JSON.stringify(rawConfig)) as HomenetBridgeConfig,
  );
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
    await bridgeStartPromise.catch(() => { });
  }

  bridgeStartPromise = (async () => {
    await stopAllBridges();
    latestStates.clear();

    bridgeStatus = 'starting';
    bridgeError = null;

    try {
      const resolvedPaths = filenames.map(resolveConfigPath);
      logger.info(`[service] Loading configuration files: ${filenames.join(', ')}`);

      const loadedConfigs: HomenetBridgeConfig[] = [];
      for (const configPath of resolvedPaths) {
        loadedConfigs.push(await loadConfigFile(configPath));
      }

      currentConfigFiles = filenames;
      currentRawConfigs = loadedConfigs;
      currentConfigs = loadedConfigs;
      rebuildPortMappings();

      const mqttUrl = process.env.MQTT_URL?.trim() || 'mqtt://mq:1883';
      const mqttUsername = process.env.MQTT_USER?.trim() || undefined;
      const mqttPassword = process.env.MQTT_PASSWD?.trim() || undefined;

      const startedBridges: BridgeInstance[] = [];

      for (let i = 0; i < loadedConfigs.length; i += 1) {
        const bridge = await createBridge(
          resolvedPaths[i],
          mqttUrl,
          mqttUsername,
          mqttPassword,
          BASE_MQTT_PREFIX,
          loadedConfigs[i],
        );

        startedBridges.push({
          bridge,
          configFile: filenames[i],
          resolvedPath: resolvedPaths[i],
          config: loadedConfigs[i],
        });
      }

      bridges = startedBridges;

      // Init LogCollector with the new bridges
      const loadedConfigFiles = await Promise.all(
        resolvedPaths.map(async (p, idx) => ({
          name: filenames[idx],
          content: await fs.readFile(p, 'utf-8'),
        })),
      );
      await logCollectorService.init(
        bridges.map((b) => b.bridge),
        loadedConfigFiles,
      );

      bridgeStatus = 'started';
      logger.info(`[service] Bridge started successfully with ${currentConfigFiles.join(', ')}`);
    } catch (err) {
      bridgeStatus = 'error';
      bridgeError = err instanceof Error ? err.message : 'Unknown error during bridge start.';
      await stopAllBridges({ preserveStatus: true });
      logger.error({ err }, '[service] Failed to start bridge');
    } finally {
      bridgeStartPromise = null;
    }
  })();

  return bridgeStartPromise;
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
    const configFilesFromEnv = envConfigFiles.values;
    const availableConfigFiles = configFilesFromEnv.length > 0
      ? configFilesFromEnv
      : (await fs.readdir(CONFIG_DIR)).filter((file) => /\.homenet_bridge\.ya?ml$/.test(file));

    if (availableConfigFiles.length === 0) {
      throw new Error('No homenet_bridge configuration files found in config directory.');
    }

    logger.info(
      {
        configFiles: availableConfigFiles.map((file) => path.basename(file)),
        configRoot: CONFIG_DIR,
      },
      '[service] Starting bridge with configuration files',
    );

    await loadAndStartBridges(availableConfigFiles);
  } catch (err) {
    logger.error({ err }, '[service] Initial bridge start failed');
    bridgeStatus = 'error';
    bridgeError = err instanceof Error ? err.message : 'Initial start failed.';
  }
});

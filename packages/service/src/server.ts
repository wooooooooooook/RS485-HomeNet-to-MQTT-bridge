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
  validateConfig,
} from '@rs485-homenet/core';

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

// --- Application State ---
const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server, path: '/api/packets/stream' });
const port = process.env.PORT ? Number(process.env.PORT) : 3000;

// --- Packet History Cache ---
const commandPacketHistory: unknown[] = [];
const parsedPacketHistory: unknown[] = [];
const MAX_PACKET_HISTORY = 1000;

eventBus.on('command-packet', (packet) => {
  commandPacketHistory.push(packet);
  if (commandPacketHistory.length > MAX_PACKET_HISTORY) {
    commandPacketHistory.shift();
  }
});

eventBus.on('parsed-packet', (packet) => {
  parsedPacketHistory.push(packet);
  if (parsedPacketHistory.length > MAX_PACKET_HISTORY) {
    parsedPacketHistory.shift();
  }
});

let bridge: HomeNetBridge | null = null;
// bridgeOptions will now be derived from the loaded HomenetBridgeConfig
let currentConfigFile: string | null = null;
let currentConfigContent: HomenetBridgeConfig | null = null;
let currentRawConfig: HomenetBridgeConfig | null = null;
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

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok' });
});

app.get('/api/bridge/info', async (_req, res) => {
  // If a startup is in progress, tell the client to wait.
  if (bridgeStartPromise) {
    return res.status(503).json({ error: 'Bridge is starting...' });
  }

  if (!currentConfigContent) {
    return res.json({
      configFile: currentConfigFile || 'N/A',
      serialPath: process.env.SERIAL_PORT || '/simshare/rs485-sim-tty',
      baudRate: 0,
      mqttUrl: process.env.MQTT_URL?.trim() || 'mqtt://mq:1883',
      status: 'error',
      error: bridgeError || '브리지가 설정되지 않았거나 시작에 실패했습니다.',
      topic: 'homenet/raw',
    });
  }
  res.json({
    configFile: currentConfigFile,
    serialPath: process.env.SERIAL_PORT || '/simshare/rs485-sim-tty', // Serial path is now from env or default
    baudRate: currentConfigContent.serial.baud_rate, // From new config structure
    mqttUrl: process.env.MQTT_URL?.trim() || 'mqtt://mq:1883',
    status: bridgeStatus,
    error: bridgeError,
    topic: 'homenet/raw', // This might become dynamic later
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

type StreamEvent =
  | 'status'
  | 'mqtt-message'
  | 'raw-data'
  | 'raw-data-with-interval'
  | 'packet-interval-stats'
  | 'command-packet'
  | 'parsed-packet'
  | 'state-change';

type StreamMessage<T = unknown> = {
  event: StreamEvent;
  data: T;
};

type RawPacketPayload = {
  payload?: string;
  interval?: number | null;
  receivedAt?: string;
};

type RawPacketEvent = {
  topic: string;
  payload: string;
  receivedAt: string;
  interval: number | null;
};

type StateChangeEvent = {
  entityId: string;
  topic: string;
  payload: string;
  state: Record<string, unknown>;
  timestamp: string;
};

const normalizeRawPacket = (data: RawPacketPayload): RawPacketEvent => ({
  topic: 'homenet/raw',
  payload: typeof data.payload === 'string' ? data.payload : '',
  receivedAt: data.receivedAt ?? new Date().toISOString(),
  interval: typeof data.interval === 'number' ? data.interval : null,
});

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

const registerPacketStream = () => {
  wss.on('connection', (socket: WebSocket, req: IncomingMessage) => {
    const requestUrl = getRequestUrl(req);
    const streamMqttUrl = resolveMqttUrl(
      requestUrl?.searchParams.get('mqttUrl') ?? '',
      process.env.MQTT_URL?.trim() || 'mqtt://mq:1883',
    );

    sendStreamEvent(socket, 'status', { state: 'connected', mqttUrl: streamMqttUrl });

    let isStreaming = false;
    const streamEventHandlers: Array<() => void> = [];

    const stopStreaming = () => {
      if (!isStreaming) return;
      logger.info('[service] UI requested to stop streaming raw packets.');
      bridge?.stopRawPacketListener();
      streamEventHandlers.forEach(handler => handler());
      streamEventHandlers.length = 0;
      isStreaming = false;
    };

    const startStreaming = () => {
      if (isStreaming) return;
      logger.info('[service] UI requested to start streaming raw packets.');

      const handleRawDataWithInterval = (data: RawPacketPayload) => {
        sendStreamEvent(socket, 'raw-data-with-interval', normalizeRawPacket(data));
      };
      eventBus.on('raw-data-with-interval', handleRawDataWithInterval);
      streamEventHandlers.push(() => eventBus.off('raw-data-with-interval', handleRawDataWithInterval));

      const handlePacketIntervalStats = (data: unknown) => {
        sendStreamEvent(socket, 'packet-interval-stats', data);
      };
      eventBus.on('packet-interval-stats', handlePacketIntervalStats);
      streamEventHandlers.push(() => eventBus.off('packet-interval-stats', handlePacketIntervalStats));

      bridge?.startRawPacketListener();
      isStreaming = true;
    };

    // These events are always on, regardless of streaming state
    const cleanupHandlers: Array<() => void> = [];

    const handleCommandPacket = (data: unknown) => {
      sendStreamEvent(socket, 'command-packet', data);
    };
    eventBus.on('command-packet', handleCommandPacket);
    cleanupHandlers.push(() => eventBus.off('command-packet', handleCommandPacket));

    const handleMqttMessage = (data: { topic: string; payload: string }) => {
      sendStreamEvent(socket, 'mqtt-message', {
        topic: data.topic,
        payload: data.payload,
        receivedAt: new Date().toISOString(),
      });
    };
    eventBus.on('mqtt-message', handleMqttMessage);
    cleanupHandlers.push(() => eventBus.off('mqtt-message', handleMqttMessage));

    const handleParsedPacket = (data: unknown) => {
      sendStreamEvent(socket, 'parsed-packet', data);
    };
    eventBus.on('parsed-packet', handleParsedPacket);
    cleanupHandlers.push(() => eventBus.off('parsed-packet', handleParsedPacket));

    const handleStateChange = (data: StateChangeEvent) => {
      sendStreamEvent(socket, 'state-change', data);
    };
    eventBus.on('state:changed', handleStateChange);
    cleanupHandlers.push(() => eventBus.off('state:changed', handleStateChange));

    socket.on('message', (message: string) => {
      try {
        const parsed = JSON.parse(message);
        if (parsed.command === 'start') {
          startStreaming();
        } else if (parsed.command === 'stop') {
          stopStreaming();
        }
      } catch (error) {
        logger.warn({ err: error }, '[service] Invalid WebSocket message received');
      }
    });

    const heartbeat = setInterval(() => {
      if (socket.readyState === WebSocket.OPEN) {
        socket.ping();
      }
    }, 15000);
    cleanupHandlers.push(() => clearInterval(heartbeat));

    const cleanup = () => {
      stopStreaming();
      cleanupHandlers.forEach((handler) => handler());
    };

    socket.on('close', cleanup);
    socket.on('error', cleanup);
  });
};

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
  const entityTypeKeys: (keyof HomenetBridgeConfig)[] = [
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

app.get('/api/commands', (_req, res) => {
  if (!currentConfigContent) {
    return res.status(400).json({ error: 'Config not loaded' });
  }

  const commands = extractCommands(currentConfigContent);
  res.json({ commands });
});

app.get('/api/config/raw/:entityId', (req, res) => {
  if (!currentRawConfig) {
    return res.status(400).json({ error: 'Config not loaded' });
  }

  const { entityId } = req.params;
  let foundEntity: any = null;

  // All entity types (same as discovery-manager)
  const entityTypeKeys: (keyof HomenetBridgeConfig)[] = [
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

  for (const type of entityTypeKeys) {
    const entities = currentRawConfig[type] as Array<any> | undefined;
    if (Array.isArray(entities)) {
      foundEntity = entities.find((e) => e.id === entityId);
      if (foundEntity) break;
    }
  }

  if (foundEntity) {
    res.json({ yaml: yaml.dump(foundEntity, { styles: { '!!int': 'hexadecimal' } }) });
  } else {
    res.status(404).json({ error: 'Entity not found in config' });
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

  if (!bridge) {
    return res.status(400).json({ error: 'Bridge not started' });
  }

  // Convert command_on -> on, command_off -> off, etc.
  const cmdName = commandName.replace('command_', '');

  const result = await bridge.executeCommand(entityId, cmdName, value);

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
async function loadAndStartBridge(filename: string) {
  if (bridgeStartPromise) {
    await bridgeStartPromise.catch(() => { }); // Wait for any ongoing start/stop to finish
  }
  if (bridge) {
    logger.info('[service] Stopping existing bridge...');
    bridgeStatus = 'stopped';
    await bridge.stop();
    bridge = null;
    logger.info('[service] Bridge stopped.');
  }

  logger.info(`[service] Loading configuration from '${filename}'...`);
  bridgeStatus = 'starting';
  bridgeError = null;

  try {
    const configPath = path.join(CONFIG_DIR, filename);
    const fileContent = await fs.readFile(configPath, 'utf8');
    const loadedYaml = yaml.load(fileContent, { schema: HOMENET_BRIDGE_SCHEMA }) as {
      homenet_bridge: HomenetBridgeConfig;
    };

    if (!loadedYaml || !loadedYaml.homenet_bridge) {
      throw new Error('Invalid configuration file format. Missing "homenet_bridge" top-level key.');
    }

    currentConfigFile = filename;
    currentRawConfig = loadedYaml.homenet_bridge; // Store raw config for display
    currentConfigContent = normalizeConfig(loadedYaml.homenet_bridge); // Store the normalized config

    validateConfig(currentConfigContent);

    const mqttUrl = process.env.MQTT_URL?.trim() || 'mqtt://mq:1883';
    const mqttUsername = process.env.MQTT_USER?.trim() || undefined;
    const mqttPassword = process.env.MQTT_PASSWD?.trim() || undefined;

    // createBridge now expects configPath, mqttUrl, and optional credentials
    bridge = await createBridge(configPath, mqttUrl, mqttUsername, mqttPassword);

    bridgeStatus = 'started';
    logger.info(`[service] Bridge started successfully with '${filename}'.`);
  } catch (err) {
    bridgeStatus = 'error';
    bridgeError = err instanceof Error ? err.message : 'Unknown error during bridge start.';
    logger.error({ err }, `[service] Failed to start bridge with '${filename}'`);
    // Don't re-throw, let the caller handle the status
  } finally {
    bridgeStartPromise = null;
  }
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
    if (process.env.CONFIG_FILE) {
      logger.info(
        `[service] Loading configuration from environment variable: ${process.env.CONFIG_FILE}`,
      );
      // Extract filename from path if needed, or just pass the path if loadAndStartBridge handles it.
      // loadAndStartBridge expects a filename relative to CONFIG_DIR.
      // If CONFIG_FILE is a full path like 'packages/core/config/samsung_sds.homenet_bridge.yaml',
      // we need to handle that.
      // However, looking at loadAndStartBridge: const configPath = path.join(CONFIG_DIR, filename);
      // So we should pass just the basename if it's in the config dir.

      const configBasename = path.basename(process.env.CONFIG_FILE);
      await loadAndStartBridge(configBasename);
    } else {
      const files = await fs.readdir(CONFIG_DIR);
      // Filter for homenet_bridge.yaml files
      const defaultConfigFile = files.find((file) => /\.homenet_bridge\.ya?ml$/.test(file));

      if (defaultConfigFile) {
        await loadAndStartBridge(defaultConfigFile);
      } else {
        throw new Error('No homenet_bridge configuration files found in config directory.');
      }
    }
  } catch (err) {
    logger.error({ err }, '[service] Initial bridge start failed');
    bridgeStatus = 'error';
    bridgeError = err instanceof Error ? err.message : 'Initial start failed.';
  }
});

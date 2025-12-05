import express from 'express';
import path from 'node:path';
import fs from 'node:fs/promises';
import dotenv from 'dotenv';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import yaml, { Type } from 'js-yaml';
import { WebSocket, WebSocketServer } from 'ws';
// Import only createBridge and HomeNetBridge, BridgeOptions is now defined in core
// Import only createBridge and HomeNetBridge, BridgeOptions is now defined in core
import {
  createBridge,
  HomeNetBridge,
  HomenetBridgeConfig,
  logger,
  eventBus,
  LambdaConfig,
} from '@rs485-homenet/core';
import { PacketCache } from './cache.js';

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

// --- Application State ---
const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server, path: '/api/packets/stream' });
const port = process.env.PORT ? Number(process.env.PORT) : 3000;

let bridge: HomeNetBridge | null = null;
// bridgeOptions will now be derived from the loaded HomenetBridgeConfig
let currentConfigFile: string | null = null;
let currentConfigContent: HomenetBridgeConfig | null = null; // Type changed to HomenetBridgeConfig
let bridgeStatus: 'idle' | 'starting' | 'started' | 'stopped' | 'error' = 'idle';
let bridgeError: string | null = null;
let bridgeStartPromise: Promise<void> | null = null;

// --- Cache Initialization ---
const packetCache = new PacketCache(eventBus);

// --- Express Middleware & Setup ---
app.use(express.json());

// --- API Endpoints ---
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

type StreamEvent =
  | 'status'
  | 'mqtt-message'
  | 'raw-data'
  | 'raw-data-with-interval'
  | 'packet-interval-stats'
  | 'command-packet';

type StreamMessage<T = unknown> = {
  event: StreamEvent;
  data: T;
};

const sendStreamEvent = <T>(socket: WebSocket, event: StreamEvent, payload: T) => {
  if (socket.readyState !== WebSocket.OPEN) return;
  const message: StreamMessage<T> = { event, data: payload };
  socket.send(JSON.stringify(message));
};

const getRequestUrl = (req: { url?: string; headers?: { host?: string } }) => {
  if (!req.url) return null;
  const host = req.headers?.host || 'localhost';
  return new URL(req.url, `http://${host}`);
};

const registerPacketStream = () => {
  wss.on('connection', (socket, req) => {
    const requestUrl = getRequestUrl(req);
    const streamMqttUrl = resolveMqttUrl(
      requestUrl?.searchParams.get('mqttUrl') ?? '',
      process.env.MQTT_URL?.trim() || 'mqtt://mq:1883',
    );

    sendStreamEvent(socket, 'status', { state: 'connected', mqttUrl: streamMqttUrl });

    const initialState = packetCache.getInitialState();

    initialState.mqttState.forEach((msg) => {
      sendStreamEvent(socket, 'mqtt-message', msg);
    });

    initialState.rawPackets.forEach((packet) => {
      sendStreamEvent(socket, 'raw-data-with-interval', packet);
    });

    initialState.commandPackets.forEach((packet) => {
      sendStreamEvent(socket, 'command-packet', packet);
    });

    if (initialState.packetStats) {
      sendStreamEvent(socket, 'packet-interval-stats', initialState.packetStats);
    }

    const cleanupHandlers: Array<() => void> = [];

    const handleRawData = (data: string) => {
      sendStreamEvent(socket, 'raw-data', {
        topic: 'homenet/raw',
        payload: data,
        receivedAt: new Date().toISOString(),
      });
    };
    eventBus.on('raw-data', handleRawData);
    cleanupHandlers.push(() => eventBus.off('raw-data', handleRawData));

    const handleRawDataWithInterval = (data: unknown) => {
      sendStreamEvent(socket, 'raw-data-with-interval', data);
    };
    eventBus.on('raw-data-with-interval', handleRawDataWithInterval);
    cleanupHandlers.push(() => eventBus.off('raw-data-with-interval', handleRawDataWithInterval));

    const handlePacketIntervalStats = (data: unknown) => {
      sendStreamEvent(socket, 'packet-interval-stats', data);
    };
    eventBus.on('packet-interval-stats', handlePacketIntervalStats);
    cleanupHandlers.push(() => eventBus.off('packet-interval-stats', handlePacketIntervalStats));

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

    const heartbeat = setInterval(() => {
      if (socket.readyState === WebSocket.OPEN) {
        socket.ping();
      }
    }, 15000);
    cleanupHandlers.push(() => clearInterval(heartbeat));

    const cleanup = () => {
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
    currentConfigContent = loadedYaml.homenet_bridge; // Store the actual homenet_bridge config

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

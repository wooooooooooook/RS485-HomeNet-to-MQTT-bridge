import express from 'express';
import path from 'node:path';
import fs from 'node:fs/promises';
import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
import mqtt from 'mqtt';
import yaml, { Type, Schema } from 'js-yaml';
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
const port = process.env.PORT ? Number(process.env.PORT) : 3000;

let bridge: HomeNetBridge | null = null;
// bridgeOptions will now be derived from the loaded HomenetBridgeConfig
let currentConfigFile: string | null = null;
let currentConfigContent: HomenetBridgeConfig | null = null; // Type changed to HomenetBridgeConfig
let bridgeStatus: 'idle' | 'starting' | 'started' | 'stopped' | 'error' = 'idle';
let bridgeError: string | null = null;
let bridgeStartPromise: Promise<void> | null = null;

// --- Express Middleware & Setup ---
app.use(express.json());
app.use(express.static(path.resolve(__dirname, '../static')));

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

app.get('/api/configs', async (_req, res, next) => {
  try {
    const files = await fs.readdir(CONFIG_DIR);
    // Filter for homenet_bridge.yaml files
    const yamlFiles = files.filter((file) => /\.homenet_bridge\.ya?ml$/.test(file));
    res.json(yamlFiles);
  } catch (err) {
    next(err);
  }
});

app.get('/api/configs/current', (_req, res) => {
  if (!currentConfigFile) {
    return res.status(404).json({ error: 'No config loaded' });
  }
  res.json({
    file: currentConfigFile,
    content: currentConfigContent,
  });
});

app.post('/api/configs/select', async (req, res, next) => {
  const { file } = req.body;
  if (typeof file !== 'string') {
    return res.status(400).json({ error: 'Invalid file name' });
  }

  try {
    await loadAndStartBridge(file);
    res.json({ success: true, message: `Configuration '${file}' loaded.` });
  } catch (err) {
    next(err);
  }
});

app.get('/api/packets/stream', (req, res) => {
  const streamMqttUrl = resolveMqttUrl(
    req.query.mqttUrl,
    process.env.MQTT_URL?.trim() || 'mqtt://mq:1883',
  );

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  const sendEvent = (event: string, payload: unknown) => {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  };

  const sendStatus = (state: string, extra: Record<string, unknown> = {}) => {
    sendEvent('status', { state, ...extra });
  };

  sendStatus('connecting', { mqttUrl: streamMqttUrl });

  const client = mqtt.connect(streamMqttUrl);

  // Listen for raw data from the event bus
  const handleRawData = (data: string) => {
    sendEvent('raw-data', {
      topic: 'homenet/raw', // Mimic MQTT topic for consistency with UI
      payload: data,
      receivedAt: new Date().toISOString(),
    });
  };
  eventBus.on('raw-data', handleRawData);

  const handleRawDataWithInterval = (data: unknown) => {
    sendEvent('raw-data-with-interval', data);
  };
  eventBus.on('raw-data-with-interval', handleRawDataWithInterval);

  const handlePacketIntervalStats = (data: unknown) => {
    sendEvent('packet-interval-stats', data);
  };
  eventBus.on('packet-interval-stats', handlePacketIntervalStats);

  // Listen for command packets from the event bus
  const handleCommandPacket = (data: unknown) => {
    sendEvent('command-packet', data);
  };
  eventBus.on('command-packet', handleCommandPacket);

  client.on('connect', () => {
    sendStatus('connected', { mqttUrl: streamMqttUrl });
    client.subscribe('homenet/#', (err) => {
      if (err) {
        sendStatus('error', { message: err.message });
        return;
      }
      sendStatus('subscribed', { topic: 'homenet/#' });
    });
  });

  client.on('reconnect', () => sendStatus('connecting', { mqttUrl: streamMqttUrl }));
  client.on('error', (err) => sendStatus('error', { message: err.message }));
  client.on('close', () => sendStatus('error', { message: 'MQTT connection closed.' }));

  client.on('message', (topic, payload) => {
    logger.debug({ topic }, '[service] MQTT message received');
    const payloadString =
      topic === 'homenet/raw' ? payload.toString('hex') : payload.toString('utf8');
    sendEvent('mqtt-message', {
      topic,
      payload: payloadString,
      receivedAt: new Date().toISOString(),
    });
  });

  const heartbeat = setInterval(() => res.write(': keep-alive\n\n'), 15000);
  req.on('close', () => {
    clearInterval(heartbeat);
    client.end(true);
    eventBus.off('raw-data', handleRawData); // Remove event bus listener
    eventBus.off('raw-data-with-interval', handleRawDataWithInterval);
    eventBus.off('packet-interval-stats', handlePacketIntervalStats);
    eventBus.off('command-packet', handleCommandPacket); // Remove command packet listener
  });
});

// --- Static Serving & Error Handling ---
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
app.listen(port, async () => {
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

import express from 'express';
import path from 'node:path';
import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
import { createServer, Server as HttpServer } from 'node:http';
import { SerialReader, type SerialReaderOptions } from './serial-reader.js';
import { WebSocketBroadcaster } from './websocket.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

type AddressInfo = { port: number };

export interface ServiceConfig {
  port: number;
  serialPath?: string;
  baudRate: number;
  mqttUrl?: string;
}

export interface RunningService {
  app: express.Express;
  server: HttpServer;
  serialReader?: SerialReader;
  broadcaster: WebSocketBroadcaster;
  start: () => Promise<void>;
  stop: () => Promise<void>;
}

export interface ServiceDependencies {
  createSerialReader?: (options: SerialReaderOptions) => SerialReader;
  createBroadcaster?: (server: HttpServer) => WebSocketBroadcaster;
}

function parseNumber(value: string | undefined, fallback: number) {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? fallback : parsed;
}

function resolveSerialPath() {
  const candidates = [
    'SERIAL_PATH',
    'SERIAL_PORT',
    'SERIAL_DEVICE',
    'SIM_SERIAL_PATH',
    'SIMULATOR_SERIAL_PATH',
    'SIMULATOR_PTY_PATH',
    'PTY_PATH',
  ] as const;

  for (const key of candidates) {
    const value = process.env[key];
    if (value) {
      return value;
    }
  }

  return undefined;
}

export function loadConfigFromEnv(): ServiceConfig {
  return {
    port: parseNumber(process.env.PORT, 3000),
    baudRate: parseNumber(process.env.BAUD_RATE, 9600),
    serialPath: resolveSerialPath(),
    mqttUrl: process.env.MQTT_URL,
  };
}

export function createService(config: ServiceConfig, dependencies: ServiceDependencies = {}): RunningService {
  const app = express();
  app.use(express.json());

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  const staticDir = path.resolve(__dirname, '../static');
  app.use(express.static(staticDir));

  app.get('*', (_req, res, next) => {
    const indexPath = path.join(staticDir, 'index.html');
    res.sendFile(indexPath, (err) => {
      if (err) {
        next();
      }
    });
  });

  const server = createServer(app);
  const createBroadcaster = dependencies.createBroadcaster ?? ((srv: HttpServer) => new WebSocketBroadcaster(srv));
  const broadcaster = createBroadcaster(server);

  let serialReader: SerialReader | undefined;

  if (config.serialPath) {
    const createSerialReader = dependencies.createSerialReader ?? ((options: SerialReaderOptions) => new SerialReader(options));
    serialReader = createSerialReader({ path: config.serialPath, baudRate: config.baudRate });
    serialReader.on('data', (data) => {
      broadcaster.broadcast(data);
    });

    serialReader.on('error', (error) => {
      console.error('[serial] error', error);
    });
  } else {
    console.warn('[serial] serial path not provided; skipping serial connection');
  }

  const start = async () => {
    await new Promise<void>((resolve) => {
      server.listen(config.port, resolve);
    });

    const address = server.address() as AddressInfo | string | null;
    if (address && typeof address === 'object') {
      console.log(`Service listening on port ${address.port}`);
    } else {
      console.log(`Service listening on port ${config.port}`);
    }

    if (serialReader) {
      try {
        await serialReader.open();
        console.log(`[serial] connected to ${config.serialPath}`);
      } catch (error) {
        console.error('[serial] failed to open port', error);
      }
    }
  };

  const stop = async () => {
    if (serialReader?.isOpen()) {
      try {
        await serialReader.close();
      } catch (error) {
        console.error('[serial] failed to close port', error);
      }
    }

    broadcaster.close();

    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      });
    });
  };

  return { app, server, broadcaster, serialReader, start, stop };
}

const isMain = process.argv[1] ? path.resolve(process.argv[1]) === __filename : false;

if (isMain) {
  const config = loadConfigFromEnv();
  const service = createService(config);

  service
    .start()
    .catch((error) => {
      console.error('[service] failed to start', error);
      process.exitCode = 1;
    });
}

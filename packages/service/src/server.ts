import express from 'express';
import path from 'node:path';
import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
import mqtt from 'mqtt';
import { createBridge } from '@rs485-homenet/core';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = process.env.PORT ? Number(process.env.PORT) : 3000;
const defaultMqttUrl = resolveDefaultMqttUrl(process.env.MQTT_URL);
const bridgeOptions = resolveBridgeOptions();
const bridge = createBridge(bridgeOptions);
let bridgeStatus: 'idle' | 'starting' | 'started' | 'error' = 'idle';
let bridgeError: string | null = null;
let bridgeStartPromise: Promise<void> | null = null;

app.use(express.json());

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok' });
});

app.get('/api/bridge/info', (_req, res) => {
  res.json({
    serialPath: bridgeOptions.serialPath,
    baudRate: bridgeOptions.baudRate,
    mqttUrl: bridgeOptions.mqttUrl,
    status: bridgeStatus,
    error: bridgeError,
    topic: 'homenet/raw',
  });
});

app.get('/api/packets/stream', (req, res) => {
  const streamMqttUrl = resolveMqttUrl(req.query.mqttUrl);

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

  client.on('connect', () => {
    sendStatus('connected', { mqttUrl: streamMqttUrl });
    client.subscribe('homenet/raw', (err) => {
      if (err) {
        sendStatus('error', { message: err.message });
        return;
      }

      sendStatus('subscribed', { topic: 'homenet/raw' });
    });
  });

  client.on('reconnect', () => {
    sendStatus('connecting', { mqttUrl: streamMqttUrl });
  });

  client.on('message', (topic, payload) => {
    const packet = {
      topic,
      payload: payload.toString('utf8'),
      payloadHex: payload.toString('hex'),
      payloadLength: payload.length,
      receivedAt: new Date().toISOString(),
    };

    sendEvent('packet', packet);
  });

  client.on('error', (err) => {
    sendStatus('error', { message: err.message });
  });

  client.on('close', () => {
    sendStatus('error', { message: 'MQTT 연결이 종료되었습니다.' });
  });

  const heartbeat = setInterval(() => {
    res.write(': keep-alive\n\n');
  }, 15000);

  req.on('close', () => {
    clearInterval(heartbeat);
    client.end(true);
  });
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

app.use(
  (err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error('[service] 요청 처리 중 오류:', err);
    if (res.headersSent) {
      return;
    }

    const message = err instanceof Error ? err.message : 'Internal Server Error';
    res.status(500).json({ error: message });
  },
);

app.listen(port, () => {
  console.log(`Service listening on port ${port}`);
});

startBridge().catch((err) => {
  console.error('[service] 브리지 시작 실패:', err);
});

function startBridge() {
  if (bridgeStartPromise) {
    return bridgeStartPromise;
  }

  bridgeStatus = 'starting';
  bridgeError = null;

  bridgeStartPromise = bridge
    .start()
    .then(() => {
      bridgeStatus = 'started';
      bridgeError = null;
    })
    .catch((err) => {
      bridgeStatus = 'error';
      bridgeError = err instanceof Error ? err.message : '알 수 없는 오류가 발생했습니다.';
      bridgeStartPromise = null;
      throw err;
    });

  return bridgeStartPromise;
}

function resolveBridgeOptions() {
  return {
    serialPath: resolveSerialPath(),
    baudRate: resolveBaudRate(),
    mqttUrl: defaultMqttUrl,
  };
}

function resolveSerialPath() {
  const value = process.env.SERIAL_PORT?.trim();
  if (value && value.length > 0) {
    return value;
  }

  return '/simshare/rs485-sim-tty';
}

function resolveBaudRate() {
  const raw = process.env.BAUD_RATE ?? '';
  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed) || parsed <= 0) {
    return 9600;
  }

  return parsed;
}

function resolveMqttUrl(value: unknown) {
  if (typeof value === 'string' && value.trim().length > 0) {
    return value.trim();
  }

  return defaultMqttUrl;
}

function resolveDefaultMqttUrl(value: unknown) {
  if (typeof value === 'string' && value.trim().length > 0) {
    return value.trim();
  }

  return 'mqtt://mq:1883';
}

import dotenv from 'dotenv';
import { SerialPort } from 'serialport';
import mqtt from 'mqtt';
import { access } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';

dotenv.config();

const SERIAL_WAIT_INTERVAL_MS = 500;
const DEFAULT_SERIAL_WAIT_TIMEOUT_MS = 15000;

const resolveSerialWaitTimeout = () => {
  const raw = process.env.SERIAL_PATH_WAIT_TIMEOUT_MS ?? '';
  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed) || parsed <= 0) {
    return DEFAULT_SERIAL_WAIT_TIMEOUT_MS;
  }

  return parsed;
};

const SERIAL_WAIT_TIMEOUT_MS = resolveSerialWaitTimeout();

const waitForSerialDevice = async (serialPath: string) => {
  const startedAt = Date.now();

  while (true) {
    try {
      await access(serialPath);
      return;
    } catch (err) {
      const error = err as NodeJS.ErrnoException;
      if (error && error.code && error.code !== 'ENOENT' && error.code !== 'ENODEV') {
        throw error;
      }

      const elapsed = Date.now() - startedAt;
      if (elapsed >= SERIAL_WAIT_TIMEOUT_MS) {
        throw new Error(
          `시리얼 포트 경로(${serialPath})를 ${SERIAL_WAIT_TIMEOUT_MS}ms 내에 찾지 못했습니다.`,
        );
      }

      await delay(SERIAL_WAIT_INTERVAL_MS);
    }
  }
};

const openSerialPort = (port: SerialPort) =>
  new Promise<void>((resolve, reject) => {
    port.open((err) => {
      if (err) {
        reject(err);
        return;
      }

      resolve();
    });
  });

export interface BridgeOptions {
  serialPath: string;
  baudRate: number;
  mqttUrl: string;
}

export class HomeNetBridge {
  private readonly options: BridgeOptions;
  private readonly client: mqtt.MqttClient;
  private port?: SerialPort;
  private startPromise: Promise<void> | null = null;

  constructor(options: BridgeOptions) {
    this.options = options;
    this.client = mqtt.connect(options.mqttUrl);
  }

  start() {
    if (!this.startPromise) {
      this.startPromise = this.initialize();
    }

    return this.startPromise;
  }

  private async initialize() {
    await waitForSerialDevice(this.options.serialPath);

    this.port = new SerialPort({
      path: this.options.serialPath,
      baudRate: this.options.baudRate,
      autoOpen: false,
    });

    await openSerialPort(this.port);

    this.port.on('data', (data) => {
      this.client.publish('homenet/raw', data);
    });

    this.port.on('error', (err) => {
      console.error(`[core] 시리얼 포트 오류(${this.options.serialPath}):`, err);
    });
  }
}
export function createBridge(options: BridgeOptions) {
  return new HomeNetBridge(options);
}

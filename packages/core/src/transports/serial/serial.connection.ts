import { access } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { SerialPort } from 'serialport';

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

export const isTcpConnection = (serialPath: string) => serialPath.includes(':');

export const waitForSerialDevice = async (serialPath: string, timeoutMs?: number) => {
  const startedAt = Date.now();
  const waitTimeout = timeoutMs ?? SERIAL_WAIT_TIMEOUT_MS;

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
      if (elapsed >= waitTimeout) {
        throw new Error(`시리얼 포트 경로(${serialPath})를 ${waitTimeout}ms 내에 찾지 못했습니다.`);
      }

      await delay(SERIAL_WAIT_INTERVAL_MS);
    }
  }
};

export const openSerialPort = (port: SerialPort) =>
  new Promise<void>((resolve, reject) => {
    port.open((err) => {
      if (err) {
        reject(err);
        return;
      }
      resolve();
    });
  });

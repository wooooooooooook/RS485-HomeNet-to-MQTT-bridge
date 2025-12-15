import pino from 'pino';
import { logBuffer } from './log-buffer.js';

export const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  hooks: {
    logMethod(inputArgs, method, level) {
      const levelLabel = pino.levels.labels[level] || 'unknown';
      logBuffer.add(levelLabel, inputArgs);
      return method.apply(this, inputArgs);
    },
  },
  transport: {
    target: 'pino-pretty',
    options: {
      colorize: true,
      translateTime: 'SYS:standard',
      ignore: 'pid,hostname',
    },
  },
});

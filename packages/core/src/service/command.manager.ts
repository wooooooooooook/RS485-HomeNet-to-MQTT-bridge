// packages/core/src/service/command.manager.ts
import { Duplex } from 'stream';
import { HomenetBridgeConfig } from '../config/types.js';
import { EntityConfig } from '../domain/entities/base.entity.js';
import { logger } from '../utils/logger.js';
import { eventBus } from './event-bus.js';

interface CommandJob {
  entity: EntityConfig;
  packet: number[];
  attemptsLeft: number;
  timer: NodeJS.Timeout | null;
  resolve: () => void;
  reject: (reason?: any) => void;
  isSettled: boolean;
}

export class CommandManager {
  private queue: CommandJob[] = [];
  private isProcessing = false;
  private serialPort: Duplex;
  private config: HomenetBridgeConfig;
  private ackListeners: Map<string, () => void> = new Map();

  constructor(serialPort: Duplex, config: HomenetBridgeConfig) {
    this.serialPort = serialPort;
    this.config = config;

    // Listen for state updates to resolve pending commands
    eventBus.on('state:changed', ({ entityId }) => {
      this.handleAck(entityId);
    });
  }

  public send(entity: EntityConfig, packet: number[]): Promise<void> {
    return new Promise((resolve, reject) => {
      const retryConfig = this.getRetryConfig(entity);
      const job: CommandJob = {
        entity,
        packet,
        attemptsLeft: (retryConfig.attempts ?? 5) + 1,
        timer: null,
        resolve,
        reject,
        isSettled: false,
      };
      this.queue.push(job);
      this.processQueue();
    });
  }

  private getRetryConfig(entity: EntityConfig) {
    const defaults = this.config.packet_defaults || {};
    const overrides = entity.packet_parameters || {};

    return {
      attempts: overrides.tx_retry_cnt ?? defaults.tx_retry_cnt ?? 5,
      timeout: overrides.tx_timeout ?? defaults.tx_timeout ?? 2000,
      interval: overrides.tx_delay ?? defaults.tx_delay ?? 125,
    };
  }

  private async processQueue() {
    if (this.isProcessing || this.queue.length === 0) {
      return;
    }
    this.isProcessing = true;
    const job = this.queue.shift()!;

    this.executeJob(job)
      .then(job.resolve)
      .catch(job.reject)
      .finally(() => {
        this.isProcessing = false;
        this.processQueue();
      });
  }

  private executeJob(job: CommandJob): Promise<void> {
    return new Promise((resolve, reject) => {
      const retryConfig = this.getRetryConfig(job.entity);
      job.attemptsLeft = retryConfig.attempts + 1;

      const attempt = () => {
        if (job.isSettled) return;

        job.attemptsLeft--;
        if (job.attemptsLeft < 0) {
          job.isSettled = true;
          logger.warn({ entity: job.entity.name }, `[CommandManager] Command failed after all retries`);
          this.removeAckListener(job.entity.id);
          return reject(new Error('ACK timeout'));
        }

        const onAck = () => {
          if (job.isSettled) return;
          job.isSettled = true;
          if (job.timer) clearTimeout(job.timer);
          logger.info({ entity: job.entity.name }, `[CommandManager] ACK received`);
          this.removeAckListener(job.entity.id);
          resolve();
        };

        this.setAckListener(job.entity.id, onAck);

        logger.info({ entity: job.entity.name, attemptsLeft: job.attemptsLeft }, `[CommandManager] Sending command`);
        this.serialPort.write(Buffer.from(job.packet));

        job.timer = setTimeout(() => {
          this.removeAckListener(job.entity.id);
          if (job.isSettled) return;
          logger.warn({ entity: job.entity.name }, `[CommandManager] ACK timeout, retrying...`);
          setTimeout(attempt, retryConfig.interval);
        }, retryConfig.timeout);
      };

      attempt();
    });
  }

  private setAckListener(entityId: string, callback: () => void) {
    this.ackListeners.set(entityId, callback);
  }

  private removeAckListener(entityId: string) {
    this.ackListeners.delete(entityId);
  }

  private handleAck(entityId: string) {
    const listener = this.ackListeners.get(entityId);
    if (listener) {
      listener();
    }
  }
}

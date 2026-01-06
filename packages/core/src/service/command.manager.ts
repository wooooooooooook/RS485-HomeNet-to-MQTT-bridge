// packages/core/src/service/command.manager.ts
import { Duplex } from 'stream';
import { HomenetBridgeConfig } from '../config/types.js';
import { EntityConfig } from '../domain/entities/base.entity.js';
import { logger } from '../utils/logger.js';
import { PacketProcessor } from '../protocol/packet-processor.js';
import { StateSchema } from '../protocol/types.js';
import { matchesPacket } from '../utils/packet-matching.js';
import { eventBus } from './event-bus.js';

interface RetryConfig {
  attempts: number;
  timeout: number;
  interval: number;
}

interface CommandJob {
  entity?: EntityConfig; // Optional to support raw commands
  ackMatch?: StateSchema; // For raw commands
  packet: number[];
  attemptsLeft: number;
  retryConfig: RetryConfig;
  packetMatcher?: (packet: Buffer) => void;
  timer: NodeJS.Timeout | null;
  resolve: () => void;
  reject: (reason?: any) => void;
  isSettled: boolean;
}

export class CommandManager {
  private queue: CommandJob[] = [];
  private lowPriorityQueue: CommandJob[] = [];
  private isProcessing = false;
  private serialPort: Duplex;
  private config: HomenetBridgeConfig;
  private ackListeners: Map<string, () => void> = new Map();
  private packetAckListeners: Set<(packet: Buffer) => void> = new Set();
  private portId: string;
  private packetProcessor?: PacketProcessor;

  constructor(
    serialPort: Duplex,
    config: HomenetBridgeConfig,
    portId: string,
    packetProcessor?: PacketProcessor,
  ) {
    this.serialPort = serialPort;
    this.config = config;
    this.portId = portId;
    this.packetProcessor = packetProcessor;

    // Listen for state updates to resolve pending commands
    eventBus.on('state:changed', ({ entityId, portId }) => {
      if (portId && portId !== this.portId) return;
      this.handleAck(entityId);
    });

    if (this.packetProcessor) {
      this.packetProcessor.on('packet', (packet: Buffer) => {
        this.handlePacketAck(packet);
      });
    }
  }

  public send(
    entity: EntityConfig,
    packet: number[],
    options?: { priority?: 'normal' | 'low'; ackMatch?: StateSchema },
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const retryConfig = this.getRetryConfig(entity);
      const job: CommandJob = {
        entity,
        ackMatch: options?.ackMatch,
        packet,
        retryConfig,
        attemptsLeft: (retryConfig.attempts ?? 5) + 1,
        timer: null,
        resolve,
        reject,
        isSettled: false,
      };
      if (options?.priority === 'low') {
        this.lowPriorityQueue.push(job);
      } else {
        this.queue.push(job);
      }
      this.processQueue();
    });
  }

  public sendRaw(
    packet: number[],
    options?: {
      priority?: 'normal' | 'low';
      ackMatch?: StateSchema;
      retry?: number;
      timeout?: number;
      interval?: number;
    },
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const defaults = this.config.packet_defaults || {};
      const retryConfig = {
        attempts: options?.retry ?? defaults.tx_retry_cnt ?? 5,
        timeout: options?.timeout ?? defaults.tx_timeout ?? 100,
        interval: options?.interval ?? defaults.tx_delay ?? 50,
      };

      const job: CommandJob = {
        ackMatch: options?.ackMatch,
        packet,
        retryConfig,
        attemptsLeft: options?.ackMatch ? retryConfig.attempts + 1 : 1,
        timer: null,
        resolve,
        reject,
        isSettled: false,
      };

      if (options?.priority === 'low') {
        this.lowPriorityQueue.push(job);
      } else {
        this.queue.push(job);
      }
      this.processQueue();
    });
  }

  private getRetryConfig(entity?: EntityConfig) {
    const defaults = this.config.packet_defaults || {};
    if (!entity) {
      return {
        attempts: defaults.tx_retry_cnt ?? 5,
        timeout: defaults.tx_timeout ?? 100,
        interval: defaults.tx_delay ?? 50,
      };
    }
    const overrides = entity.packet_parameters || {};

    return {
      attempts: overrides.tx_retry_cnt ?? defaults.tx_retry_cnt ?? 5,
      timeout: overrides.tx_timeout ?? defaults.tx_timeout ?? 100,
      interval: overrides.tx_delay ?? defaults.tx_delay ?? 50,
    };
  }

  private async processQueue() {
    if (this.isProcessing) {
      return;
    }

    // Process normal queue first, then low priority queue
    const job = this.queue.shift() || this.lowPriorityQueue.shift();

    if (!job) {
      return;
    }

    this.isProcessing = true;

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
      const retryConfig = job.retryConfig;
      const totalAttempts = job.attemptsLeft;
      let attemptNumber = 0;

      const attempt = () => {
        if (job.isSettled) return;

        job.attemptsLeft--;
        if (job.attemptsLeft < 0) {
          job.isSettled = true;
          logger.warn(
            {
              entity: job.entity?.name ?? 'raw',
              attempts: totalAttempts,
              timeout: retryConfig.timeout,
              interval: retryConfig.interval,
            },
            `[CommandManager] Command failed: sent ${totalAttempts} times but no ACK received`,
          );
          this.cleanupListeners(job);
          return resolve(); // Resolve instead of reject to avoid throwing error
        }

        attemptNumber++;

        const onAck = () => {
          if (job.isSettled) return;
          job.isSettled = true;
          if (job.timer) clearTimeout(job.timer);
          logger.info(
            { entity: job.entity?.name ?? 'raw' },
            `[CommandManager] Command succeeded: ACK received`,
          );
          this.cleanupListeners(job);
          resolve();
        };

        this.setupListener(job, onAck);

        logger.info(
          { entity: job.entity?.name ?? 'raw' },
          `[CommandManager] Trying to send command (${attemptNumber}/${totalAttempts})`,
        );
        const packetBuffer = Buffer.from(job.packet);
        this.serialPort.write(packetBuffer);

        // Emit raw-tx-packet event for logging
        eventBus.emit('raw-tx-packet', {
          portId: this.portId,
          payload: packetBuffer.toString('hex'),
          timestamp: new Date().toISOString(),
        });

        // If no ACK required (raw command without match, or entity without retry), resolve immediately?
        // Logic for entity: it always waits if retryConfig.attempts > 0?
        // Actually, if retryConfig.attempts is 0, we still send once. Do we wait for ACK?
        // Existing logic: waits for ACK until timeout.
        // For sendRaw without ackMatch, attemptsLeft should be 1, and we should NOT wait for ACK?
        if (!job.entity && !job.ackMatch) {
          job.isSettled = true;
          resolve();
          return;
        }

        job.timer = setTimeout(() => {
          this.cleanupListeners(job);
          if (job.isSettled) return;
          setTimeout(attempt, retryConfig.interval);
        }, retryConfig.timeout);
      };

      attempt();
    });
  }

  private setupListener(job: CommandJob, callback: () => void) {
    // If entity exists, always set up state:changed listener
    if (job.entity) {
      this.setAckListener(job.entity.id, callback);
    }

    // If ackMatch exists, also set up packet matcher
    // This allows both state:changed and ack packet to trigger ACK
    if (job.ackMatch) {
      const matcher = (packet: Buffer) => {
        if (job.ackMatch && matchesPacket(job.ackMatch, packet)) {
          callback();
        }
      };
      job.packetMatcher = matcher;
      this.packetAckListeners.add(matcher);
    }
  }

  private cleanupListeners(job: CommandJob) {
    // Clean up entity listener if exists
    if (job.entity) {
      this.removeAckListener(job.entity.id);
    }
    // Clean up packet matcher if exists
    if (job.packetMatcher) {
      this.packetAckListeners.delete(job.packetMatcher);
    }
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

  private handlePacketAck(packet: Buffer) {
    for (const listener of this.packetAckListeners) {
      listener(packet);
    }
  }
}

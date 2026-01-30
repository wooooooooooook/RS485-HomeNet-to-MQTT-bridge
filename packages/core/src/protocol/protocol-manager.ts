import { EventEmitter } from 'node:events';
import { ProtocolConfig } from './types.js';
import { PacketParser } from './packet-parser.js';
import { Device } from './device.js';
import { logger } from '../utils/logger.js';
import { Buffer } from 'buffer';
import { Worker } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export class ProtocolManager extends EventEmitter {
  private parser: PacketParser;
  private devices: Device[] = [];
  private config: ProtocolConfig;
  private txQueue: number[][] = [];
  private txQueueLowPriority: number[][] = [];
  private lastTxTime: number = 0;
  private worker: Worker | null = null;
  private workerReady: boolean = false;
  private pendingChunks: Buffer[] = [];
  private pendingChunkSize: number = 0;
  private readonly MAX_PENDING_BYTES = 65536;

  constructor(config: ProtocolConfig) {
    super();
    this.config = config;
    this.parser = new PacketParser(config.packet_defaults || {});

    if (this.shouldUseWorker()) {
      this.initWorker();
    }
  }

  private shouldUseWorker(): boolean {
    return !(process.env.VITEST || process.env.NODE_ENV === 'test');
  }

  private initWorker() {
    try {
      const __filename = fileURLToPath(import.meta.url);
      const __dirname = path.dirname(__filename);
      // The worker file is expected to be in the same directory as the compiled output of this file
      const workerPath = path.join(__dirname, 'protocol-worker.js');

      this.worker = new Worker(workerPath);

      this.worker.on('message', (msg: { type: string; payload: any }) => {
        if (msg.type === 'packets') {
          const packets = msg.payload as Buffer[];
          for (const pkt of packets) {
            // Buffer received from worker needs to be wrapped properly
            // Optimization: Create a view if possible to avoid redundant copy
            const buffer =
              pkt instanceof Uint8Array
                ? Buffer.from(pkt.buffer, pkt.byteOffset, pkt.byteLength)
                : Buffer.from(pkt);
            this.processPacket(buffer);
          }
        } else if (msg.type === 'ready') {
          this.workerReady = true;
          this.flushPendingChunks();
        } else if (msg.type === 'error') {
          const payload = msg.payload as { message?: string; chunk?: Buffer };
          logger.warn(
            { err: payload?.message },
            '[ProtocolManager] Worker parse error, falling back to main thread',
          );
          this.fallbackToMain(payload?.chunk);
        }
      });

      this.worker.on('error', (err) => {
        logger.error({ err }, '[ProtocolManager] Worker error, falling back to main thread');
        this.fallbackToMain();
      });

      this.worker.on('exit', (code) => {
        if (code !== 0) {
          logger.warn({ code }, '[ProtocolManager] Worker stopped with exit code');
        }
        this.terminateWorker();
      });

      // Initialize worker configuration
      this.worker.postMessage({
        type: 'init',
        payload: this.config.packet_defaults,
      });
      logger.info('[ProtocolManager] Packet parsing worker initializing');
    } catch (err) {
      logger.warn({ err }, '[ProtocolManager] Failed to start worker, using main thread');
      this.worker = null;
      this.workerReady = false;
    }
  }

  private terminateWorker() {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
      this.workerReady = false;
    }
  }

  private flushPendingChunks() {
    if (!this.worker || !this.workerReady || this.pendingChunks.length === 0) {
      return;
    }

    for (const chunk of this.pendingChunks) {
      this.worker.postMessage({ type: 'chunk', payload: chunk });
    }

    this.pendingChunks = [];
    this.pendingChunkSize = 0;
  }

  private fallbackToMain(extraChunk?: Buffer | Uint8Array) {
    const chunks: Buffer[] = [];
    if (this.pendingChunks.length > 0) {
      chunks.push(...this.pendingChunks);
    }
    if (extraChunk) {
      chunks.push(Buffer.isBuffer(extraChunk) ? extraChunk : Buffer.from(extraChunk));
    }

    this.pendingChunks = [];
    this.pendingChunkSize = 0;
    this.terminateWorker();

    for (const chunk of chunks) {
      const packets = this.parser.parseChunk(chunk);
      for (const packet of packets) {
        this.processPacket(packet);
      }
    }
  }

  public registerDevice(device: Device) {
    this.devices.push(device);
    logger.debug(
      { deviceId: device.getId(), deviceName: device.getName() },
      '[ProtocolManager] Device registered',
    );
  }

  public getDevice(id: string): Device | undefined {
    return this.devices.find((d) => d.getId() === id);
  }

  public handleIncomingByte(byte: number): void {
    // For single byte, just use buffer method
    this.handleIncomingChunk(Buffer.from([byte]));
  }

  public handleIncomingChunk(chunk: Buffer): void {
    if (this.worker && this.workerReady) {
      this.worker.postMessage({ type: 'chunk', payload: chunk });
    } else if (this.worker && !this.workerReady) {
      this.pendingChunks.push(chunk);
      this.pendingChunkSize += chunk.length;
      if (this.pendingChunkSize > this.MAX_PENDING_BYTES) {
        logger.warn('[ProtocolManager] Worker init delayed, switching to main thread parsing');
        this.fallbackToMain();
      }
    } else {
      // Fallback to main thread parsing
      const packets = this.parser.parseChunk(chunk);
      for (const packet of packets) {
        this.processPacket(packet);
      }
    }
  }

  public queueCommand(command: number[], highPriority: boolean = true) {
    if (highPriority) {
      this.txQueue.push(command);
    } else {
      this.txQueueLowPriority.push(command);
    }
  }

  public getNextCommand(): number[] | null {
    const now = Date.now();
    const txDelay = this.config.packet_defaults?.tx_delay || 50;

    if (now - this.lastTxTime < txDelay) {
      return null;
    }

    let command: number[] | undefined;

    if (this.txQueue.length > 0) {
      command = this.txQueue.shift();
    } else if (this.txQueueLowPriority.length > 0) {
      command = this.txQueueLowPriority.shift();
    }

    if (command) {
      this.lastTxTime = now;
      return command;
    }

    return null;
  }

  private processPacket(packet: Buffer) {
    if (!this.isLengthAllowed(packet.length)) {
      logger.debug(
        { length: packet.length },
        '[ProtocolManager] Packet length out of bounds, skipping',
      );
      return;
    }
    this.emit('packet', packet);

    let matchedAny = false;

    // Optimization: Only generate hex string if debug logging is enabled
    // This avoids expensive string allocation/regex ops in the hot path
    const isDebug = logger.isLevelEnabled('debug');
    let packetHex = '';
    if (isDebug) {
      packetHex = packet.toString('hex').replace(/../g, '0x$& ').trim();
    }

    for (const device of this.devices) {
      let stateUpdates: Record<string, any> | null = null;
      try {
        stateUpdates = device.parseData(packet);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.emit('entity-error', {
          entityId: device.getId(),
          type: 'parse',
          message,
          timestamp: new Date().toISOString(),
          context: {
            packet: packet.toString('hex'),
          },
        });
        continue;
      }
      if (stateUpdates) {
        matchedAny = true;

        let targetDeviceId = device.getId();
        if (device.config.state_proxy && device.config.target_id) {
          targetDeviceId = device.config.target_id;
          if (isDebug) {
            logger.debug(
              `[ProtocolManager] Proxying state from ${device.getId()} to ${targetDeviceId}`,
            );
          }
        }

        if (isDebug) {
          const stateStr = JSON.stringify(stateUpdates).replace(/["{}]/g, '').replace(/,/g, ', ');
          logger.debug(
            `[ProtocolManager] ${targetDeviceId} (${device.getName()}): ${packetHex} → {${stateStr}}`,
          );
        }
        this.emit('state', { deviceId: targetDeviceId, state: stateUpdates });
        this.emit('parsed-packet', {
          deviceId: targetDeviceId,
          packet,
          state: stateUpdates,
        });
      }
    }

    if (!matchedAny) {
      this.emit('unmatched-packet', { packet });
      if (isDebug) {
        logger.debug(`[ProtocolManager] Packet not matched: ${packetHex}`);
      }
    }
  }

  private isLengthAllowed(length: number): boolean {
    const minLength = this.config.packet_defaults?.rx_min_length;
    if (typeof minLength === 'number' && minLength > 0 && length < minLength) {
      return false;
    }

    const maxLength = this.config.packet_defaults?.rx_max_length;
    if (typeof maxLength === 'number' && maxLength > 0 && length > maxLength) {
      return false;
    }

    return true;
  }
}

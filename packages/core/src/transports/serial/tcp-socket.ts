// packages/core/src/transports/serial/tcp-socket.ts

import { Duplex, DuplexOptions } from 'stream';
import net from 'net';
import { logger } from '../../utils/logger.js';

export interface ReconnectingTcpSocketOptions {
  initialDelayMs?: number;
  maxDelayMs?: number;
  connectionTimeoutMs?: number;
}

const DEFAULT_INITIAL_DELAY_MS = 1000;
const DEFAULT_MAX_DELAY_MS = 30000;
const DEFAULT_CONNECTION_TIMEOUT_MS = 5000;

/**
 * A TCP socket wrapper that automatically reconnects on disconnection.
 * Extends Duplex to be compatible with existing code expecting a stream.
 */
export class ReconnectingTcpSocket extends Duplex {
  private readonly host: string;
  private readonly port: number;
  private readonly initialDelayMs: number;
  private readonly maxDelayMs: number;
  private readonly connectionTimeoutMs: number;

  private socket: net.Socket | null = null;
  private currentDelay: number;
  private reconnecting = false;
  private _isDestroyed = false;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private writeBuffer: { chunk: Buffer; callback: (error?: Error | null) => void }[] = [];

  constructor(
    host: string,
    port: number,
    options: ReconnectingTcpSocketOptions = {},
    streamOptions?: DuplexOptions,
  ) {
    super(streamOptions);
    this.host = host;
    this.port = port;
    this.initialDelayMs = options.initialDelayMs ?? DEFAULT_INITIAL_DELAY_MS;
    this.maxDelayMs = options.maxDelayMs ?? DEFAULT_MAX_DELAY_MS;
    this.connectionTimeoutMs = options.connectionTimeoutMs ?? DEFAULT_CONNECTION_TIMEOUT_MS;
    this.currentDelay = this.initialDelayMs;
  }

  /**
   * Connect to the TCP server. Returns a promise that resolves when connected.
   */
  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this._isDestroyed) {
        reject(new Error('Socket has been destroyed'));
        return;
      }

      this.socket = net.createConnection({ host: this.host, port: this.port });

      const connectionTimeout = setTimeout(() => {
        if (this.socket) {
          this.socket.destroy();
          const err = new Error(`Connection timed out after ${this.connectionTimeoutMs}ms`);
          (err as any).code = 'ETIMEDOUT';
          reject(err);
        }
      }, this.connectionTimeoutMs);

      const onConnect = () => {
        clearTimeout(connectionTimeout);
        this.socket!.removeListener('error', onError);
        this.setupSocketListeners();
        this.currentDelay = this.initialDelayMs; // Reset delay on successful connection

        // Flush any buffered writes
        this.flushWriteBuffer();

        logger.info({ host: this.host, port: this.port }, '[tcp] Connected to TCP server');

        if (this.reconnecting) {
          this.reconnecting = false;
          this.emit('reconnected');
        }

        resolve();
      };

      const onError = (err: Error) => {
        clearTimeout(connectionTimeout);
        this.socket!.removeListener('connect', onConnect);
        this.socket!.destroy();
        this.socket = null;
        reject(err);
      };

      this.socket.once('connect', onConnect);
      this.socket.once('error', onError);
    });
  }

  private setupSocketListeners(): void {
    if (!this.socket) return;

    this.socket.on('data', (data) => {
      this.push(data);
    });

    this.socket.on('close', (hadError) => {
      logger.warn({ host: this.host, port: this.port, hadError }, '[tcp] Connection closed');
      this.handleDisconnect();
    });

    this.socket.on('error', (err) => {
      logger.error({ err, host: this.host, port: this.port }, '[tcp] Socket error');
      // 'close' event will follow, so we don't need to handle reconnect here
    });

    this.socket.on('end', () => {
      logger.info({ host: this.host, port: this.port }, '[tcp] Connection ended by remote');
      // 'close' event will follow
    });
  }

  private handleDisconnect(): void {
    this.socket = null;

    if (this._isDestroyed) {
      return;
    }

    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (this.reconnecting || this._isDestroyed) {
      return;
    }

    this.reconnecting = true;
    this.emit('reconnecting', { delay: this.currentDelay, host: this.host, port: this.port });

    logger.info(
      { host: this.host, port: this.port, delayMs: this.currentDelay },
      '[tcp] Scheduling reconnection attempt',
    );

    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;

      if (this._isDestroyed) {
        return;
      }

      try {
        await this.connect();
      } catch (err) {
        logger.warn(
          { err, host: this.host, port: this.port, nextDelayMs: this.currentDelay },
          '[tcp] Reconnection attempt failed, will retry',
        );

        // Exponential backoff
        this.currentDelay = Math.min(this.currentDelay * 2, this.maxDelayMs);
        this.reconnecting = false;
        this.scheduleReconnect();
      }
    }, this.currentDelay);
  }

  private flushWriteBuffer(): void {
    const buffered = this.writeBuffer.splice(0);
    for (const { chunk, callback } of buffered) {
      this.writeToSocket(chunk, callback);
    }
  }

  private writeToSocket(chunk: Buffer, callback: (error?: Error | null) => void): void {
    if (!this.socket || this.socket.destroyed) {
      // Buffer the write for when we reconnect
      this.writeBuffer.push({ chunk, callback });
      return;
    }

    this.socket.write(chunk, callback);
  }

  // Duplex stream implementation

  _read(_size: number): void {
    // Data is pushed via socket 'data' event in setupSocketListeners
  }

  _write(chunk: Buffer, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
    if (this._isDestroyed) {
      callback(new Error('Socket has been destroyed'));
      return;
    }

    this.writeToSocket(chunk, callback);
  }

  _destroy(error: Error | null, callback: (error?: Error | null) => void): void {
    this._isDestroyed = true;
    this.reconnecting = false;

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.socket) {
      this.socket.destroy();
      this.socket = null;
    }

    // Clear write buffer with error
    const buffered = this.writeBuffer.splice(0);
    for (const { callback: writeCallback } of buffered) {
      writeCallback(error || new Error('Socket destroyed'));
    }

    callback(error);
  }

  /**
   * Check if the socket is currently connected
   */
  get isConnected(): boolean {
    return this.socket !== null && !this.socket.destroyed;
  }

  /**
   * Check if the socket is currently trying to reconnect
   */
  get isReconnecting(): boolean {
    return this.reconnecting;
  }
}

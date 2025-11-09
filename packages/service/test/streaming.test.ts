import { EventEmitter } from 'node:events';
import type { AddressInfo } from 'node:net';
import WebSocket from 'ws';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { SerialReader } from '../src/serial-reader.js';
import { createService, type RunningService, type ServiceConfig } from '../src/server.js';

class FakeSerialReader extends EventEmitter {
  private opened = false;

  async open() {
    this.opened = true;
  }

  async close() {
    this.opened = false;
  }

  isOpen() {
    return this.opened;
  }
}

describe('serial stream broadcasting', () => {
  let service: RunningService;
  let serial: FakeSerialReader;

  beforeEach(async () => {
    serial = new FakeSerialReader();
    const config: ServiceConfig = {
      port: 0,
      baudRate: 9600,
      serialPath: '/dev/mock',
      mqttUrl: undefined,
    };

    service = createService(config, {
      createSerialReader: () => serial as unknown as SerialReader,
    });

    await service.start();
  });

  afterEach(async () => {
    await service.stop();
  });

  it('forwards serial data to websocket clients', async () => {
    const address = service.server.address();
    expect(address && typeof address === 'object').toBe(true);
    const port = (address as AddressInfo).port;

    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);

    await new Promise<void>((resolve, reject) => {
      ws.once('open', resolve);
      ws.once('error', reject);
    });

    const messagePromise = new Promise<string>((resolve) => {
      ws.once('message', (data) => {
        resolve(data.toString());
      });
    });

    serial.emit('data', Buffer.from('hello-serial'));

    const message = await messagePromise;
    expect(message).toBe('hello-serial');

    await new Promise<void>((resolve) => {
      ws.once('close', resolve);
      ws.close();
    });
  });
});

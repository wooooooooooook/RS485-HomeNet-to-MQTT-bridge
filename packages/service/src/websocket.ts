import type { Server as HttpServer } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';

export interface WebSocketBroadcasterOptions {
  path?: string;
}

export class WebSocketBroadcaster {
  private readonly wss: WebSocketServer;

  constructor(server: HttpServer, options: WebSocketBroadcasterOptions = {}) {
    const { path = '/ws' } = options;
    this.wss = new WebSocketServer({ server, path });

    this.wss.on('connection', (socket) => {
      socket.on('error', (error) => {
        console.error('[websocket] client error', error);
      });
    });

    this.wss.on('error', (error) => {
      console.error('[websocket] server error', error);
    });
  }

  broadcast(data: string | Buffer) {
    const payload = Buffer.isBuffer(data) ? data : Buffer.from(data);

    for (const client of this.wss.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(payload);
      }
    }
  }

  close() {
    for (const client of this.wss.clients) {
      try {
        client.terminate();
      } catch (error) {
        console.error('[websocket] terminate error', error);
      }
    }

    this.wss.close();
  }
}

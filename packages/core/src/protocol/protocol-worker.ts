
import { parentPort } from 'node:worker_threads';
import { PacketParser } from './packet-parser.js';
import { PacketDefaults } from './types.js';
import { Buffer } from 'buffer';

if (parentPort) {
  let parser: PacketParser | null = null;

  parentPort.on('message', (message: { type: string; payload: any }) => {
    try {
      if (message.type === 'init') {
        const defaults = message.payload as PacketDefaults;
        parser = new PacketParser(defaults);
        parentPort?.postMessage({ type: 'ready' });
      } else if (message.type === 'chunk') {
        if (!parser) return;

        // workerData로 넘어온 buffer는 Uint8Array일 수 있음
        const chunk = message.payload instanceof Buffer
          ? message.payload
          : Buffer.from(message.payload);

        const packets = parser.parseChunk(chunk);

        if (packets.length > 0) {
          // Send packets back
          parentPort?.postMessage({
            type: 'packets',
            payload: packets
          });
        }
      }
    } catch (error) {
      parentPort?.postMessage({
        type: 'error',
        payload: {
          message: error instanceof Error ? error.message : String(error),
          chunk: message.type === 'chunk' ? message.payload : undefined
        }
      });
    }
  });
}

import { createSimulator, DEFAULT_PACKETS } from '../src/index';
import { constants as fsConstants, promises as fsPromises } from 'node:fs';
import { describe, expect, it } from 'vitest';

async function readBytes(filePath: string, length: number, timeoutMs = 5_000): Promise<Buffer> {
  const handle = await fsPromises.open(filePath, fsConstants.O_RDONLY);

  try {
    const stream = handle.createReadStream({ encoding: null });
    const chunks: Buffer[] = [];

    return await new Promise<Buffer>((resolve, reject) => {
      const timeout = setTimeout(() => {
        stream.destroy(new Error('데이터를 제시간에 수신하지 못했습니다.'));
      }, timeoutMs);

      stream.on('data', (chunk: Buffer) => {
        chunks.push(chunk);
        const combined = Buffer.concat(chunks);
        if (combined.length >= length) {
          clearTimeout(timeout);
          stream.destroy();
          resolve(combined.subarray(0, length));
        }
      });

      stream.on('error', (error) => {
        clearTimeout(timeout);
        reject(error);
      });
    });
  } finally {
    await handle.close();
  }
}

describe('RS485 시뮬레이터 PTY', () => {
  it('생성된 PTY에서 패킷이 흘러나온다', async () => {
    const simulator = createSimulator({ intervalMs: 50 });
    expect(simulator.ptyPath).toBeTruthy();

    try {
      const expected = DEFAULT_PACKETS[0];
      const sampleLength = DEFAULT_PACKETS[0].length + DEFAULT_PACKETS[1].length;
      const readTask = readBytes(simulator.ptyPath, sampleLength);

      simulator.start();

      const received = await readTask;
      expect(received.indexOf(expected)).toBeGreaterThanOrEqual(0);
    } finally {
      simulator.dispose();
    }
  });
});

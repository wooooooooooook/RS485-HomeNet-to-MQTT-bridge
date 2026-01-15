import { describe, it, expect } from 'vitest';
import { PacketParser } from '../../src/protocol/packet-parser.js';
import { Buffer } from 'buffer';

describe('PacketParser Fixed Length Optimization Performance', () => {
  it('measures performance of fixed length scanning (Noisy)', () => {
    // Protocol with Fixed Length 10, Add Checksum
    const len = 10;
    const parser = new PacketParser({
      rx_length: len,
      rx_checksum: 'add',
    });

    // Create a buffer that fits in MAX_BUFFER_SIZE (16384)
    const size = 10000;
    const buf = Buffer.alloc(size);

    // Fill with noise
    for (let i = 0; i < size; i++) {
      buf[i] = i % 256;
    }

    // Insert valid packets every 50 bytes.
    // This means 40 invalid positions (checksum calc) for every 1 valid packet.
    // 10000 / 50 = 200 packets.
    let packetCount = 0;
    for (let i = 0; i < size - len; i += 50) {
      // Create valid packet at i
      let sum = 0;
      // Header/Data
      for (let j = 0; j < len - 1; j++) {
        sum += buf[i + j];
      }
      buf[i + len - 1] = sum & 0xff;
      packetCount++;
    }

    const start = process.hrtime.bigint();
    const packets = parser.parseChunk(buf);
    const end = process.hrtime.bigint();

    const elapsedMs = Number(end - start) / 1e6;
    console.log(`[Noisy] Parsed ${packets.length} packets in ${elapsedMs.toFixed(2)} ms from ${size} bytes`);

    expect(packets.length).toBe(packetCount);
  });

  it('measures performance of fixed length scanning (Clean)', () => {
    // Protocol with Fixed Length 10, Add Checksum
    const len = 10;
    const parser = new PacketParser({
      rx_length: len,
      rx_checksum: 'add',
    });

    // Create a buffer that fits in MAX_BUFFER_SIZE (16384)
    const size = 10000;
    const buf = Buffer.alloc(size);

    // Fill with perfectly contiguous packets
    let packetCount = 0;
    for (let i = 0; i <= size - len; i += len) {
      // Create valid packet at i
      let sum = 0;
      // Header/Data
      for (let j = 0; j < len - 1; j++) {
        buf[i + j] = (i + j) % 256;
        sum += buf[i + j];
      }
      buf[i + len - 1] = sum & 0xff;
      packetCount++;
    }

    const start = process.hrtime.bigint();
    const packets = parser.parseChunk(buf);
    const end = process.hrtime.bigint();

    const elapsedMs = Number(end - start) / 1e6;
    console.log(`[Clean] Parsed ${packets.length} packets in ${elapsedMs.toFixed(2)} ms from ${size} bytes`);

    expect(packets.length).toBe(packetCount);
  });
});

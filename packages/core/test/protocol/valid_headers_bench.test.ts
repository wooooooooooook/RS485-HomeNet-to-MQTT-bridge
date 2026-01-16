import { describe, it, expect } from 'vitest';
import { PacketParser } from '../../src/protocol/packet-parser.js';
import { Buffer } from 'buffer';

describe('PacketParser Valid Headers Optimization Performance', () => {
  it('measures performance of fixed length scanning with valid headers (Noisy)', () => {
    // Protocol with Fixed Length 10, Add Checksum, Valid Header 0xAA
    const len = 10;
    const parser = new PacketParser({
      rx_length: len,
      rx_checksum: 'add',
      rx_valid_headers: [0xAA]
    });

    const size = 10000;
    const buf = Buffer.alloc(size);

    // Fill with noise (random bytes, NO 0xAA)
    for (let i = 0; i < size; i++) {
      buf[i] = (i % 100) + 1; // 1..100. Never 0xAA (170).
    }

    // Insert valid packets every 100 bytes
    let packetCount = 0;
    for (let i = 0; i < size - len; i += 100) {
      buf[i] = 0xAA; // Valid Header
      let sum = 0xAA;
      for (let j = 1; j < len - 1; j++) {
        sum += buf[i + j];
      }
      buf[i + len - 1] = sum & 0xff;
      packetCount++;
    }

    const start = process.hrtime.bigint();
    const packets = parser.parseChunk(buf);
    const end = process.hrtime.bigint();

    const elapsedMs = Number(end - start) / 1e6;
    console.log(`[Fixed+ValidHeader] Parsed ${packets.length} packets in ${elapsedMs.toFixed(2)} ms from ${size} bytes`);

    expect(packets.length).toBe(packetCount);
  });

  it('measures performance of footer delimited scanning with valid headers (Noisy)', () => {
    // Protocol with Footer 0xFF, Add Checksum, Valid Header 0xAA
    const parser = new PacketParser({
      rx_footer: [0xFF],
      rx_checksum: 'add',
      rx_valid_headers: [0xAA]
    });

    const size = 10000;
    const buf = Buffer.alloc(size);

    // Fill with noise (NO 0xAA, NO 0xFF)
    for (let i = 0; i < size; i++) {
      buf[i] = (i % 100) + 1; // 1..100.
    }

    // Insert valid packets every 100 bytes. Length 10.
    const packetLen = 10;
    let packetCount = 0;
    for (let i = 0; i < size - packetLen; i += 100) {
      buf[i] = 0xAA; // Valid Header
      buf[i + packetLen - 1] = 0xFF; // Footer

      // Calculate checksum (add, exclude footer)
      // Checksum at i+8. Sum 0..7.
      // header at i.
      let sum = 0;
      for(let k = 0; k < 8; k++) {
         sum += buf[i+k];
      }
      buf[i+8] = sum & 0xff;

      packetCount++;
    }

    const start = process.hrtime.bigint();
    const packets = parser.parseChunk(buf);
    const end = process.hrtime.bigint();

    const elapsedMs = Number(end - start) / 1e6;
    console.log(`[Footer+ValidHeader] Parsed ${packets.length} packets in ${elapsedMs.toFixed(2)} ms from ${size} bytes`);

    expect(packets.length).toBe(packetCount);
  });
});

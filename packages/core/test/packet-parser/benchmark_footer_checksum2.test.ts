import { describe, it, expect } from 'vitest';
import { PacketParser } from '../../src/protocol/packet-parser';
import { PacketDefaults } from '../../src/protocol/types';
import { Buffer } from 'buffer';

describe('PacketParser Performance Benchmark', () => {
  it('measures checksum allocation overhead with rx_footer and rx_checksum2', () => {
    const defaults: PacketDefaults = {
      rx_header: [0x02],
      rx_footer: [0x0d],
      rx_checksum2: 'xor_add',
    };
    const parser = new PacketParser(defaults);

    // Chunk size 4KB, well within 16KB limit.
    const chunkSize = 4096;
    const buffer = Buffer.alloc(chunkSize);
    buffer[0] = 0x02; // Header at start

    // Fill with 0x0D (footer)
    for (let i = 1; i < chunkSize; i++) {
      buffer[i] = 0x0d;
    }

    const iterations = 500;
    const start = performance.now();

    for (let i = 0; i < iterations; i++) {
      // We recreate parser each time or reset it to ensure we parse the same data
      // starting from state 0 (header search)
      // Actually, parseChunk keeps state.
      // If we feed the same buffer again, it appends.
      // But since we consumed the previous buffer (or discarded it),
      // let's force a reset by creating a new parser or just relying on it finding no match and clearing.
      // Wait, if it finds no match, it might keep waiting for footer.
      // But we provided footers!
      // It will find footer at index 1. Check checksum. Fail.
      // Find footer at index 2. Check checksum. Fail.
      // ...
      // It will scan the whole 4KB.
      // After scanning, it might discard data if buffer full.

      // To be consistent, let's instantiate parser inside loop or reset it manually?
      // PacketParser doesn't have public reset.
      // But if we pass the buffer, it will append.
      // Eventually buffer fills up and resets.

      // Let's make a new parser every time to measure PURE parsing speed of one chunk
      // without buffer management overhead noise, OR just keep feeding it.
      // Creating parser is cheap.
      const p = new PacketParser(defaults);
      p.parseChunk(buffer);
    }

    const end = performance.now();
    const duration = end - start;

    console.log(
      `Benchmark Duration: ${duration.toFixed(2)}ms for ${iterations} iterations of ${chunkSize} bytes`,
    );

    expect(duration).toBeGreaterThan(0);
  });
});

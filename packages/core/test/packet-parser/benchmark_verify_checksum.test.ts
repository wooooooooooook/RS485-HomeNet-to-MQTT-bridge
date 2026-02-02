import { describe, it, expect } from 'vitest';
import { PacketParser } from '../../src/protocol/packet-parser';
import { PacketDefaults } from '../../src/protocol/types';
import { Buffer } from 'buffer';

describe('PacketParser Verify Checksum Benchmark', () => {
  it('measures verifyChecksum overhead in sparse scan mode', () => {
    const defaults: PacketDefaults = {
      rx_header: [0x02],
      rx_valid_headers: [0x02], // Trigger sparse scan (no sliding window)
      rx_length: 10,
      rx_checksum: 'add',
    };
    const parser = new PacketParser(defaults);

    // Chunk size 16KB
    const chunkSize = 16384;
    const buffer = Buffer.alloc(chunkSize);

    // Fill with 0x02 so every byte is a candidate start, triggering verifyChecksum
    buffer.fill(0x02);

    const iterations = 200;
    const start = performance.now();

    for (let i = 0; i < iterations; i++) {
      // Re-instantiate to avoid buffer state accumulating excessively or just create a fresh parser
      // We want to measure the parsing loop, not instantiation.
      // Instantiation is cheap compared to parsing 16KB byte-by-byte.
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

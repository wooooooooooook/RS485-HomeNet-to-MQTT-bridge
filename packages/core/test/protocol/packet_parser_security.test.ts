import { describe, it, expect } from 'vitest';
import { PacketParser } from '../../src/protocol/packet-parser';
import { PacketDefaults } from '../../src/protocol/types';
import { Buffer } from 'buffer';

describe('PacketParser Security & Performance', () => {
  it('should not choke on large garbage data (Strategy C)', () => {
    const defaults: PacketDefaults = {
      rx_header: [0xaa],
      rx_checksum: 'xor',
      // No rx_length, no rx_footer -> Strategy C
    };

    const parser = new PacketParser(defaults);

    const chunkSize = 1000;
    const totalSize = 50 * 1000;

    const start = Date.now();

    for (let i = 0; i < totalSize; i += chunkSize) {
      const chunk = Buffer.alloc(chunkSize, 0xbb);
      // Inject headers to trigger checksum checks
      for (let j = 0; j < chunkSize; j += 10) {
        chunk[j] = 0xaa;
      }

      parser.parseChunk(chunk);
    }

    const duration = Date.now() - start;

    const bufferSize = (parser as any).buffer.length;
    // Should be capped at 16384
    expect(bufferSize).toBeLessThanOrEqual(16384);
  });

  it('should limit buffer size to prevent OOM', () => {
    const defaults: PacketDefaults = {
      rx_header: [0xaa],
      rx_checksum: 'xor',
    };
    const parser = new PacketParser(defaults);

    // Feed 100KB of garbage (larger than 16KB limit)
    const chunk = Buffer.alloc(100 * 1024, 0xff);
    parser.parseChunk(chunk);

    const bufferSize = (parser as any).buffer.length;
    expect(bufferSize).toBeLessThanOrEqual(16384);
  });
});

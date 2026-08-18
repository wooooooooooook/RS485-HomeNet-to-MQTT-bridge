import { describe, expect, it } from 'vitest';
import { PacketParser } from '../../src/protocol/packet-parser';

describe('PacketParser xor_final checksum', () => {
  it('parses a fixed-length frame using xor_final(0x55)', () => {
    const parser = new PacketParser({
      rx_header: [0xaa],
      rx_length: 4,
      rx_checksum: 'xor_final(0x55)',
    });

    // 0xAA ^ 0x01 ^ 0x02 ^ 0x55 = 0xFC
    const packet = Buffer.from([0xaa, 0x01, 0x02, 0xfc]);
    expect(parser.parseChunk(packet)).toEqual([packet]);
  });

  it('rejects a frame with an incorrect xor_final checksum', () => {
    const parser = new PacketParser({
      rx_header: [0xaa],
      rx_length: 4,
      rx_checksum: 'xor_final(0x55)',
    });

    const packet = Buffer.from([0xaa, 0x01, 0x02, 0xfd]);
    expect(parser.parseChunk(packet)).toHaveLength(0);
  });

  it('parses a fixed-length frame using xor_final_no_header(0x55)', () => {
    const parser = new PacketParser({
      rx_header: [0xaa],
      rx_length: 4,
      rx_checksum: 'xor_final_no_header(0x55)',
    });

    // 0x01 ^ 0x02 ^ 0x55 = 0x56; header 0xAA is excluded.
    const packet = Buffer.from([0xaa, 0x01, 0x02, 0x56]);
    expect(parser.parseChunk(packet)).toEqual([packet]);
  });

  it('rejects a frame with an incorrect xor_final_no_header checksum', () => {
    const parser = new PacketParser({
      rx_header: [0xaa],
      rx_length: 4,
      rx_checksum: 'xor_final_no_header(0x55)',
    });

    const packet = Buffer.from([0xaa, 0x01, 0x02, 0x57]);
    expect(parser.parseChunk(packet)).toHaveLength(0);
  });
});

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

  it('correctly handles sliding-window shifts with noise and multiple offsets', () => {
    const parser = new PacketParser({
      rx_header: [0xaa],
      rx_length: 4,
      rx_checksum: 'xor_final(0x55)',
    });

    // Packet 1: AA 01 02 FC
    // Packet 2: AA 03 04 F8 (AA ^ 03 ^ 04 ^ 55 = F8)
    // Stream with noise: [0x12, 0x34, 0xAA, 0x01, 0x02, 0xFC, 0x99, 0xAA, 0x03, 0x04, 0xF8]
    const chunk = Buffer.from([0x12, 0x34, 0xaa, 0x01, 0x02, 0xfc, 0x99, 0xaa, 0x03, 0x04, 0xf8]);

    const result = parser.parseChunk(chunk);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual(Buffer.from([0xaa, 0x01, 0x02, 0xfc]));
    expect(result[1]).toEqual(Buffer.from([0xaa, 0x03, 0x04, 0xf8]));
  });

  it('correctly handles sliding-window shifts with xor_final_no_header and noise', () => {
    const parser = new PacketParser({
      rx_header: [0xaa],
      rx_length: 4,
      rx_checksum: 'xor_final_no_header(0x55)',
    });

    // Packet 1: AA 01 02 56 (01 ^ 02 ^ 55 = 56)
    // Packet 2: AA 03 04 52 (03 ^ 04 ^ 55 = 52)
    // Stream with noise: [0xFE, 0xAA, 0x01, 0x02, 0x56, 0xAA, 0x03, 0x04, 0x52]
    const chunk = Buffer.from([0xfe, 0xaa, 0x01, 0x02, 0x56, 0xaa, 0x03, 0x04, 0x52]);

    const result = parser.parseChunk(chunk);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual(Buffer.from([0xaa, 0x01, 0x02, 0x56]));
    expect(result[1]).toEqual(Buffer.from([0xaa, 0x03, 0x04, 0x52]));
  });

  it('parses footer-delimited frames with xor_final(0x55)', () => {
    const parser = new PacketParser({
      rx_header: [0xaa],
      rx_footer: [0x0d, 0x0a],
      rx_checksum: 'xor_final(0x55)',
    });

    // Packet: AA 01 02 FC 0D 0A
    // Checksum byte is FC (AA ^ 01 ^ 02 ^ 55 = FC)
    const packet = Buffer.from([0xaa, 0x01, 0x02, 0xfc, 0x0d, 0x0a]);
    expect(parser.parseChunk(packet)).toEqual([packet]);
  });

  it('parses variable-length / rx_length_expr frames with xor_final(0x55)', () => {
    const parser = new PacketParser({
      rx_header: [0xaa],
      rx_length_expr: '5',
      rx_checksum: 'xor_final(0x55)',
    });

    // Length = 5: AA 01 02 03 FF (AA ^ 01 ^ 02 ^ 03 ^ 55 = FF)
    const packet = Buffer.from([0xaa, 0x01, 0x02, 0x03, 0xff]);
    expect(parser.parseChunk(packet)).toEqual([packet]);
  });
});

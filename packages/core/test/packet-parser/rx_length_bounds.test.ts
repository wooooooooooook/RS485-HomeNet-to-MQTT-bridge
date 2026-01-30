import { describe, it, expect } from 'vitest';
import { PacketParser } from '../../src/protocol/packet-parser';
import { PacketDefaults } from '../../src/protocol/types';

describe('PacketParser with rx_min_length and rx_max_length', () => {
  it('should ignore packets shorter than rx_min_length', () => {
    const defaults: PacketDefaults = {
      rx_header: [0x02],
      rx_checksum: 'add',
      rx_footer: [0x0d],
      rx_min_length: 6,
    };
    const parser = new PacketParser(defaults);

    // Packet length 4 (should be ignored)
    const shortPacket = Buffer.from([0x02, 0x10, 0x12, 0x0d]);
    // Valid packet length 6 (should be accepted)
    const validPacket = Buffer.from([0x02, 0x11, 0x22, 0x33, 0x68, 0x0d]);

    const result = parser.parseChunk(Buffer.from([...shortPacket, ...validPacket]));
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(validPacket);
  });

  it('should resync when rx_max_length is exceeded without a match', () => {
    const defaults: PacketDefaults = {
      rx_header: [0x02],
      rx_checksum: 'add',
      rx_max_length: 5,
    };
    const parser = new PacketParser(defaults);

    // Packet length 6 (should be ignored due to max length)
    const longPacket = Buffer.from([0x02, 0x10, 0x20, 0x30, 0x40, 0xa2]);
    // Valid packet length 5 (should be parsed after resync)
    const validPacket = Buffer.from([0x02, 0x11, 0x22, 0x33, 0x68]);

    const result = parser.parseChunk(Buffer.from([...longPacket, ...validPacket]));
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(validPacket);
  });
});

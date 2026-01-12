import { describe, it, expect } from 'vitest';
import { PacketParser } from '../../src/protocol/packet-parser';
import { PacketDefaults } from '../../src/protocol/types';

// Mock Bestin-like Checksum (Simple Sum for testing)
// In real app, bestin_sum is complex, but for parser logic test, 'add' is enough if configured correctly in defaults
// We will use 'add' checksum to simulate valid packets easily.

describe('PacketParser with rx_length_expr', () => {
  // Scenario 1: Valid length returned from expression
  it('should parse packet using length from rx_length_expr', () => {
    const defaults: PacketDefaults = {
      rx_header: [0x02],
      rx_checksum: 'add', // Simple checksum for test
      // If data[1] is 0x28, length is data[2]
      rx_length_expr: 'data[1] == 0x28 ? data[2] : 0',
    };
    const parser = new PacketParser(defaults);

    // Packet: Header(0x02), ID(0x28), Len(0x05), Data(0x10), Checksum(Sum)
    // Sum = 0x02 + 0x28 + 0x05 + 0x10 = 0x3F
    const packet = Buffer.from([0x02, 0x28, 0x05, 0x10, 0x3f]);

    const result = parser.parseChunk(packet);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(packet);
  });

  // Scenario 2: Expression returns 0 -> Fallback to Checksum Sweep
  it('should fallback to checksum sweep if rx_length_expr returns 0', () => {
    const defaults: PacketDefaults = {
      rx_header: [0x02],
      rx_checksum: 'add',
      // If data[1] is 0x28, length is data[2]. BUT our packet has ID 0x30.
      rx_length_expr: 'data[1] == 0x28 ? data[2] : 0',
    };
    const parser = new PacketParser(defaults);

    // Packet: Header(0x02), ID(0x30), Len(0x05), Data(0x10), Checksum(Sum)
    // Sum = 0x02 + 0x30 + 0x05 + 0x10 = 0x47
    // ID 0x30 doesn't match the condition, so expr returns 0.
    // Parser should sweep and find the packet anyway because checksum is valid.
    const packet = Buffer.from([0x02, 0x30, 0x05, 0x10, 0x47]);

    const result = parser.parseChunk(packet);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(packet);
  });

  // Scenario 3: Wait for more data if buffer is shorter than calculated length
  it('should wait for more data if buffer is insufficient', () => {
    const defaults: PacketDefaults = {
      rx_header: [0x02],
      rx_checksum: 'add',
      rx_length_expr: 'data[1] == 0x28 ? data[2] : 0',
    };
    const parser = new PacketParser(defaults);

    // Packet needs 5 bytes, but we only send 4
    // Header(0x02), ID(0x28), Len(0x05), Data(0x10) ... Missing Checksum
    const partialPacket = Buffer.from([0x02, 0x28, 0x05, 0x10]);

    const result1 = parser.parseChunk(partialPacket);
    expect(result1).toHaveLength(0); // Should wait

    // Send the missing byte (Checksum 0x3F)
    const result2 = parser.parseChunk(Buffer.from([0x3f]));
    expect(result2).toHaveLength(1);
    expect(result2[0]).toEqual(Buffer.from([0x02, 0x28, 0x05, 0x10, 0x3f]));
  });

  // Scenario 4: rx_length overrides rx_length_expr (with warning in logs)
  it('should prioritize rx_length over rx_length_expr', () => {
    const defaults: PacketDefaults = {
      rx_header: [0x02],
      rx_checksum: 'add',
      rx_length: 5, // Fixed length 5
      rx_length_expr: 'data[1] == 0x28 ? 100 : 0', // This would fail if used (100 bytes)
    };
    const parser = new PacketParser(defaults);

    // Packet length 5
    const packet = Buffer.from([0x02, 0x28, 0x05, 0x10, 0x3f]);

    const result = parser.parseChunk(packet);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(packet);
  });
});

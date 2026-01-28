import { describe, it, expect, vi } from 'vitest';
import { calculateChecksum2, verifyChecksum2FromBuffer } from '../src/protocol/utils/checksum';
import { PacketParser } from '../src/protocol/packet-parser';
import { CommandGenerator } from '../src/protocol/generators/command.generator';

describe('2-Byte Checksum', () => {
  it('should calculate xor_add checksum correctly', () => {
    // Example packet: 0xF7 0x0e 0x11 0x81 0x00 0x00 0x01
    // Expected: XOR and ADD of header + data
    const header = Buffer.from([0xf7]);
    const data = Buffer.from([0x0e, 0x11, 0x81, 0x00, 0x00, 0x01]);

    const result = calculateChecksum2(header, data, 'xor_add');

    // Manual calculation:
    // XOR: 0xF7 ^ 0x0e ^ 0x11 ^ 0x81 ^ 0x00 ^ 0x00 ^ 0x01 = 0x68
    // ADD: 0xF7 + 0x0e + 0x11 + 0x81 + 0x00 + 0x00 + 0x01 = 0x198
    // ADD += XOR(0x68): 0x198 + 0x68 = 0x200
    // Result: [XOR(0x68), ADD&0xFF(0x00)]

    expect(result).toHaveLength(2);
    expect(result).toEqual([0x68, 0x00]);
  });

  it('should handle different packet sizes', () => {
    const header = Buffer.from([0xf7]);
    const data = Buffer.from([0x39, 0x1f, 0x81, 0x00, 0x00, 0x10]);

    const result = calculateChecksum2(header, data, 'xor_add');

    // Manual calculation for this packet
    // XOR: 0xF7 ^ 0x39 ^ 0x1f ^ 0x81 ^ 0x00 ^ 0x00 ^ 0x10 = 0x40
    // ADD: 0xF7 + 0x39 + 0x1f + 0x81 + 0x00 + 0x00 + 0x10 = 0x1E0
    // ADD += XOR(0x40): 0x1E0 + 0x40 = 0x220
    // Result: [XOR(0x40), ADD&0xFF(0x20)]

    expect(result).toEqual([0x40, 0x20]);
  });

  describe('verifyChecksum2FromBuffer', () => {
    it('should verify xor_add checksum correctly', () => {
      // Packet: 0xF7 0x0e 0x11 0x81 0x00 0x00 0x01
      // Checksum: [0x68, 0x00]
      const buffer = Buffer.from([0xf7, 0x0e, 0x11, 0x81, 0x00, 0x00, 0x01, 0x68, 0x00]);

      const isValid = verifyChecksum2FromBuffer(
        buffer,
        'xor_add',
        1, // headerLength
        buffer.length - 2, // dataEnd (checksum starts here)
        0, // baseOffset
        0x68, // expectedHigh
        0x00, // expectedLow
      );

      expect(isValid).toBe(true);
    });

    it('should reject invalid xor_add checksum', () => {
      const buffer = Buffer.from([0xf7, 0x0e, 0x11, 0x81, 0x00, 0x00, 0x01, 0x68, 0x01]); // Invalid low byte

      const isValid = verifyChecksum2FromBuffer(
        buffer,
        'xor_add',
        1,
        buffer.length - 2,
        0,
        0x68,
        0x01,
      );

      expect(isValid).toBe(false);
    });

    it('should handle offset and baseOffset correctly', () => {
      // Packet embedded in a larger buffer at index 2
      // FF FF [F7 0e 11 81 00 00 01 68 00]
      const buffer = Buffer.from([
        0xff, 0xff, 0xf7, 0x0e, 0x11, 0x81, 0x00, 0x00, 0x01, 0x68, 0x00,
      ]);

      const baseOffset = 2;
      const packetLen = 9;
      const dataEnd = packetLen - 2;

      const isValid = verifyChecksum2FromBuffer(
        buffer,
        'xor_add',
        1,
        dataEnd,
        baseOffset,
        0x68,
        0x00,
      );

      expect(isValid).toBe(true);
    });
  });

  describe('CEL checksum2 support', () => {
    it('should support CEL expression for rx_checksum2 (simple validation)', () => {
      // Freeze Date.now so the tiny rx_timeout doesn't drop bytes when the scheduler pauses.
      const nowSpy = vi.spyOn(Date, 'now');
      let fakeNow = 0;
      nowSpy.mockImplementation(() => fakeNow++);

      // Simple CEL script: checksum is last 2 bytes, check if they equal 0xAA, 0xBB
      // data passed to CEL excludes checksum bytes
      // Wait, verifyChecksum logic passes 'checksumStart' as 'len', and data slice up to checksumStart.
      // So CEL calculates checksum and returns it (1 or 2 bytes).
      // Let's implement a dummy checksum: return [0xAA, 0xBB]
      const celScript = '[0xAA, 0xBB]';

      const parser = new PacketParser({
        rx_header: [0xf7],
        rx_checksum2: celScript,
        rx_timeout: 10,
      });

      try {
        // Test packet: 0xF7 0x01 0xAA 0xBB
        const bytes = [0xf7, 0x01, 0xaa, 0xbb];

        let result = null;
        for (const byte of bytes) {
          const packet = parser.parse(byte);
          if (packet) {
            result = packet;
          }
        }

        expect(result).toEqual(Buffer.from(bytes));
      } finally {
        nowSpy.mockRestore();
      }
    });

    it('should support CEL expression for tx_checksum2', () => {
      const celScript = '[0xAA, 0xBB]';

      const serial = {
        portId: 'main',
        path: '/dev/ttyUSB0',
        baud_rate: 9600,
        data_bits: 8 as const,
        parity: 'none' as const,
        stop_bits: 1 as const,
      };

      const mockConfig = {
        serial,
        packet_defaults: {
          tx_header: [0xf7],
          tx_checksum2: celScript,
        },
      };

      const mockStateProvider = {
        getLightState: () => undefined,
        getClimateState: () => undefined,
      } as any;

      const generator = new CommandGenerator(mockConfig, mockStateProvider);

      const mockEntity = {
        id: 'test',
        type: 'light',
        name: 'Test',
        command_on: {
          data: [0x01],
        },
      };

      const packet = generator.constructCommandPacket(mockEntity, 'command_on');

      // Expected: 0xF7 0x01 [0xAA 0xBB]
      expect(packet).toEqual([0xf7, 0x01, 0xaa, 0xbb]);
    });
  });
});

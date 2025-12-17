import { describe, it, expect, vi } from 'vitest';
import { calculateChecksum2 } from '../src/protocol/utils/checksum';
import { PacketParser } from '../src/protocol/packet-parser';
import { CommandGenerator } from '../src/protocol/generators/command.generator';
import { LambdaConfig } from '../src/protocol/types';

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

  describe('Lambda checksum2 support', () => {
    it('should support lambda for rx_checksum2', () => {
      // Freeze Date.now so the tiny rx_timeout doesn't drop bytes when the scheduler pauses.
      const nowSpy = vi.spyOn(Date, 'now');
      let fakeNow = 0;
      nowSpy.mockImplementation(() => fakeNow++);

      // Lambda that implements xor_add algorithm
      const lambdaConfig: LambdaConfig = {
        type: 'lambda',
        script: `
          let crc = 0;
          let temp = 0;
          for (let i = 0; i < len; i++) {
            crc += data[i];
            temp ^= data[i];
          }
          crc += temp;
          return [temp & 0xff, crc & 0xff];
        `,
      };

      const parser = new PacketParser({
        rx_header: [0xf7],
        rx_checksum2: lambdaConfig,
        rx_timeout: 10,
      });

      try {
        // Test packet: 0xF7 0x0e 0x11 0x81 0x00 0x00 0x01 [0x68 0x00]
        const bytes = [0xf7, 0x0e, 0x11, 0x81, 0x00, 0x00, 0x01, 0x68, 0x00];

        let result = null;
        for (const byte of bytes) {
          const packet = parser.parse(byte);
          if (packet) {
            result = packet;
          }
        }

        expect(result).toEqual(bytes);
      } finally {
        nowSpy.mockRestore();
      }
    });

    it('should support lambda for tx_checksum2', () => {
      // Lambda that implements xor_add algorithm
      const lambdaConfig: LambdaConfig = {
        type: 'lambda',
        script: `
          let crc = 0;
          let temp = 0;
          for (let i = 0; i < len; i++) {
            crc += data[i];
            temp ^= data[i];
          }
          crc += temp;
          return [temp & 0xff, crc & 0xff];
        `,
      };

      const serial = {
        portId: 'main',
        baud_rate: 9600,
        data_bits: 8 as const,
        parity: 'none' as const,
        stop_bits: 1 as const,
      };

      const mockConfig = {
        serial,
        serials: [serial],
        packet_defaults: {
          tx_header: [0xf7],
          tx_checksum2: lambdaConfig,
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
          cmd: [0x0e, 0x11, 0x81, 0x00, 0x00, 0x01],
        },
      };

      const packet = generator.constructCommandPacket(mockEntity, 'command_on');

      // Expected: 0xF7 0x0e 0x11 0x81 0x00 0x00 0x01 [0x68 0x00]
      expect(packet).toEqual([0xf7, 0x0e, 0x11, 0x81, 0x00, 0x00, 0x01, 0x68, 0x00]);
    });

    it('should handle invalid lambda return values for tx_checksum2', () => {
      // Lambda that returns invalid result (single number instead of array)
      const lambdaConfig: LambdaConfig = {
        type: 'lambda',
        script: 'return 42;',
      };

      const serial = {
        portId: 'main',
        baud_rate: 9600,
        data_bits: 8 as const,
        parity: 'none' as const,
        stop_bits: 1 as const,
      };

      const mockConfig = {
        serial,
        serials: [serial],
        packet_defaults: {
          tx_header: [0xf7],
          tx_checksum2: lambdaConfig,
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
          cmd: [0x01, 0x02],
        },
      };

      const packet = generator.constructCommandPacket(mockEntity, 'command_on');

      // Should fallback to [0, 0] on invalid result
      expect(packet).toEqual([0xf7, 0x01, 0x02, 0x00, 0x00]);
    });
  });
});

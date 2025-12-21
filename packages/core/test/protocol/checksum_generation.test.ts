import { describe, it, expect } from 'vitest';
import { CommandGenerator } from '../../src/protocol/generators/command.generator';
import { HomenetBridgeConfig } from '../../src/config/types';

describe('Command Generator - Checksum Logic', () => {
  const mockStateProvider = {
    getAllStates: () => ({}),
    getEntityState: () => ({}),
  } as any;

  const createConfig = (defaults: any): HomenetBridgeConfig =>
    ({
      homenet_bridge: {
        entity: { type: 'light', id: 'test', name: 'Test' },
      },
      serial: {
        portId: 'test',
        baud_rate: 9600,
        data_bits: 8,
        parity: 'none',
        stop_bits: 1,
      },
      serials: [],
      packet_defaults: defaults,
    }) as unknown as HomenetBridgeConfig;

  const mockEntity = {
    id: 'test',
    type: 'light',
    name: 'Test',
    command_on: { cmd: [0x01] },
  } as any;

  // --- 1-Byte Checksum Tests ---

  it('should generate 1-byte checksum when tx_checksum is set to "add"', () => {
    const config = createConfig({
      tx_header: [0xf7],
      tx_checksum: 'add',
    });
    const generator = new CommandGenerator(config, mockStateProvider);
    const packet = generator.constructCommandPacket(mockEntity, 'command_on');

    // F7 + 01 = F8
    expect(packet).toEqual([0xf7, 0x01, 0xf8]);
  });

  it('should generate 1-byte checksum when tx_checksum is set to "xor"', () => {
    const config = createConfig({
      tx_header: [0xf7],
      tx_checksum: 'xor',
    });
    const generator = new CommandGenerator(config, mockStateProvider);
    const packet = generator.constructCommandPacket(mockEntity, 'command_on');

    // F7 ^ 01 = F6
    expect(packet).toEqual([0xf7, 0x01, 0xf6]);
  });

  it('should use CEL for tx_checksum', () => {
    const config = createConfig({
      tx_header: [0xf7],
      tx_checksum: 'data[0] + 1', // F7 + 1 = F8
    });
    const generator = new CommandGenerator(config, mockStateProvider);
    const packet = generator.constructCommandPacket(mockEntity, 'command_on');

    expect(packet).toEqual([0xf7, 0x01, 0xf8]);
  });

  it('should handle CEL returning non-number for tx_checksum by appending 0', () => {
    const config = createConfig({
      tx_header: [0xf7],
      tx_checksum: '"string"', // Invalid return type
    });
    const generator = new CommandGenerator(config, mockStateProvider);
    const packet = generator.constructCommandPacket(mockEntity, 'command_on');

    // Should log error and append 0
    expect(packet).toEqual([0xf7, 0x01, 0x00]);
  });

  // --- 2-Byte Checksum Tests ---

  it('should generate 2-byte checksum when tx_checksum2 is set to "xor_add"', () => {
    const config = createConfig({
      tx_header: [0xf7],
      tx_checksum2: 'xor_add',
      // tx_checksum is undefined here
    });
    const generator = new CommandGenerator(config, mockStateProvider);
    const packet = generator.constructCommandPacket(mockEntity, 'command_on');

    // XOR: F7 ^ 01 = F6
    // ADD: F7 + 01 = F8
    // ADD final: F8 + F6 = 1EE -> EE
    expect(packet).toEqual([0xf7, 0x01, 0xf6, 0xee]);
  });

  it('should use CEL for tx_checksum2', () => {
    const config = createConfig({
      tx_header: [0xf7],
      tx_checksum2: '[0xAA, 0xBB]',
    });
    const generator = new CommandGenerator(config, mockStateProvider);
    const packet = generator.constructCommandPacket(mockEntity, 'command_on');

    expect(packet).toEqual([0xf7, 0x01, 0xaa, 0xbb]);
  });

  it('should handle CEL returning invalid array for tx_checksum2 by appending [0,0]', () => {
    const config = createConfig({
      tx_header: [0xf7],
      tx_checksum2: '[0xAA]', // Only 1 byte
    });
    const generator = new CommandGenerator(config, mockStateProvider);
    const packet = generator.constructCommandPacket(mockEntity, 'command_on');

    expect(packet).toEqual([0xf7, 0x01, 0x00, 0x00]);
  });

  // --- Mixed / Fallback Tests ---

  it('should use tx_checksum2 if tx_checksum is "none"', () => {
    const config = createConfig({
      tx_header: [0xf7],
      tx_checksum: 'none',
      tx_checksum2: 'xor_add',
    });
    const generator = new CommandGenerator(config, mockStateProvider);
    const packet = generator.constructCommandPacket(mockEntity, 'command_on');

    expect(packet).toEqual([0xf7, 0x01, 0xf6, 0xee]);
  });

  it('should prioritize tx_checksum over tx_checksum2 if both present and tx_checksum != "none"', () => {
    // This is technically an invalid config per validation rules, but good to test behavior
    const config = createConfig({
      tx_header: [0xf7],
      tx_checksum: 'add',
      tx_checksum2: 'xor_add',
    });
    const generator = new CommandGenerator(config, mockStateProvider);
    const packet = generator.constructCommandPacket(mockEntity, 'command_on');

    // Should use 'add' (1-byte)
    expect(packet).toEqual([0xf7, 0x01, 0xf8]);
  });

  it('should handle unknown tx_checksum type (invalid CEL) gracefully (append 0)', () => {
    // 'unknown_algo' is not in the Set, so it's treated as CEL.
    // CelExecutor catches errors and returns null.
    // CommandGenerator then handles null by appending 0.
    const config = createConfig({
      tx_header: [0xf7],
      tx_checksum: 'unknown_algo',
    });
    const generator = new CommandGenerator(config, mockStateProvider);

    const packet = generator.constructCommandPacket(mockEntity, 'command_on');

    expect(packet).toEqual([0xf7, 0x01, 0x00]);
  });
});

import { describe, it, expect } from 'vitest';
import { GenericDevice } from '../../src/protocol/devices/generic.device.js';
import { ProtocolConfig } from '../../src/protocol/types.js';

describe('Device - Checksum Logic', () => {
  const mockEntity = {
    id: 'test',
    type: 'light',
    name: 'Test',
    command_on: { data: [0x01] },
  } as any;

  const createDevice = (defaults: any) => {
    const protocolConfig: ProtocolConfig = {
      packet_defaults: defaults,
    };
    return new GenericDevice(mockEntity, protocolConfig);
  };

  // --- 1-Byte Checksum Tests ---

  it('should generate 1-byte checksum when tx_checksum is set to "add"', () => {
    const device = createDevice({
      tx_header: [0xf7],
      tx_checksum: 'add',
    });
    const packet = device.constructCommand('on');

    // F7 + 01 = F8
    expect(packet).toEqual([0xf7, 0x01, 0xf8]);
  });

  it('should generate 1-byte checksum when tx_checksum is set to "xor"', () => {
    const device = createDevice({
      tx_header: [0xf7],
      tx_checksum: 'xor',
    });
    const packet = device.constructCommand('on');

    // F7 ^ 01 = F6
    expect(packet).toEqual([0xf7, 0x01, 0xf6]);
  });

  it('should use CEL for tx_checksum', () => {
    const device = createDevice({
      tx_header: [0xf7],
      tx_checksum: 'data[0] + 1', // F7 + 1 = F8
    });
    const packet = device.constructCommand('on');

    expect(packet).toEqual([0xf7, 0x01, 0xf8]);
  });

  it('should handle CEL returning non-number for tx_checksum gracefully', () => {
    const device = createDevice({
      tx_header: [0xf7],
      tx_checksum: '"string"', // Invalid return type
    });
    const packet = device.constructCommand('on');

    // Should skip invalid checksum and return framed packet
    expect(packet).toEqual([0xf7, 0x01]);
  });

  // --- 2-Byte Checksum Tests ---

  it('should generate 2-byte checksum when tx_checksum2 is set to "xor_add"', () => {
    const device = createDevice({
      tx_header: [0xf7],
      tx_checksum2: 'xor_add',
      // tx_checksum is undefined here
    });
    const packet = device.constructCommand('on');

    // XOR: F7 ^ 01 = F6
    // ADD: F7 + 01 = F8
    // ADD final: F8 + F6 = 1EE -> EE
    expect(packet).toEqual([0xf7, 0x01, 0xf6, 0xee]);
  });

  it('should use CEL for tx_checksum2', () => {
    const device = createDevice({
      tx_header: [0xf7],
      tx_checksum2: '[0xAA, 0xBB]',
    });
    const packet = device.constructCommand('on');

    expect(packet).toEqual([0xf7, 0x01, 0xaa, 0xbb]);
  });

  it('should handle CEL returning non-array for tx_checksum2 gracefully', () => {
    const device = createDevice({
      tx_header: [0xf7],
      tx_checksum2: '"invalid"',
    });
    const packet = device.constructCommand('on');

    expect(packet).toEqual([0xf7, 0x01]);
  });

  // --- Mixed / Fallback Tests ---

  it('should use tx_checksum2 if tx_checksum is "none"', () => {
    const device = createDevice({
      tx_header: [0xf7],
      tx_checksum: 'none',
      tx_checksum2: 'xor_add',
    });
    const packet = device.constructCommand('on');

    expect(packet).toEqual([0xf7, 0x01, 0xf6, 0xee]);
  });

  it('should prioritize tx_checksum over tx_checksum2 if both present and tx_checksum != "none"', () => {
    // This is technically an invalid config per validation rules, but good to test behavior
    const device = createDevice({
      tx_header: [0xf7],
      tx_checksum: 'add',
      tx_checksum2: 'xor_add',
    });
    const packet = device.constructCommand('on');

    // Should use 'add' (1-byte)
    expect(packet).toEqual([0xf7, 0x01, 0xf8]);
  });

  it('should handle unknown tx_checksum type (invalid CEL) gracefully', () => {
    const device = createDevice({
      tx_header: [0xf7],
      tx_checksum: 'unknown_algo',
    });
    const packet = device.constructCommand('on');

    expect(packet).toEqual([0xf7, 0x01]);
  });
});

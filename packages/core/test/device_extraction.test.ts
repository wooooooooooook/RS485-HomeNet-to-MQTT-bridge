import { describe, it, expect } from 'vitest';
import { Device } from '../src/protocol/device';
import { StateSchema, StateNumSchema } from '../src/protocol/types';

class TestDevice extends Device {
  public parseData(packet: number[]): Record<string, any> | null {
    return null;
  }
  public constructCommand(commandName: string, value?: any): number[] | null {
    return null;
  }
  public testExtractFromSchema(packet: number[], schema: StateSchema | StateNumSchema): any {
    return this.extractFromSchema(packet, schema);
  }
}

describe('Device.extractFromSchema', () => {
  const device = new TestDevice({ id: 'test', name: 'test' }, {});

  it('should extract simple byte', () => {
    const packet = [0x01, 0x02, 0x03];
    const schema: StateNumSchema = { offset: 1, length: 1 };
    expect(device.testExtractFromSchema(packet, schema)).toBe(0x02);
  });

  it('should extract value with mask', () => {
    // 0xAB = 1010 1011
    // mask 0x0F = 0000 1111
    // result 0x0B = 11
    const packet = [0xab];
    const schema: StateNumSchema = {
      offset: 0,
      mask: 0x0f,
      length: 1,
    };
    expect(device.testExtractFromSchema(packet, schema)).toBe(0x0b);
  });

  it('should support multi-byte extraction (big endian)', () => {
    const packet = [0x01, 0x02];
    const schema: StateNumSchema = { offset: 0, length: 2 };
    expect(device.testExtractFromSchema(packet, schema)).toBe(258);
  });

  it('should support little endian', () => {
    const packet = [0x01, 0x02];
    const schema: StateNumSchema = { offset: 0, length: 2, endian: 'little' };
    expect(device.testExtractFromSchema(packet, schema)).toBe(513);
  });

  it('should handle inverted logic (bitwise NOT masked)', () => {
    // 0x00 inverted -> 0xFF. mask 0x01 -> 0x01
    const packet = [0x00];
    const schema: StateNumSchema = {
      offset: 0,
      mask: 0x01,
      inverted: true,
      length: 1,
    };
    expect(device.testExtractFromSchema(packet, schema)).toBe(1);

    // 0x01 inverted -> 0xFE. mask 0x01 -> 0x00
    const packet2 = [0x01];
    expect(device.testExtractFromSchema(packet2, schema)).toBe(0);
  });

  it('should return null if data mismatch', () => {
    const packet = [0x01];
    const schema: StateNumSchema = {
      offset: 0,
      data: [0x02], // Expect 0x02
      length: 1,
    };
    expect(device.testExtractFromSchema(packet, schema)).toBe(null);
  });

  it('should extract if data matches', () => {
    const packet = [0x02];
    const schema: StateNumSchema = {
      offset: 0,
      data: [0x02],
      length: 1,
    };
    expect(device.testExtractFromSchema(packet, schema)).toBe(2);
  });

  it('should handle signed integer', () => {
    // 0xFF -> -1 (8 bit)
    const packet = [0xff];
    const schema: StateNumSchema = {
      offset: 0,
      length: 1,
      signed: true,
    };
    expect(device.testExtractFromSchema(packet, schema)).toBe(-1);
  });

  it('should handle precision', () => {
    // 123 -> 1.23
    const packet = [123];
    const schema: StateNumSchema = {
      offset: 0,
      length: 1,
      precision: 2,
    };
    expect(device.testExtractFromSchema(packet, schema)).toBe(1.23);
  });

  it('should handle mapping', () => {
    const packet = [0x01];
    const schema: StateNumSchema = {
      offset: 0,
      length: 1,
      mapping: { 1: 'ON', 0: 'OFF' },
    };
    expect(device.testExtractFromSchema(packet, schema)).toBe('ON');
  });

  it('should handle BCD decode', () => {
    // 0x12 -> 12
    const packet = [0x12];
    const schema: StateNumSchema = {
      offset: 0,
      length: 1,
      decode: 'bcd',
    };
    expect(device.testExtractFromSchema(packet, schema)).toBe(12);
  });

  it('should handle ASCII decode', () => {
    // 0x41 -> 'A'
    const packet = [0x41];
    const schema: StateNumSchema = {
      offset: 0,
      length: 1,
      decode: 'ascii',
    };
    expect(device.testExtractFromSchema(packet, schema)).toBe('A');
  });
});

import { describe, it, expect } from 'vitest';
import { CelExecutor } from '../src/protocol/cel-executor.js';

describe('CelExecutor', () => {
  const executor = new CelExecutor();

  it('should evaluate simple arithmetic', () => {
    const result = executor.execute('1 + 2', {});
    expect(result).toBe(3);
  });

  it('should evaluate expression with input x', () => {
    // x is passed as BigInt internally, but input can be number
    const result = executor.execute('x * 2', { x: 10 });
    expect(result).toBe(20);
  });

  it('should evaluate expression with packet data', () => {
    // data[1] == 0x02 ? "Auto" : ...
    const packet = [0xf0, 0x02, 0x00];
    const script = 'data[1] == 0x02 ? "Auto" : "Manual"';
    const result = executor.execute(script, { data: packet });
    expect(result).toBe('Auto');
  });

  it('should handle bcd_to_int helper', () => {
    // bcd_to_int(0x12) -> 12
    const result = executor.execute('bcd_to_int(0x12)', {});
    expect(result).toBe(12);
  });

  it('should handle int_to_bcd helper', () => {
    // int_to_bcd(12) -> 0x12 (18)
    const result = executor.execute('int_to_bcd(12)', {});
    expect(result).toBe(0x12);
  });

  it('should handle array return values', () => {
    const script = '[[0x04, int_to_bcd(x)], [0x84, 0x00]]';
    const result = executor.execute(script, { x: 12 });
    expect(result).toEqual([
      [0x04, 0x12],
      [0x84, 0x00],
    ]);
  });

  it('should handle bitwise operations (custom functions)', () => {
    // bitAnd(0x0F, 0x03) -> 0x03
    expect(executor.execute('bitAnd(15, 3)', {})).toBe(3);
    // bitOr(0x01, 0x02) -> 0x03
    expect(executor.execute('bitOr(1, 2)', {})).toBe(3);
    // bitShiftLeft(1, 2) -> 4
    expect(executor.execute('bitShiftLeft(1, 2)', {})).toBe(4);
  });

  it('should handle len helper for list and string', () => {
    expect(executor.execute('len(data)', { data: [1, 2, 3] })).toBe(3);
    expect(executor.execute('len("abc")', {})).toBe(3);
  });

  it('should handle state value calculation (Commax example)', () => {
    // double((bcd_to_int(data[4]) * 10000) + (bcd_to_int(data[5]) * 100) + bcd_to_int(data[6])) * 0.1
    // data: [..., ..., ..., ..., 0x12, 0x34, 0x56] -> 12345.6
    const data = [0, 0, 0, 0, 0x12, 0x34, 0x56];
    const script =
      'double((bcd_to_int(data[4]) * 10000) + (bcd_to_int(data[5]) * 100) + bcd_to_int(data[6])) * 0.1';

    // In JS: (12*10000 + 34*100 + 56) * 0.1 = 12345.6
    const result = executor.execute(script, { data });
    expect(result).toBeCloseTo(12345.6);
  });

  it('should handle missing x gracefully', () => {
    // Should default to 0
    const result = executor.execute('x', {});
    expect(result).toBe(0);
  });

  it('should handle string x value for custom mode comparison', () => {
    const script = 'xstr == "Turbo" ? [0x20, 0x11, 0x03] : [0x00]';
    const result = executor.execute(script, { x: 'Turbo' });
    expect(result).toEqual([0x20, 0x11, 0x03]);
  });

  it('should return alternative array when string x does not match', () => {
    const script = 'xstr == "Turbo" ? [0x20, 0x11, 0x03] : [0x20, 0x11, 0x01]';
    const result = executor.execute(script, { x: 'Sleep' });
    expect(result).toEqual([0x20, 0x11, 0x01]);
  });
});

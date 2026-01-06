import { describe, it, expect } from 'vitest';
import { CelExecutor } from '../../src/protocol/cel-executor';

describe('CelExecutor - Bitwise Operations', () => {
  const executor = new CelExecutor();

  it('should perform bitwise AND correctly', () => {
    // 0x0F & 0x03 = 0x03
    const res = executor.execute('bitAnd(15, 3)', {});
    expect(res).toBe(3);
  });

  it('should perform bitwise OR correctly', () => {
    // 0x01 | 0x02 = 0x03
    const res = executor.execute('bitOr(1, 2)', {});
    expect(res).toBe(3);
  });

  it('should perform bitwise XOR correctly', () => {
    // 0x03 ^ 0x01 = 0x02
    const res = executor.execute('bitXor(3, 1)', {});
    expect(res).toBe(2);
  });

  it('should perform bitwise NOT correctly for small numbers', () => {
    // ~1 = -2
    const res = executor.execute('bitNot(1)', {});
    expect(res).toBe(-2);
  });

  it('should perform bitwise Left Shift correctly', () => {
    // 1 << 2 = 4
    const res = executor.execute('bitShiftLeft(1, 2)', {});
    expect(res).toBe(4);
  });

  it('should perform bitwise Right Shift correctly', () => {
    // 4 >> 2 = 1
    const res = executor.execute('bitShiftRight(4, 2)', {});
    expect(res).toBe(1);
  });

  // Large Integer Tests (Where the optimization also fixes bugs)

  it('should preserve precision for large integer bitwise AND', () => {
    // 2^32 (4294967296) & 2^32 = 2^32
    // If using Number() (32-bit ops), this becomes 0 & 0 = 0
    // 0x100000000 & 0x100000000
    const res = executor.execute('bitAnd(4294967296, 4294967296)', {});
    // Expect correct BigInt behavior
    expect(res).toBe(4294967296);
  });

  it('should preserve precision for large integer bitwise OR', () => {
    // 2^32 | 1 = 4294967297
    // If using Number(), 0 | 1 = 1
    const res = executor.execute('bitOr(4294967296, 1)', {});
    expect(res).toBe(4294967297);
  });
});

import { describe, it, expect } from 'vitest';
import { LambdaExecutor } from '../src/protocol/lambda-executor.js';
import { LambdaConfig } from '../src/protocol/types.js';

describe('LambdaExecutor', () => {
    const executor = new LambdaExecutor();

    it('should execute simple math', () => {
        const lambda: LambdaConfig = {
            type: 'lambda',
            script: 'return x * 2;'
        };
        const result = executor.execute(lambda, { x: 5 });
        expect(result).toBe(10);
    });

    it('should have access to helper functions (bcd_to_int)', () => {
        const lambda: LambdaConfig = {
            type: 'lambda',
            script: 'return bcd_to_int(x);'
        };
        // 0x12 (BCD) = 12 (Decimal)
        const result = executor.execute(lambda, { x: 0x12 });
        expect(result).toBe(12);
    });

    it('should have access to helper functions (int_to_bcd)', () => {
        const lambda: LambdaConfig = {
            type: 'lambda',
            script: 'return int_to_bcd(x);'
        };
        // 12 (Decimal) = 0x12 (BCD)
        const result = executor.execute(lambda, { x: 12 });
        expect(result).toBe(0x12);
    });

    it('should not have access to process', () => {
        const lambda: LambdaConfig = {
            type: 'lambda',
            script: 'return process.env;'
        };
        const result = executor.execute(lambda, {});
        expect(result).toBeNull(); // Should fail and return null (caught exception)
    });

    it('should timeout on infinite loops', () => {
        const lambda: LambdaConfig = {
            type: 'lambda',
            script: 'while(true) {}'
        };
        const result = executor.execute(lambda, {});
        expect(result).toBeNull(); // Should fail due to timeout
    });
});

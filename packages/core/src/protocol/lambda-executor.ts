import vm from 'node:vm';
import { LambdaConfig } from './types.js';
import { logger } from '../utils/logger.js';

export class LambdaExecutor {
    private context: vm.Context;

    constructor() {
        // Define safe helper functions and constants
        const sandbox = {
            // Helper: Convert BCD to Integer
            bcd_to_int: (bcd: number): number => {
                return (bcd >> 4) * 10 + (bcd & 0x0F);
            },
            // Helper: Convert Integer to BCD
            int_to_bcd: (int: number): number => {
                return ((Math.floor(int / 10) % 10) << 4) | (int % 10);
            },
            // Helper: Log to console (safe wrapper)
            log: (...args: any[]) => {
                // logger.debug({ args }, '[Lambda] Log');
            },
            // Standard Math functions
            Math: Math,
            // Standard Number functions
            Number: Number,
            // Standard Boolean functions
            Boolean: Boolean,
            // Standard String functions
            String: String,
        };

        this.context = vm.createContext(sandbox);
    }

    public execute(lambda: LambdaConfig, contextData: Record<string, any>): any {
        try {
            // Add context data to the sandbox for this execution
            const executionContext = vm.createContext({
                ...this.context,
                ...contextData
            });

            // Wrap script in a function to allow 'return' statements if needed, 
            // or just execute as expression.
            // Uartex examples show 'return ...', so we should wrap it.
            const scriptCode = `
        (function() {
          ${lambda.script}
        })()
      `;

            const script = new vm.Script(scriptCode);

            // Execute with timeout
            const result = script.runInContext(executionContext, {
                timeout: 100, // 100ms timeout
                displayErrors: true
            });

            return result;
        } catch (error) {
            logger.error({ error, script: lambda.script }, '[Lambda] Execution failed');
            return null;
        }
    }
}

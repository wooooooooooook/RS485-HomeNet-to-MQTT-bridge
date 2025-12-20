import { Environment } from '@marcbachmann/cel-js';
import { Buffer } from 'buffer';
import { logger } from '../utils/logger.js';

export class CelExecutor {
  private env: Environment;

  constructor() {
    this.env = new Environment();

    // Register Types
    this.env.registerVariable('x', 'int');
    this.env.registerVariable('data', 'list'); // list(int)
    this.env.registerVariable('state', 'map');
    this.env.registerVariable('states', 'map');

    // Helper: BCD to Int
    this.env.registerFunction('bcd_to_int(int): int', (bcd: bigint) => {
      const val = Number(bcd);
      const res = (val >> 4) * 10 + (val & 0x0f);
      return BigInt(res);
    });

    // Helper: Int to BCD
    this.env.registerFunction('int_to_bcd(int): int', (val: bigint) => {
      const v = Number(val);
      const res = (Math.floor(v / 10) % 10 << 4) | v % 10;
      return BigInt(res);
    });

    // Helper: Bitwise Operations
    this.env.registerFunction('bitAnd(int, int): int', (a: bigint, b: bigint) =>
      BigInt(Number(a) & Number(b)),
    );
    this.env.registerFunction('bitOr(int, int): int', (a: bigint, b: bigint) =>
      BigInt(Number(a) | Number(b)),
    );
    this.env.registerFunction('bitXor(int, int): int', (a: bigint, b: bigint) =>
      BigInt(Number(a) ^ Number(b)),
    );
    this.env.registerFunction('bitNot(int): int', (a: bigint) => BigInt(~Number(a)));
    this.env.registerFunction('bitShiftLeft(int, int): int', (a: bigint, b: bigint) =>
      BigInt(Number(a) << Number(b)),
    );
    this.env.registerFunction('bitShiftRight(int, int): int', (a: bigint, b: bigint) =>
      BigInt(Number(a) >> Number(b)),
    );
  }

  public registerFunction(name: string, impl: (...args: any[]) => any) {
    this.env.registerFunction(name, impl);
  }

  public registerType(name: string, impl: any) {
    this.env.registerType(name, impl);
  }

  public execute(script: string, contextData: Record<string, any>): any {
    try {
      // Pre-process context data: Convert numbers to BigInt for 'x' and 'data'
      const safeContext: Record<string, any> = {};

      if (contextData.x !== undefined && contextData.x !== null) {
        // Ensure integer
        safeContext.x = BigInt(Math.floor(Number(contextData.x)));
      } else {
        safeContext.x = 0n; // Default for when x is not provided (e.g. state parsing)
      }

      if (Array.isArray(contextData.data)) {
        safeContext.data = contextData.data.map((d: any) => BigInt(d));
      } else if (
        Buffer.isBuffer(contextData.data) ||
        contextData.data instanceof Uint8Array
      ) {
        // Optimize: Convert Buffer/Uint8Array to BigInt[] using a loop instead of map
        // to avoid intermediate array allocation and function call overhead.
        const len = contextData.data.length;
        const arr = new Array(len);
        for (let i = 0; i < len; i++) {
          arr[i] = BigInt(contextData.data[i]);
        }
        safeContext.data = arr;
      } else {
        safeContext.data = [];
      }

      if (contextData.state) {
        safeContext.state = contextData.state;
      }

      if (contextData.states) {
        safeContext.states = contextData.states;
      }

      const res = this.env.evaluate(script, safeContext);

      // Post-process result: Convert BigInt back to Number, List to Array
      return this.convertResult(res);
    } catch (error) {
      logger.error({ error, script }, '[CEL] Execution failed');
      return null;
    }
  }

  private convertResult(value: any): any {
    if (typeof value === 'bigint') {
      return Number(value);
    }
    if (Array.isArray(value)) {
      return value.map((v) => this.convertResult(v));
    }
    // Handle plain objects/Maps if necessary, but JSON-compatible is usually enough
    return value;
  }
}

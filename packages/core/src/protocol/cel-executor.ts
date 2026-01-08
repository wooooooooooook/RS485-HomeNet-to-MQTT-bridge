import { Environment, ParseResult } from '@marcbachmann/cel-js';
import { Buffer } from 'buffer';
import { logger } from '../utils/logger.js';

/**
 * Interface for a prepared script that can be executed directly without Map lookups.
 */
export interface CompiledScript {
  /**
   * Executes the script with the provided context.
   * Efficiently handles type conversions based on static analysis of the script.
   *
   * @param contextData - The variables to pass to the script
   * @returns The result of the execution
   */
  execute(contextData: Record<string, any>): any;
}

interface ScriptCacheEntry {
  parsed: ParseResult;
  usesData: boolean;
}

/**
 * Executes Common Expression Language (CEL) scripts for protocol logic.
 *
 * This singleton class manages the CEL environment and provides a set of custom
 * helper functions tailored for byte-level protocol manipulation.
 *
 * **Available Variables in Context:**
 * - `x` (int): The primary input value (e.g., a candidate byte or current state).
 * - `data` (list<int>): The raw packet data buffer as a list of integers.
 * - `state` (map): The current entity's state object.
 * - `states` (map): The global state map of all entities.
 * - `trigger` (map): Context specific to automation triggers.
 *
 * **Registered Helper Functions:**
 * - `bcd_to_int(int) -> int`: Converts a BCD encoded byte to an integer (e.g., `0x12` -> `12`).
 * - `int_to_bcd(int) -> int`: Converts an integer to a BCD encoded byte (e.g., `12` -> `0x12`).
 * - `bitAnd(int, int) -> int`: Bitwise AND (`&`).
 * - `bitOr(int, int) -> int`: Bitwise OR (`|`).
 * - `bitXor(int, int) -> int`: Bitwise XOR (`^`).
 * - `bitNot(int) -> int`: Bitwise NOT (`~`).
 * - `bitShiftLeft(int, int) -> int`: Bitwise Left Shift (`<<`).
 * - `bitShiftRight(int, int) -> int`: Bitwise Right Shift (`>>`).
 *
 * @see {@link ../../../docs/CEL_GUIDE.md} for comprehensive usage examples.
 */
export class CelExecutor {
  private static sharedInstance?: CelExecutor;
  private env: Environment;
  // Cache for parsed scripts to avoid expensive re-parsing
  private scriptCache: Map<string, ScriptCacheEntry> = new Map();
  private readonly MAX_CACHE_SIZE = 1000;

  // Pre-allocate BigInts for bytes 0-255 to avoid constructor overhead in hot paths
  private readonly BIGINT_CACHE: bigint[] = new Array(256).fill(0).map((_, i) => BigInt(i));

  public static shared(): CelExecutor {
    if (!CelExecutor.sharedInstance) {
      CelExecutor.sharedInstance = new CelExecutor();
    }
    return CelExecutor.sharedInstance;
  }

  constructor() {
    this.env = new Environment();

    // Register Types
    this.env.registerVariable('x', 'int');
    this.env.registerVariable('xstr', 'string'); // String input for custom modes
    this.env.registerVariable('data', 'list'); // list(int)
    this.env.registerVariable('state', 'map');
    this.env.registerVariable('states', 'map');
    this.env.registerVariable('trigger', 'map');
    this.env.registerVariable('args', 'map');

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
    this.env.registerFunction('bitAnd(int, int): int', (a: bigint, b: bigint) => a & b);
    this.env.registerFunction('bitOr(int, int): int', (a: bigint, b: bigint) => a | b);
    this.env.registerFunction('bitXor(int, int): int', (a: bigint, b: bigint) => a ^ b);
    // Double overloads for map values (args, states) which come as double in CEL
    this.env.registerFunction('bitAnd(double, double): int', (a: number, b: number) =>
      BigInt(Math.floor(a) & Math.floor(b)),
    );
    this.env.registerFunction('bitOr(double, double): int', (a: number, b: number) =>
      BigInt(Math.floor(a) | Math.floor(b)),
    );
    this.env.registerFunction('bitXor(double, double): int', (a: number, b: number) =>
      BigInt(Math.floor(a) ^ Math.floor(b)),
    );
    this.env.registerFunction('bitAnd(int, double): int', (a: bigint, b: number) =>
      BigInt(Number(a) & Math.floor(b)),
    );
    this.env.registerFunction('bitOr(int, double): int', (a: bigint, b: number) =>
      BigInt(Number(a) | Math.floor(b)),
    );
    this.env.registerFunction('bitXor(int, double): int', (a: bigint, b: number) =>
      BigInt(Number(a) ^ Math.floor(b)),
    );
    this.env.registerFunction('bitNot(int): int', (a: bigint) => ~a);
    this.env.registerFunction('bitShiftLeft(int, int): int', (a: bigint, b: bigint) => a << b);
    this.env.registerFunction('bitShiftRight(int, int): int', (a: bigint, b: bigint) => a >> b);
  }

  /**
   * Registers a custom function in the CEL environment.
   *
   * @param name - The function signature (e.g., 'myFunc(int): int').
   * @param impl - The implementation of the function.
   */
  public registerFunction(name: string, impl: (...args: any[]) => any) {
    this.env.registerFunction(name, impl);
  }

  /**
   * Prepares a script for repeated execution.
   * Returns a lightweight object that bypasses cache lookups and repeated string scanning.
   *
   * @param script - The CEL expression string.
   * @returns CompiledScript object with an execute method.
   */
  public prepare(script: string): CompiledScript {
    const entry = this.getOrParseScript(script);

    return {
      execute: (contextData: Record<string, any>) => {
        try {
          const safeContext = this.createSafeContext(contextData, entry.usesData);
          const res = entry.parsed(safeContext);
          return this.convertResult(res);
        } catch (error) {
          this.handleError(error, script);
          return null;
        }
      },
    };
  }

  /**
   * Evaluates a CEL script against the provided context.
   *
   * Automatically handles type conversions required by the CEL engine:
   * - `Buffer` or `Uint8Array` in `contextData.data` are converted to `BigInt[]`.
   * - `number` in `contextData.x` is converted to `BigInt`.
   *
   * @param script - The CEL expression string to evaluate.
   * @param contextData - A dictionary of variables to expose to the script.
   * @returns The result of the expression, with BigInts converted back to Numbers.
   */
  public execute(script: string, contextData: Record<string, any>): any {
    const { result } = this.executeWithDiagnostics(script, contextData);
    return result;
  }

  /**
   * Evaluates a CEL script and returns the result with error details if any.
   *
   * @param script - The CEL expression string to evaluate.
   * @param contextData - A dictionary of variables to expose to the script.
   * @returns Object containing result and optional error message.
   */
  public executeWithDiagnostics(
    script: string,
    contextData: Record<string, any>,
  ): { result: any; error?: string } {
    try {
      const entry = this.getOrParseScript(script);

      // Pre-process context data: Convert numbers to BigInt for 'x' and 'data'
      const safeContext = this.createSafeContext(contextData, entry.usesData);

      // Execute using cached script function
      const res = entry.parsed(safeContext);

      // Post-process result: Convert BigInt back to Number, List to Array
      return { result: this.convertResult(res) };
    } catch (error) {
      const errorMessage = this.handleError(error, script);
      return { result: null, error: errorMessage };
    }
  }

  private getOrParseScript(script: string): ScriptCacheEntry {
    let entry = this.scriptCache.get(script);
    if (!entry) {
      // Prevent unbounded memory growth
      if (this.scriptCache.size >= this.MAX_CACHE_SIZE) {
        this.scriptCache.clear();
      }
      const parsed = this.env.parse(script);
      const usesData = script.includes('data');
      entry = { parsed, usesData };
      this.scriptCache.set(script, entry);
    }
    return entry;
  }

  private createSafeContext(
    contextData: Record<string, any>,
    scriptUsesData: boolean,
  ): Record<string, any> {
    const safeContext: Record<string, any> = {};

    if (contextData.x !== undefined && contextData.x !== null) {
      // If x is a string (e.g., custom mode name), set both x=0 and xstr=value
      // If x is a number, convert to BigInt for CEL and set xstr=''
      if (typeof contextData.x === 'string') {
        safeContext.x = 0n; // CEL needs x to be int
        safeContext.xstr = contextData.x; // String value accessible via xstr
      } else {
        const numValue = Number(contextData.x);
        safeContext.x = Number.isNaN(numValue) ? 0n : BigInt(Math.floor(numValue));
        safeContext.xstr = '';
      }
    } else {
      safeContext.x = 0n; // Default for when x is not provided (e.g. state parsing)
      safeContext.xstr = '';
    }

    if (Array.isArray(contextData.data)) {
      safeContext.data = contextData.data.map((d: any) => BigInt(d));
    } else if (Buffer.isBuffer(contextData.data) || contextData.data instanceof Uint8Array) {
      if (scriptUsesData) {
        // Optimize: Convert Buffer/Uint8Array to BigInt[] using a loop instead of map
        // to avoid intermediate array allocation and function call overhead.
        const len = contextData.data.length;
        const arr = new Array(len);
        for (let i = 0; i < len; i++) {
          // Use cached BigInts for byte values (0-255) to avoid constructor overhead
          arr[i] = this.BIGINT_CACHE[contextData.data[i]];
        }
        safeContext.data = arr;
      } else {
        // If script doesn't use data, provide empty array to satisfy type requirements
        // without paying the conversion cost.
        safeContext.data = [];
      }
    } else {
      safeContext.data = [];
    }

    // Always provide state (default to empty object for safe access in CEL)
    safeContext.state = contextData.state || {};

    if (contextData.states) {
      safeContext.states = contextData.states;
    } else {
      safeContext.states = {};
    }

    if (contextData.trigger) {
      safeContext.trigger = contextData.trigger;
    }

    if (contextData.args) {
      safeContext.args = contextData.args;
    } else {
      safeContext.args = {};
    }

    return safeContext;
  }

  private handleError(error: unknown, script: string): string {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : undefined;
    logger.error({ error: errorMessage, stack: errorStack, script }, '[CEL] Execution failed');
    return errorMessage;
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

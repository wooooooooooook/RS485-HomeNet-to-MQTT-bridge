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

  /**
   * Executes the script with a raw, pre-prepared context.
   * Skips safe context creation (e.g., BigInt conversion) for maximum performance in hot loops.
   * The caller MUST ensure the context contains correct types (e.g., BigInts for numbers).
   *
   * @param contextData - The raw context variables
   * @returns The result of the execution
   */
  executeRaw(contextData: Record<string, any>): any;

  /**
   * Executes the script and returns result with error info if any.
   *
   * @param contextData - The variables to pass to the script
   */
  executeWithDiagnostics(contextData: Record<string, any>): { result: any; error?: string };
}

interface ScriptCacheEntry {
  parsed: ParseResult;
  usesData: boolean;
  usesState: boolean;
  usesStates: boolean;
  usesTrigger: boolean;
  usesArgs: boolean;
  usesLen: boolean;
  usesGetFromState: boolean;
  usesGetFromStates: boolean;
}

/**
 * A reusable view over a buffer that behaves like a List<BigInt> in CEL.
 * This class eliminates the overhead of creating new Proxies and Buffers (subarray)
 * in hot loops by allowing the underlying buffer and window to be updated.
 */
export class ReusableBufferView {
  private buffer: Uint8Array | null = null;
  private offset = 0;
  private length = 0;
  public readonly proxy: any;
  private readonly cache: bigint[];

  constructor(cache: bigint[]) {
    this.cache = cache;
    this.proxy = new Proxy([], {
      get: (target, prop, receiver) => {
        // Handle length/size properties
        if (prop === 'length') {
          return this.length;
        }

        // Fast path for integer indexed access (e.g. data[0])
        if (typeof prop === 'string') {
          const idx = Number(prop);
          // Check against VIRTUAL length
          if (Number.isInteger(idx) && idx >= 0 && idx < this.length) {
            // Map virtual index to physical index in the underlying buffer
            return this.cache[this.buffer![this.offset + idx]];
          }
        }

        // Handle iteration (e.g. for macros like .map(), .exists())
        if (prop === Symbol.iterator) {
          // Capture references to avoid closure allocation if possible,
          // though generator creates one anyway.
          // eslint-disable-next-line @typescript-eslint/no-this-alias
          const self = this;
          return function* () {
            for (let i = 0; i < self.length; i++) {
              yield self.cache[self.buffer![self.offset + i]];
            }
          };
        }

        // Fallback to Reflect for other properties (e.g. toString, etc.)
        return Reflect.get(target, prop, receiver);
      },
    });
  }

  /**
   * Updates the view to point to a new window within a buffer.
   * This method is zero-allocation.
   *
   * @param buffer - The source buffer
   * @param offset - The start offset
   * @param length - The length of the view
   */
  public update(buffer: Uint8Array, offset: number, length: number) {
    this.buffer = buffer;
    this.offset = offset;
    this.length = length;
  }
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
 * **Available Helper Functions:**
 * - `bcd_to_int(int) -> int`: Converts a BCD encoded byte to an integer (e.g., `0x12` -> `12`).
 * - `int_to_bcd(int) -> int`: Converts an integer to a BCD encoded byte (e.g., `12` -> `0x12`).
 * - `bitAnd(int, int) -> int`: Bitwise AND (`&`).
 * - `bitOr(int, int) -> int`: Bitwise OR (`|`).
 * - `bitXor(int, int) -> int`: Bitwise XOR (`^`).
 * - `bitNot(int) -> int`: Bitwise NOT (`~`).
 * - `bitShiftLeft(int, int) -> int`: Bitwise Left Shift (`<<`).
 * - `bitShiftRight(int, int) -> int`: Bitwise Right Shift (`>>`).
 * - `double(value) -> double`: Converts a number to a double (Standard CEL).
 * - `has(expr) -> bool`: Checks if a field exists in a map (Standard CEL macro).
 *
 * @see {@link ../../../docs/CEL_GUIDE.md} for comprehensive usage examples.
 */
export class CelExecutor {
  private static sharedInstance?: CelExecutor;
  private env: Environment;
  // Cache for parsed scripts to avoid expensive re-parsing
  private scriptCache: Map<string, ScriptCacheEntry> = new Map();
  private readonly MAX_CACHE_SIZE = 1000;
  private currentStateContext?: Record<string, any>;
  private currentStatesContext?: Record<string, any>;

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
    this.env.registerVariable('len', 'int');

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
    this.env.registerFunction('get_from_states(string, string): dyn', (entityId: string, key: string) =>
      this.getFromStates(entityId, key),
    );
    this.env.registerFunction(
      'get_from_states(string, string, dyn): dyn',
      (entityId: string, key: string, fallback: any) => {
        const value = this.getFromStates(entityId, key);
        return value === undefined ? fallback : value;
      },
    );
    this.env.registerFunction('get_from_state(string): dyn', (key: string) =>
      this.getFromState(key),
    );
    this.env.registerFunction('get_from_state(string, dyn): dyn', (key: string, fallback: any) => {
      const value = this.getFromState(key);
      return value === undefined ? fallback : value;
    });
  }

  /**
   * Creates a reusable buffer view factory.
   * Consumers can use the returned object to avoid allocations in hot loops.
   */
  public createReusableBufferView(): ReusableBufferView {
    return new ReusableBufferView(this.BIGINT_CACHE);
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
          const safeContext = this.createSafeContext(contextData, entry);
          return this.runWithContext(safeContext, () => {
            const res = entry.parsed(safeContext);
            return this.convertResult(res);
          });
        } catch (error) {
          this.handleError(error, script);
          return null;
        }
      },
      executeRaw: (contextData: Record<string, any>) => {
        try {
          return this.runWithContext(contextData, () => {
            const res = entry.parsed(contextData);
            return this.convertResult(res);
          });
        } catch (error) {
          this.handleError(error, script);
          return null;
        }
      },
      executeWithDiagnostics: (contextData: Record<string, any>) => {
        try {
          const safeContext = this.createSafeContext(contextData, entry);
          return this.runWithContext(safeContext, () => {
            const res = entry.parsed(safeContext);
            return { result: this.convertResult(res) };
          });
        } catch (error) {
          const errorMessage = this.handleError(error, script);
          return { result: null, error: errorMessage };
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
      const safeContext = this.createSafeContext(contextData, entry);

      // Execute using cached script function
      return this.runWithContext(safeContext, () => {
        const res = entry.parsed(safeContext);

        // Post-process result: Convert BigInt back to Number, List to Array
        return { result: this.convertResult(res) };
      });
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
      // Static analysis of script to avoid populating unused context variables
      const usesData = script.includes('data');
      const usesState = script.includes('state'); // Covers 'state' and 'states'
      const usesStates = script.includes('states');
      const usesTrigger = script.includes('trigger');
      const usesArgs = script.includes('args');
      const usesLen = script.includes('len');
      const usesGetFromState = script.includes('get_from_state');
      const usesGetFromStates = script.includes('get_from_states');

      entry = {
        parsed,
        usesData,
        usesState,
        usesStates,
        usesTrigger,
        usesArgs,
        usesLen,
        usesGetFromState,
        usesGetFromStates,
      };
      this.scriptCache.set(script, entry);
    }
    return entry;
  }

  private createSafeContext(
    contextData: Record<string, any>,
    entry: ScriptCacheEntry,
  ): Record<string, any> {
    const safeContext: Record<string, any> = {};

    // Only populate 'x' if provided or required by safe defaults
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
      if (entry.usesData) {
        // Optimization: Use a Proxy to expose Buffer directly as a read-only List<BigInt>
        // This avoids O(N) allocation and copying of BigInt arrays, reducing memory pressure
        // and improving performance significantly in checksum sweeps (O(N^2) paths).
        safeContext.data = this.createBufferProxy(contextData.data);
      } else {
        // If script doesn't use data, provide empty array to satisfy type requirements
        // without paying the conversion cost.
        safeContext.data = [];
      }
    } else {
      // Allow valid custom objects (like ReusableBufferView.proxy) to pass through
      safeContext.data = contextData.data || [];
    }

    // Optimization: Only create objects for complex types if the script actually uses them.
    // This saves 3-4 object allocations per execution in hot paths (like packet parsing).
    if (entry.usesState || entry.usesGetFromState) {
      safeContext.state = contextData.state || {};
    }

    if (entry.usesStates || entry.usesGetFromStates) {
      safeContext.states = contextData.states || {};
    }

    if (entry.usesTrigger && contextData.trigger) {
      safeContext.trigger = contextData.trigger;
    }

    if (entry.usesArgs) {
      safeContext.args = contextData.args || {};
    }

    if (entry.usesLen && typeof contextData.len === 'number') {
      safeContext.len = BigInt(contextData.len);
    }

    return safeContext;
  }

  private runWithContext<T>(contextData: Record<string, any>, action: () => T): T {
    this.currentStateContext = this.normalizeMap(contextData.state);
    this.currentStatesContext = this.normalizeMap(contextData.states);
    try {
      return action();
    } finally {
      this.currentStateContext = undefined;
      this.currentStatesContext = undefined;
    }
  }

  private normalizeMap(
    value: Map<string, any> | Record<string, any> | undefined,
  ): Record<string, any> | undefined {
    if (!value) {
      return undefined;
    }
    if (value instanceof Map) {
      return Object.fromEntries(value);
    }
    if (typeof value === 'object') {
      return value;
    }
    return undefined;
  }

  private getFromStates(entityId: string, key: string): any {
    const states = this.currentStatesContext;
    if (!states) {
      return undefined;
    }
    const entity = states[entityId];
    if (!entity || typeof entity !== 'object') {
      return undefined;
    }
    if (!Object.prototype.hasOwnProperty.call(entity, key)) {
      return undefined;
    }
    return entity[key];
  }

  private getFromState(key: string): any {
    const state = this.currentStateContext;
    if (!state || typeof state !== 'object') {
      return undefined;
    }
    if (!Object.prototype.hasOwnProperty.call(state, key)) {
      return undefined;
    }
    return state[key];
  }

  /**
   * Creates a Proxy around a Buffer/Uint8Array to verify it as a List<BigInt> in CEL.
   * This avoids allocating a new Array and filling it with BigInts for every execution.
   */
  private createBufferProxy(buffer: Uint8Array): any {
    // Target must be an array for Array.isArray checks (used by some CEL internals)
    return new Proxy([], {
      get: (target, prop, receiver) => {
        // Fast path for integer indexed access (e.g. data[0])
        if (typeof prop === 'string') {
          const idx = Number(prop);
          // Check against BUFFER length, not target length
          if (Number.isInteger(idx) && idx >= 0 && idx < buffer.length) {
            return this.BIGINT_CACHE[buffer[idx]];
          }
        }

        // Handle length/size properties
        if (prop === 'length') {
          return buffer.length;
        }

        // Handle iteration (e.g. for macros like .map(), .exists())
        if (prop === Symbol.iterator) {
          const cache = this.BIGINT_CACHE;
          return function* () {
            for (let i = 0; i < buffer.length; i++) {
              yield cache[buffer[i]];
            }
          };
        }

        // Fallback to Reflect for other properties (e.g. toString, etc.)
        return Reflect.get(target, prop, receiver);
      },
    });
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

import ivm from 'isolated-vm';
import { LambdaConfig } from './types.js';
import { logger } from '../utils/logger.js';

export class LambdaExecutor {
  // Static resources shared across all instances
  private static isolate: ivm.Isolate;
  private static scriptCache: Map<string, ivm.Script> = new Map();

  // Setup script that defines helpers in the sandbox
  private static readonly SETUP_SCRIPT = `
    // Helper: Convert BCD to Integer
    global.bcd_to_int = function(bcd) { return (bcd >> 4) * 10 + (bcd & 0x0f); };

    // Helper: Convert Integer to BCD
    global.int_to_bcd = function(int) { return (Math.floor(int / 10) % 10 << 4) | int % 10; };

    // Polyfill for 'id' helper used in Automation
    // Replicates the logic from AutomationManager using 'states' and 'command' globals
    global.id = function(entityId) {
      const entityState = (global.states && global.states[entityId]) || {};

      return new Proxy(entityState, {
        get: function(target, prop) {
          if (typeof prop === 'string' && prop.startsWith('command_')) {
            const cmdName = prop.substring(8); // 'command_'.length
            return function(val) {
              if (global.command) {
                return global.command(entityId, cmdName, val);
              }
            };
          }
          return target[prop];
        }
      });
    };

    // Helper to call host functions (References)
    global.callHost = function(ref, ...args) {
      if (!ref) return;
      return ref.applySync(undefined, args, { arguments: { copy: true }, result: { copy: true } });
    };
  `;

  constructor() {
    LambdaExecutor.initialize();
  }

  private static initialize() {
    if (this.isolate) return;

    // Create a shared Isolate
    // 128MB memory limit should be sufficient
    this.isolate = new ivm.Isolate({ memoryLimit: 128 });
  }

  public execute(lambda: LambdaConfig, contextData: Record<string, any>): any {
    let context: ivm.Context | undefined;

    try {
      // Create a fresh context for this execution
      // This is efficient in isolated-vm and ensures clean state
      context = LambdaExecutor.isolate.createContextSync();
      const jail = context.global;

      // Allow the global object to be referenced as 'global'
      jail.setSync('global', jail.derefInto());

      // 1. Compile and Run Setup Script (Helpers)
      // We could cache the compiled setup script too, but it's fast.
      // For optimization, let's cache it.
      this.getOrCompileScript('__setup__', LambdaExecutor.SETUP_SCRIPT).runSync(context);

      // 2. Inject Context Data
      for (const [key, value] of Object.entries(contextData)) {
        if (typeof value === 'function') {
          // Wrap functions as References
          // And create a JS wrapper in the sandbox to call them
          // We assume standard function signature
          const ref = new ivm.Reference(value);
          jail.setSync(`__ref_${key}`, ref);

          // Define a global wrapper that calls the reference
          const wrapperScript = `
            global['${key}'] = function(...args) {
              return global.callHost(global['__ref_${key}'], ...args);
            };
          `;
          context.evalSync(wrapperScript);

        } else if (value !== undefined) {
          // Pass data using ExternalCopy
          try {
            const copy = new ivm.ExternalCopy(value);
            jail.setSync(key, copy.copyInto());
          } catch (err) {
            // Fallback for types that might fail copy (like complex host objects we missed)
            // But usually contextData contains primitives, arrays, or POJOs.
            // AutomationManager passes 'id' as a function, which is caught above.
             logger.warn({ key, error: err }, '[Lambda] Failed to copy context data');
          }
        }
      }

      // 3. Compile and Run User Script
      // We wrap it to allow 'return' at the top level (simulating function body)
      const userScript = this.getOrCompileScript(
        lambda.script,
        `(function() { ${lambda.script} \n})()`
      );

      const result = userScript.runSync(context, { timeout: 100 });
      return result;

    } catch (error) {
      logger.error({ error, script: lambda.script }, '[Lambda] Execution failed');
      return null;
    } finally {
      // Release context resources
      if (context) {
        context.release();
      }
    }
  }

  private getOrCompileScript(key: string, code: string): ivm.Script {
    let script = LambdaExecutor.scriptCache.get(key);
    if (!script) {
      script = LambdaExecutor.isolate.compileScriptSync(code);
      LambdaExecutor.scriptCache.set(key, script);
    }
    return script;
  }
}

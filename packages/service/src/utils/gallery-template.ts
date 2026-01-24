type ParameterType = 'integer' | 'string' | 'integer[]' | 'object[]';
import { Environment } from '@marcbachmann/cel-js';

export interface GalleryParameterDefinition {
  name: string;
  type: ParameterType;
  default?: unknown;
  min?: number;
  max?: number;
  label?: string;
  label_en?: string;
  description?: string;
  schema?: Record<string, unknown>;
  hidden?: boolean;
  computed?: boolean;
}

export interface GalleryMeta {
  name?: string;
  name_en?: string;
  description?: string;
  description_en?: string;
  version?: string;
  author?: string;
  tags?: string[];
  min_version?: string;
  [key: string]: unknown;
}

export interface GallerySnippet {
  meta?: GalleryMeta;
  parameters?: GalleryParameterDefinition[];
  discovery?: {
    match: {
      data?: number[];
      mask?: number[];
      offset?: number;
      any_of?: Array<{ data?: number[]; mask?: number[]; offset?: number }>;
      regex?: string;
      condition?: string;
    };
    dimensions: Array<{
      parameter: string;
      offset: number;
      mask?: number;
      transform?: string;
      detect?: 'active_bits';
    }>;
    inference?: {
      strategy: 'max' | 'count' | 'unique_tuples' | 'grouped';
      output?: string;
    };
    ui?: {
      label?: string;
      label_en?: string;
      badge?: string;
      summary?: string;
      summary_en?: string;
    };
  };
  entities?: Record<string, unknown>;
  automation?: unknown[];
  scripts?: unknown[];
}

interface RepeatBlock {
  count?: number | string;
  over?: string;
  as: string;
  index?: string;
  start?: number;
}

const TEMPLATE_EXPRESSION = /{{\s*([^}]+)\s*}}/g;

function resolveParameterValues(
  definitions: GalleryParameterDefinition[] | undefined,
  providedValues: Record<string, unknown> | undefined,
): Record<string, unknown> {
  if (!definitions || definitions.length === 0) return {};

  const resolved: Record<string, unknown> = {};

  for (const definition of definitions) {
    let value =
      providedValues && Object.prototype.hasOwnProperty.call(providedValues, definition.name)
        ? providedValues[definition.name]
        : definition.default;

    // Handle hidden/computed parameters
    if (value === undefined && (definition.hidden || definition.computed)) {
      // Intentionally empty block - fall through to error check if truly missing
    }

    if (value === undefined) {
      throw new Error(`[gallery] Missing parameter: ${definition.name}`);
    }

    resolved[definition.name] = validateParameterValue(definition, value);
  }

  return resolved;
}

function validateParameterValue(definition: GalleryParameterDefinition, value: unknown): unknown {
  const { type, name, min, max } = definition;

  if (type === 'integer') {
    const parsed = coerceInteger(value, name);
    if (min !== undefined && parsed < min) {
      throw new Error(`[gallery] Parameter ${name} must be >= ${min}`);
    }
    if (max !== undefined && parsed > max) {
      throw new Error(`[gallery] Parameter ${name} must be <= ${max}`);
    }
    return parsed;
  }

  if (type === 'string') {
    if (typeof value !== 'string') {
      // Auto-convert numbers to string if type is string
      if (typeof value === 'number') {
        return String(value);
      }
      throw new Error(`[gallery] Parameter ${name} must be a string`);
    }
    return value;
  }

  if (type === 'integer[]') {
    if (!Array.isArray(value)) {
      throw new Error(`[gallery] Parameter ${name} must be an integer array`);
    }
    return value.map((item) => coerceInteger(item, name));
  }

  if (type === 'object[]') {
    if (!Array.isArray(value)) {
      throw new Error(`[gallery] Parameter ${name} must be an object array`);
    }

    // Prepare defaults from schema
    const itemDefaults: Record<string, unknown> = {};
    if (definition.schema?.properties) {
      const properties = definition.schema.properties as Record<string, { default?: unknown }>;
      for (const [key, prop] of Object.entries(properties)) {
        if (prop && typeof prop === 'object' && prop.default !== undefined) {
          itemDefaults[key] = prop.default;
        }
      }
    }

    const mergedValue = [];
    for (const item of value) {
      if (!item || typeof item !== 'object') {
        throw new Error(`[gallery] Parameter ${name} must contain objects`);
      }
      // Merge defaults (item specific values override defaults)
      mergedValue.push({ ...itemDefaults, ...item });
    }
    return mergedValue;
  }

  throw new Error(`[gallery] Unsupported parameter type: ${type}`);
}

function coerceInteger(value: unknown, name: string): number {
  if (typeof value === 'number' && Number.isInteger(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number.parseInt(value, 10);
    if (Number.isInteger(parsed)) {
      return parsed;
    }
  }
  throw new Error(`[gallery] Parameter ${name} must be an integer`);
}

function resolveTemplateValue(template: string, context: Record<string, unknown>): unknown {
  const trimmed = template.trim();
  const fullMatch = trimmed.match(/^{{\s*([^}]+)\s*}}$/);
  if (fullMatch) {
    return evaluateTemplateExpression(fullMatch[1], context);
  }

  return template.replace(TEMPLATE_EXPRESSION, (_match, expr) => {
    const evaluated = evaluateTemplateExpression(expr, context);
    return String(evaluated);
  });
}

function evaluateTemplateExpression(expression: string, context: Record<string, unknown>): unknown {
  return evaluateExpression(expression.trim(), context);
}

/**
 * Recursively convert values for CEL compatibility.
 * Specifically handles converting integers to BigInt.
 */
function convertForCel(val: unknown): unknown {
  if (typeof val === 'number' && Number.isInteger(val)) {
    return BigInt(val);
  }
  if (Array.isArray(val)) {
    return val.map(convertForCel);
  }
  if (val && typeof val === 'object' && val !== null) {
    if (val.constructor === Object) {
      const newVal: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(val)) {
        newVal[k] = convertForCel(v);
      }
      return newVal;
    }
  }
  return val;
}

function evaluateExpression(expression: string, context: Record<string, unknown>): unknown {
  const env = new Environment();

  // Register Helper Functions (replicated for local context)
  env.registerFunction('bcd_to_int(int): int', (bcd: bigint) => {
    const val = Number(bcd);
    const res = (val >> 4) * 10 + (val & 0x0f);
    return BigInt(res);
  });
  env.registerFunction('int_to_bcd(int): int', (val: bigint) => {
    const v = Number(val);
    const res = (Math.floor(v / 10) % 10 << 4) | v % 10;
    return BigInt(res);
  });
  env.registerFunction('bitAnd(int, int): int', (a: bigint, b: bigint) => a & b);
  env.registerFunction('bitOr(int, int): int', (a: bigint, b: bigint) => a | b);
  env.registerFunction('bitXor(int, int): int', (a: bigint, b: bigint) => a ^ b);
  env.registerFunction('bitNot(int): int', (a: bigint) => ~a);
  env.registerFunction('bitShiftLeft(int, int): int', (a: bigint, b: bigint) => a << b);
  env.registerFunction('bitShiftRight(int, int): int', (a: bigint, b: bigint) => a >> b);
  env.registerFunction('hex(int): string', (val: bigint) => {
    return `0x${Number(val).toString(16).padStart(2, '0')}`;
  });
  env.registerFunction('pad(dyn, int): string', (val: unknown, length: bigint) => {
    return String(typeof val === 'bigint' ? Number(val) : val).padStart(Number(length), '0');
  });

  // Dynamically register variables from context
  const safeContext: Record<string, any> = {};

  for (const [key, value] of Object.entries(context)) {
    const safeValue = convertForCel(value);
    safeContext[key] = safeValue;

    let type = 'dyn'; // Default to dynamic
    if (typeof safeValue === 'bigint') {
      type = 'int';
    } else {
      if (typeof safeValue === 'string') {
        type = 'string';
      } else if (Array.isArray(safeValue)) {
        type = 'list';
      } else if (typeof safeValue === 'object' && safeValue !== null) {
        type = 'map';
      }
    }
    env.registerVariable(key, type);
  }

  try {
    const ast = env.parse(expression);
    const result = ast(safeContext);

    // Convert BigInt results from CEL back to Number
    if (typeof result === 'bigint') {
      return Number(result);
    }
    return result;
  } catch (error) {
    const err = error as Error;
    throw new Error(`[gallery] CEL Evaluation failed for "${expression}": ${err.message}`);
  }
}

function expandRepeatBlock(
  node: Record<string, unknown>,
  context: Record<string, unknown>,
): unknown[] {
  const repeat = node.$repeat as RepeatBlock | undefined;
  if (!repeat || !repeat.as) {
    throw new Error('[gallery] $repeat requires an "as" field');
  }

  const template = node.$nested
    ? (node.$nested as Record<string, unknown>)
    : Object.fromEntries(
        Object.entries(node).filter(([key]) => key !== '$repeat' && key !== '$nested'),
      );

  const iterations: Array<{ value: unknown; index: number }> = [];

  if (repeat.over) {
    const list = context[repeat.over];
    if (!Array.isArray(list)) {
      throw new Error(`[gallery] $repeat over "${repeat.over}" must be an array`);
    }
    list.forEach((item, index) => iterations.push({ value: item, index }));
  } else if (repeat.count !== undefined) {
    const countValue =
      typeof repeat.count === 'string' ? resolveTemplateValue(repeat.count, context) : repeat.count;
    const count = coerceInteger(countValue, repeat.as);
    const start = repeat.start ?? 1;
    for (let i = 0; i < count; i += 1) {
      iterations.push({ value: start + i, index: i });
    }
  } else {
    throw new Error('[gallery] $repeat requires either count or over');
  }

  const results: unknown[] = [];
  for (const { value, index } of iterations) {
    const nextContext: Record<string, unknown> = {
      ...context,
      [repeat.as]: value,
    };
    if (repeat.index) {
      nextContext[repeat.index] = index;
    }
    const expanded = expandNode(template, nextContext);
    if (Array.isArray(expanded)) {
      results.push(...expanded);
    } else {
      results.push(expanded);
    }
  }

  return results;
}

function expandNode(node: unknown, context: Record<string, unknown>): unknown {
  if (Array.isArray(node)) {
    const expandedList = node.flatMap((item) => {
      const expanded = expandNode(item, context);
      if (expanded === null) return []; // Filter out null (from $if false)
      return Array.isArray(expanded) ? expanded : [expanded];
    });
    return expandedList;
  }

  if (node && typeof node === 'object') {
    const record = node as Record<string, unknown>;

    // $if conditional processing
    if (record.$if !== undefined) {
      const condition = record.$if;
      const conditionValue =
        typeof condition === 'string' ? resolveTemplateValue(condition, context) : condition;

      if (!conditionValue) {
        return null; // Condition not met, exclude this node
      }

      // Condition met, process remaining properties (excluding $if)
      const filtered = Object.fromEntries(Object.entries(record).filter(([key]) => key !== '$if'));
      return expandNode(filtered, context);
    }

    if (record.$repeat) {
      return expandRepeatBlock(record, context);
    }

    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(record)) {
      if (key === '$nested') continue;
      result[key] = expandNode(value, context);
    }
    return result;
  }

  if (typeof node === 'string') {
    return resolveTemplateValue(node, context);
  }

  return node;
}

export function expandGalleryTemplate(
  snippet: GallerySnippet,
  parameterValues?: Record<string, unknown>,
): GallerySnippet {
  const parameters = resolveParameterValues(snippet.parameters, parameterValues);
  const context = { ...parameters };

  const expandedEntities = snippet.entities
    ? (expandNode(snippet.entities, context) as Record<string, unknown>)
    : undefined;
  const expandedAutomation = snippet.automation
    ? (expandNode(snippet.automation, context) as unknown[])
    : undefined;
  const expandedScripts = snippet.scripts
    ? (expandNode(snippet.scripts, context) as unknown[])
    : undefined;

  return {
    ...snippet,
    parameters: undefined,
    entities: expandedEntities,
    automation: expandedAutomation,
    scripts: expandedScripts,
  };
}

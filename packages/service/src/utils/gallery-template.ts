type ParameterType = 'integer' | 'string' | 'integer[]' | 'object[]';

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
}

export interface GallerySnippet {
  meta?: Record<string, unknown>;
  parameters?: GalleryParameterDefinition[];
  discovery?: {
    match: {
      data: number[];
      mask?: number[];
      offset?: number;
      any_of?: Array<{ data: number[]; mask?: number[]; offset?: number }>;
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
const UNSAFE_EXPRESSION = /__proto__|constructor|prototype/;
const ALLOWED_EXPRESSION = /^[\w\s.+\-*/()]+$/;

function resolveParameterValues(
  definitions: GalleryParameterDefinition[] | undefined,
  providedValues: Record<string, unknown> | undefined,
): Record<string, unknown> {
  if (!definitions || definitions.length === 0) return {};

  const resolved: Record<string, unknown> = {};

  for (const definition of definitions) {
    const value =
      providedValues && Object.prototype.hasOwnProperty.call(providedValues, definition.name)
        ? providedValues[definition.name]
        : definition.default;

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
    for (const item of value) {
      if (!item || typeof item !== 'object') {
        throw new Error(`[gallery] Parameter ${name} must contain objects`);
      }
    }
    return value;
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

function evaluateExpression(expression: string, context: Record<string, unknown>): unknown {
  if (UNSAFE_EXPRESSION.test(expression)) {
    throw new Error(`[gallery] Unsafe expression: ${expression}`);
  }
  if (!ALLOWED_EXPRESSION.test(expression)) {
    throw new Error(`[gallery] Unsupported expression: ${expression}`);
  }

  const evaluator = new Function('context', `with (context) { return (${expression}); }`);
  return evaluator(context);
}

function applyFilters(value: unknown, filters: string[]): unknown {
  let result = value;
  for (const filterRaw of filters) {
    const [filterName, filterArg] = filterRaw.split(':').map((part) => part.trim());

    if (filterName === 'hex') {
      if (typeof result !== 'number') {
        throw new Error('[gallery] hex filter requires a number');
      }
      result = `0x${result.toString(16).padStart(2, '0')}`;
      continue;
    }

    if (filterName === 'pad') {
      const length = filterArg ? Number.parseInt(filterArg, 10) : 0;
      if (!Number.isInteger(length) || length <= 0) {
        throw new Error('[gallery] pad filter requires a positive length');
      }
      result = String(result).padStart(length, '0');
      continue;
    }

    throw new Error(`[gallery] Unsupported filter: ${filterName}`);
  }

  return result;
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
  const [baseExpression, ...filterParts] = expression.split('|').map((part) => part.trim());
  const result = evaluateExpression(baseExpression, context);
  return filterParts.length > 0 ? applyFilters(result, filterParts) : result;
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
      typeof repeat.count === 'string'
        ? resolveTemplateValue(repeat.count, context)
        : repeat.count;
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
      return Array.isArray(expanded) ? expanded : [expanded];
    });
    return expandedList;
  }

  if (node && typeof node === 'object') {
    const record = node as Record<string, unknown>;
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


interface RepeatBlock {
  count?: string | number;
  over?: string;
  as: string;
  index?: string;
  start?: number;
}

interface TemplateParameter {
  name: string;
  type: string;
  default?: any;
}

export function processGalleryTemplate(template: any, parameters: Record<string, any> = {}): any {
  // 1. Prepare context with defaults
  const context: Record<string, any> = {};

  if (template.parameters && Array.isArray(template.parameters)) {
    for (const param of template.parameters as TemplateParameter[]) {
      let val = parameters[param.name];

      if (val === undefined) {
        val = param.default;
      }

      // Type casting
      if (val !== undefined) {
        if (param.type === 'integer') {
          const num = parseInt(String(val), 10);
          if (!isNaN(num)) val = num;
        } else if (param.type === 'integer[]' && Array.isArray(val)) {
             val = val.map((v: any) => parseInt(String(v), 10));
        }
      }

      if (val !== undefined) {
        context[param.name] = val;
      }
    }
  }

  // Merge remaining parameters
  for (const [key, val] of Object.entries(parameters)) {
      if (context[key] === undefined) {
          context[key] = val;
      }
  }

  // Deep clone
  const templateClone = JSON.parse(JSON.stringify(template));

  // Remove parameters definition from output
  if (templateClone.parameters) delete templateClone.parameters;

  return processNode(templateClone, context);
}

function processNode(node: any, context: Record<string, any>): any {
  if (Array.isArray(node)) {
    const result: any[] = [];
    for (const item of node) {
      if (item && typeof item === 'object' && item.$repeat) {
        const repeatConfig = item.$repeat as RepeatBlock;
        const expandedItems = expandRepeat(item, repeatConfig, context);
        result.push(...expandedItems);
      } else {
        result.push(processNode(item, context));
      }
    }
    return result;
  } else if (node && typeof node === 'object') {
    const newNode: any = {};
    for (const [key, value] of Object.entries(node)) {
      if (key === '$repeat') continue;
      if (key === '$nested') continue; // Should have been handled if we are in a repeat block?
      // Wait, if we are NOT in a repeat block (top level object), $nested has no meaning?
      // Or if a property is $nested, we should ignore it here?
      // If we are at root, we process recursively.
      newNode[key] = processNode(value, context);
    }
    return newNode;
  } else if (typeof node === 'string') {
    return evaluateString(node, context);
  }

  return node;
}

function expandRepeat(templateItem: any, repeatConfig: RepeatBlock, context: Record<string, any>): any[] {
  const items: any[] = [];
  let loopItems: any[] = [];

  if (repeatConfig.over) {
    const overValue = evaluateExpression(repeatConfig.over, context);
    if (Array.isArray(overValue)) {
      loopItems = overValue;
    } else {
       return [];
    }
  } else {
    // count based
    let countVal: any;
    if (repeatConfig.count !== undefined) {
        // count can be a variable expression '{{light_count}}' or number
        if (typeof repeatConfig.count === 'string' && repeatConfig.count.includes('{{')) {
             countVal = evaluateExpression(extractExpression(repeatConfig.count), context);
        } else {
             countVal = repeatConfig.count;
        }
    }

    const count = typeof countVal === 'number' ? countVal : parseInt(String(countVal), 10);
    if (isNaN(count)) return [];

    const start = repeatConfig.start !== undefined ? repeatConfig.start : 1;
    for (let i = 0; i < count; i++) {
      loopItems.push(start + i);
    }
  }

  const asVar = repeatConfig.as;
  const indexVar = repeatConfig.index;

  for (let i = 0; i < loopItems.length; i++) {
    const itemValue = loopItems[i];
    const loopContext = { ...context };
    loopContext[asVar] = itemValue;
    if (indexVar) {
      loopContext[indexVar] = i;
    }

    // Determine the template for this iteration
    let iterationTemplate: any;

    if (templateItem.$nested) {
      iterationTemplate = templateItem.$nested;
      // If the nested template has $repeat, we need to recurse expansion
      if (iterationTemplate.$repeat) {
        const nestedItems = expandRepeat(iterationTemplate, iterationTemplate.$repeat, loopContext);
        items.push(...nestedItems);
        continue; // Skip standard processing
      }
    } else {
      iterationTemplate = { ...templateItem };
      delete iterationTemplate.$repeat;
      delete iterationTemplate.$nested;
    }

    // Process the determined template
    items.push(processNode(iterationTemplate, loopContext));
  }

  return items;
}

function extractExpression(str: string): string {
    const match = str.match(/^\{\{(.+?)\}\}$/);
    return match ? match[1] : str;
}

function evaluateString(str: string, context: Record<string, any>): any {
  const regex = /\{\{(.+?)\}\}/g;

  // Check if it is a single expression covering the whole string
  // This preserves types (e.g. number)
  const matches = [...str.matchAll(regex)];

  if (matches.length === 1 && matches[0][0] === str) {
     return evaluateExpression(matches[0][1], context);
  }

  if (matches.length === 0) return str;

  return str.replace(regex, (match, expression) => {
    const val = evaluateExpression(expression, context);
    return String(val);
  });
}

function evaluateExpression(expression: string, context: Record<string, any>): any {
  const parts = expression.split('|');
  let valueExpr = parts[0].trim();
  const filters = parts.slice(1).map(f => f.trim());

  let value: any;

  try {
    const keys = Object.keys(context);
    const values = Object.values(context);

    if (!/^[a-zA-Z0-9_\.\+\-\*\/\s\(\)\[\]]+$/.test(valueExpr)) {
       // Only allow basic property access and math
       console.warn(`[Eval] Blocked unsafe expression: ${valueExpr}`);
       return expression;
    }

    // Use Function constructor for safe-ish evaluation of math/property access
    // This allows "room.name" if room is an object in context.
    const func = new Function(...keys, `return ${valueExpr};`);
    value = func(...values);
  } catch (e) {
    console.warn(`[Eval] Failed to evaluate: ${valueExpr}`, e);
    return `{{${expression}}}`;
  }

  for (const filterStr of filters) {
    const [filterName, ...args] = filterStr.split(':');
    const filterFn = FILTERS[filterName];
    if (filterFn) {
      value = filterFn(value, ...args);
    }
  }

  return value;
}

const FILTERS: Record<string, (val: any, ...args: any[]) => any> = {
  hex: (val) => {
    const num = Number(val);
    if (isNaN(num)) return val;
    return '0x' + num.toString(16).toUpperCase().padStart(2, '0');
  },
  pad: (val, length) => {
    const len = Number(length) || 2;
    return String(val).padStart(len, '0');
  }
};

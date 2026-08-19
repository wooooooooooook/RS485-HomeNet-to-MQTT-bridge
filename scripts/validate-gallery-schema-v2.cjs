const fs = require('node:fs');
const path = require('node:path');
const yaml = require('js-yaml');

const ROOT = path.resolve(__dirname, '..');
const GALLERY_DIR = path.join(ROOT, 'gallery');
const schema = JSON.parse(fs.readFileSync(path.join(ROOT, 'packages/core/static/schema/homenet-bridge.schema.json'), 'utf8'));

const ENTITY_TYPES = new Set([
  'light', 'climate', 'valve', 'button', 'sensor', 'fan', 'switch', 'lock',
  'number', 'select', 'text_sensor', 'text', 'binary_sensor',
]);
const ACTIONS = new Set([
  'command', 'publish', 'log', 'delay', 'script', 'update_state',
  'send_packet', 'if', 'repeat', 'wait_until', 'choose', 'stop',
]);
const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isTemplate = (v) => typeof v === 'string' && /{{\s*[^}]+\s*}}/.test(v);

function resolveRef(ref) {
  let value = schema;
  for (const part of ref.slice(2).split('/')) value = value[part.replace(/~1/g, '/').replace(/~0/g, '~')];
  return value;
}

function matchesType(value, type) {
  if (type === 'object') return isObject(value);
  if (type === 'array') return Array.isArray(value);
  if (type === 'string') return typeof value === 'string';
  if (type === 'boolean') return typeof value === 'boolean';
  if (type === 'number') return typeof value === 'number' && Number.isFinite(value);
  if (type === 'integer') return typeof value === 'number' && Number.isInteger(value);
  return true;
}

function validate(value, rule, location, errors, options = {}) {
  if (!rule) return;
  if (rule.$ref) return validate(value, resolveRef(rule.$ref), location, errors, options);

  if (options.allowTemplate && isTemplate(value)) return;

  if (rule.anyOf) {
    if (rule.anyOf.some((branch) => { const local = []; validate(value, branch, location, local, options); return local.length === 0; })) return;
    errors.push(`${location}: does not match any allowed schema branch`);
    return;
  }
  if (rule.oneOf) {
    const matches = rule.oneOf.filter((branch) => { const local = []; validate(value, branch, location, local, options); return local.length === 0; }).length;
    if (matches !== 1) errors.push(`${location}: expected exactly one schema branch, matched ${matches}`);
    return;
  }
  if (rule.const !== undefined && value !== rule.const) errors.push(`${location}: must equal ${JSON.stringify(rule.const)}`);
  if (rule.enum && !rule.enum.includes(value)) errors.push(`${location}: invalid value ${JSON.stringify(value)}`);

  if (rule.type) {
    const types = Array.isArray(rule.type) ? rule.type : [rule.type];
    if (!types.some((type) => matchesType(value, type))) {
      errors.push(`${location}: expected ${types.join(' or ')}, got ${Array.isArray(value) ? 'array' : typeof value}`);
      return;
    }
  }

  if (rule.items && Array.isArray(value)) {
    value.forEach((item, index) => validate(item, rule.items, `${location}[${index}]`, errors, options));
  }
  if (isObject(value) && rule.required) {
    for (const key of rule.required) if (!(key in value)) errors.push(`${location}: missing required property '${key}'`);
  }
  if (isObject(value) && rule.properties) {
    for (const [key, child] of Object.entries(rule.properties)) {
      if (key in value) validate(value[key], child, `${location}.${key}`, errors, options);
    }
  }
  if (isObject(value) && rule.patternProperties) {
    for (const [pattern, child] of Object.entries(rule.patternProperties)) {
      for (const [key, childValue] of Object.entries(value)) {
        if (new RegExp(pattern).test(key)) validate(childValue, child, `${location}.${key}`, errors, options);
      }
    }
  }
}

// Expand gallery template operators structurally. We intentionally do not evaluate CEL;
// the validator only needs one representative branch to validate schema shape.
function representative(node) {
  if (Array.isArray(node)) {
    const values = node.flatMap((item) => {
      const value = representative(item);
      return Array.isArray(value) ? value : [value];
    }).filter((value) => value !== null);
    return values;
  }
  if (!isObject(node)) return node;
  if (node.$if !== undefined) {
    const rest = Object.fromEntries(Object.entries(node).filter(([key]) => key !== '$if'));
    return representative(rest);
  }
  if (node.$repeat !== undefined) {
    const template = node.$nested !== undefined
      ? node.$nested
      : Object.fromEntries(Object.entries(node).filter(([key]) => key !== '$repeat' && key !== '$nested'));
    const value = representative(template);
    return Array.isArray(value) ? value : [value];
  }
  if (node.$nested !== undefined) return representative(node.$nested);
  const result = {};
  for (const [key, value] of Object.entries(node)) result[key] = representative(value);
  return result;
}

function firstRepresentative(node) {
  const value = representative(node);
  return Array.isArray(value) ? value[0] : value;
}

function validateMeta(meta, location, errors) {
  if (!isObject(meta)) return errors.push(`${location}: must be an object`);
  for (const key of ['name', 'name_en', 'description', 'description_en', 'version', 'author', 'min_version']) {
    if (key in meta && typeof meta[key] !== 'string') errors.push(`${location}.${key}: must be a string`);
  }
  if ('tags' in meta && (!Array.isArray(meta.tags) || meta.tags.some((tag) => typeof tag !== 'string'))) {
    errors.push(`${location}.tags: must be an array of strings`);
  }
}

function validateParameters(parameters, location, errors) {
  if (!Array.isArray(parameters)) return errors.push(`${location}: must be an array`);
  const names = new Set();
  const types = new Set(['integer', 'string', 'integer[]', 'object[]']);
  parameters.forEach((parameter, index) => {
    const loc = `${location}[${index}]`;
    if (!isObject(parameter)) return errors.push(`${loc}: must be an object`);
    if (typeof parameter.name !== 'string' || !parameter.name.trim()) errors.push(`${loc}.name: must be a non-empty string`);
    else if (names.has(parameter.name)) errors.push(`${loc}.name: duplicate parameter '${parameter.name}'`);
    else names.add(parameter.name);
    if (!types.has(parameter.type)) errors.push(`${loc}.type: invalid parameter type`);
    for (const key of ['label', 'label_en', 'description', 'description_en']) if (key in parameter && typeof parameter[key] !== 'string') errors.push(`${loc}.${key}: must be a string`);
    for (const key of ['min', 'max']) if (key in parameter && typeof parameter[key] !== 'number') errors.push(`${loc}.${key}: must be a number`);
    if ('hidden' in parameter && typeof parameter.hidden !== 'boolean') errors.push(`${loc}.hidden: must be boolean`);
    if ('computed' in parameter && typeof parameter.computed !== 'boolean') errors.push(`${loc}.computed: must be boolean`);
    if (parameter.type === 'object[]' && parameter.schema !== undefined && !isObject(parameter.schema)) errors.push(`${loc}.schema: must be an object`);
  });
}

function validateDiscovery(discovery, location, errors) {
  if (!isObject(discovery)) return errors.push(`${location}: must be an object`);
  if (!isObject(discovery.match)) errors.push(`${location}.match: must be an object`);
  if (discovery.dimensions !== undefined) {
    if (!Array.isArray(discovery.dimensions)) errors.push(`${location}.dimensions: must be an array`);
    else discovery.dimensions.forEach((dimension, index) => {
      const loc = `${location}.dimensions[${index}]`;
      if (!isObject(dimension)) return errors.push(`${loc}: must be an object`);
      if (typeof dimension.parameter !== 'string') errors.push(`${loc}.parameter: must be a string`);
      if (!('index' in dimension) && !('offset' in dimension)) errors.push(`${loc}: requires index or offset`);
      for (const key of ['index', 'offset']) if (key in dimension && typeof dimension[key] !== 'number' && !isTemplate(dimension[key])) errors.push(`${loc}.${key}: must be a number or template expression`);
      if ('mask' in dimension && typeof dimension.mask !== 'number' && !isTemplate(dimension.mask)) errors.push(`${loc}.mask: must be a number or template expression`);
      if ('transform' in dimension && typeof dimension.transform !== 'string') errors.push(`${loc}.transform: must be a string`);
      if ('detect' in dimension && dimension.detect !== 'active_bits') errors.push(`${loc}.detect: unsupported value`);
    });
  }
  if (discovery.inference !== undefined && (!isObject(discovery.inference) || !['max', 'count', 'unique_tuples', 'grouped'].includes(discovery.inference.strategy))) {
    errors.push(`${location}.inference.strategy: invalid strategy`);
  }
}

function validateTrigger(trigger, location, errors) {
  if (!isObject(trigger)) return errors.push(`${location}: must be an object`);
  if (!['state', 'packet', 'schedule', 'startup'].includes(trigger.type)) errors.push(`${location}.type: invalid trigger type`);
  if (trigger.type === 'state' && typeof trigger.entity_id !== 'string' && !isTemplate(trigger.entity_id)) errors.push(`${location}.entity_id: required string`);
  if (trigger.type === 'packet' && !isObject(trigger.match)) errors.push(`${location}.match: required object`);
  if (trigger.type === 'schedule' && trigger.every === undefined && typeof trigger.cron !== 'string') errors.push(`${location}: schedule requires every or cron`);
  if (trigger.guard !== undefined && typeof trigger.guard !== 'string' && !isTemplate(trigger.guard)) errors.push(`${location}.guard: must be a string`);
}

function validateAction(action, location, errors) {
  const value = firstRepresentative(action);
  if (!isObject(value)) return errors.push(`${location}: must be an object`);
  if (!ACTIONS.has(value.action)) return errors.push(`${location}.action: invalid action '${value.action}'`);
  if (value.action === 'command' && typeof value.target !== 'string' && !isTemplate(value.target)) errors.push(`${location}.target: required string`);
  if (value.action === 'publish' && typeof value.topic !== 'string' && !isTemplate(value.topic)) errors.push(`${location}.topic: required string`);
  if (value.action === 'log' && typeof value.message !== 'string' && !isTemplate(value.message)) errors.push(`${location}.message: required string`);
  if (value.action === 'script' && typeof value.script !== 'string' && typeof value.code !== 'string') errors.push(`${location}: script or code is required`);
  if (value.action === 'update_state' && (typeof value.target_id !== 'string' || !isObject(value.state))) errors.push(`${location}: target_id and state are required`);
  if (value.action === 'send_packet' && !Array.isArray(value.data) && typeof value.data !== 'string') errors.push(`${location}.data: required byte array or expression string`);
  if (value.action === 'if') {
    if (typeof value.condition !== 'string' && !isTemplate(value.condition)) errors.push(`${location}.condition: required string`);
    if (!Array.isArray(value.then)) errors.push(`${location}.then: required array`); else value.then.forEach((item, i) => validateAction(item, `${location}.then[${i}]`, errors));
    if (value.else !== undefined) if (!Array.isArray(value.else)) errors.push(`${location}.else: must be an array`); else value.else.forEach((item, i) => validateAction(item, `${location}.else[${i}]`, errors));
  }
  if (value.action === 'repeat') {
    if (!Array.isArray(value.actions)) errors.push(`${location}.actions: required array`); else value.actions.forEach((item, i) => validateAction(item, `${location}.actions[${i}]`, errors));
  }
  if (value.action === 'wait_until' && typeof value.condition !== 'string' && !isTemplate(value.condition)) errors.push(`${location}.condition: required string`);
  if (value.action === 'choose') {
    if (!Array.isArray(value.choices)) errors.push(`${location}.choices: required array`);
    else value.choices.forEach((choice, i) => {
      const selected = firstRepresentative(choice);
      if (!isObject(selected) || typeof selected.condition !== 'string' || !Array.isArray(selected.then)) errors.push(`${location}.choices[${i}]: requires condition and then`);
      else selected.then.forEach((item, j) => validateAction(item, `${location}.choices[${i}].then[${j}]`, errors));
    });
    if (value.default !== undefined) if (!Array.isArray(value.default)) errors.push(`${location}.default: must be an array`); else value.default.forEach((item, i) => validateAction(item, `${location}.default[${i}]`, errors));
  }
}

function validateAutomation(item, location, errors) {
  const value = firstRepresentative(item);
  if (!isObject(value)) return errors.push(`${location}: must be an object`);
  if (typeof value.id !== 'string' || !value.id.trim()) errors.push(`${location}.id: required non-empty string`);
  if (!Array.isArray(value.trigger)) errors.push(`${location}.trigger: required array`); else value.trigger.forEach((trigger, i) => validateTrigger(firstRepresentative(trigger), `${location}.trigger[${i}]`, errors));
  if ('then' in value && 'actions' in value) errors.push(`${location}: 'then' and deprecated 'actions' cannot both be defined`);
  const actions = value.then ?? value.actions;
  if (!Array.isArray(actions)) errors.push(`${location}.then: required array`); else actions.forEach((action, i) => validateAction(action, `${location}.then[${i}]`, errors));
  if (value.else !== undefined) if (!Array.isArray(value.else)) errors.push(`${location}.else: must be an array`); else value.else.forEach((action, i) => validateAction(action, `${location}.else[${i}]`, errors));
}

function validateScript(item, location, errors) {
  const value = firstRepresentative(item);
  if (!isObject(value)) return errors.push(`${location}: must be an object`);
  if (typeof value.id !== 'string' || !value.id.trim()) errors.push(`${location}.id: required non-empty string`);
  if (!Array.isArray(value.actions)) errors.push(`${location}.actions: required array`); else value.actions.forEach((action, i) => validateAction(action, `${location}.actions[${i}]`, errors));
  if (value.args !== undefined) {
    if (!isObject(value.args)) errors.push(`${location}.args: must be an object`);
    else for (const [name, arg] of Object.entries(value.args)) {
      if (!isObject(arg)) errors.push(`${location}.args.${name}: must be an object`);
      else if (arg.type !== undefined && !['string', 'number', 'boolean', 'select'].includes(arg.type)) errors.push(`${location}.args.${name}.type: invalid argument type`);
    }
  }
}

function validateFile(filePath) {
  const relative = path.relative(ROOT, filePath);
  let document;
  try { document = yaml.load(fs.readFileSync(filePath, 'utf8')); }
  catch (error) { return [`${relative}: YAML parse error: ${error.message}`]; }
  if (!isObject(document)) return [`${relative}: document must be a YAML object`];
  const errors = [];

  if (document.meta === undefined) errors.push(`${relative}: missing required gallery 'meta'`);
  else validateMeta(document.meta, `${relative}.meta`, errors);
  if (document.parameters !== undefined) validateParameters(document.parameters, `${relative}.parameters`, errors);
  if (document.discovery !== undefined) validateDiscovery(document.discovery, `${relative}.discovery`, errors);

  if (document.entities !== undefined) {
    if (!isObject(document.entities)) errors.push(`${relative}.entities: must be an object`);
    else for (const [type, items] of Object.entries(document.entities)) {
      // automation is a legacy gallery location; validate it using automation rules.
      if (type === 'automation') {
        const list = Array.isArray(items) ? items : [items];
        list.forEach((item, index) => validateAutomation(item, `${relative}.entities.automation[${index}]`, errors));
        continue;
      }
      if (!ENTITY_TYPES.has(type)) { errors.push(`${relative}.entities.${type}: unknown entity type`); continue; }
      if (!Array.isArray(items)) { errors.push(`${relative}.entities.${type}: must be an array`); continue; }
      const definitionName = type === 'text_sensor' ? 'TextSensorEntity' : type === 'binary_sensor' ? 'BinarySensorEntity' : `${type[0].toUpperCase()}${type.slice(1)}Entity`;
      const definition = schema.definitions[definitionName];
      if (!definition) { errors.push(`${relative}.entities.${type}: schema definition not found`); continue; }
      items.forEach((item, index) => {
        const normalized = firstRepresentative(item);
        validate(normalized, definition, `${relative}.entities.${type}[${index}]`, errors, { allowTemplate: true });
        if (!isObject(normalized) || typeof normalized.id !== 'string' || !normalized.id.trim()) errors.push(`${relative}.entities.${type}[${index}].id: required non-empty string`);
      });
    }
  }

  if (document.automation !== undefined) {
    if (!Array.isArray(document.automation)) errors.push(`${relative}.automation: must be an array`);
    else document.automation.forEach((item, index) => validateAutomation(item, `${relative}.automation[${index}]`, errors));
  }
  if (document.scripts !== undefined) {
    if (!Array.isArray(document.scripts)) errors.push(`${relative}.scripts: must be an array`);
    else document.scripts.forEach((item, index) => validateScript(item, `${relative}.scripts[${index}]`, errors));
  }

  return errors;
}

const files = [];
function walk(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (/\.ya?ml$/i.test(entry.name)) files.push(full);
  }
}
walk(GALLERY_DIR);

let failures = 0;
for (const file of files.sort()) {
  const errors = validateFile(file);
  if (errors.length) {
    failures += errors.length;
    for (const error of errors) console.error(`✗ ${error}`);
  }
}

console.log(`Validated ${files.length} gallery files`);
if (failures) {
  console.error(`Gallery validation failed with ${failures} error(s)`);
  process.exit(1);
}
console.log('Gallery validation passed');

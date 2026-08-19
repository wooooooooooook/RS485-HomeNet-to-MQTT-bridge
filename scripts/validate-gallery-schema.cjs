const fs = require('node:fs');
const path = require('node:path');
const yaml = require('js-yaml');

const ROOT = path.resolve(__dirname, '..');
const GALLERY_DIR = path.join(ROOT, 'gallery');
const schema = JSON.parse(fs.readFileSync(path.join(ROOT, 'packages/core/static/schema/homenet-bridge.schema.json'), 'utf8'));
const TEMPLATE_RE = /{{\s*[^}]+\s*}}/;
const EXPRESSION_RE = /^(state_|command_|data$|ack$|guard$|condition$|message$)/;
const ENTITY_TYPES = new Set(['light', 'climate', 'valve', 'button', 'sensor', 'fan', 'switch', 'lock', 'number', 'select', 'text_sensor', 'text', 'binary_sensor']);
const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isTemplate = (v) => typeof v === 'string' && TEMPLATE_RE.test(v);

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

  const property = location.split('.').pop().replace(/\[\d+\]$/, '');
  if (options.allowExpressionString && typeof value === 'string' && EXPRESSION_RE.test(property)) return;
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
  if (rule.items && Array.isArray(value)) value.forEach((item, i) => validate(item, rule.items, `${location}[${i}]`, errors, options));
  if (isObject(value) && rule.required) for (const key of rule.required) if (!(key in value)) errors.push(`${location}: missing required property '${key}'`);
  if (isObject(value) && rule.properties) for (const [key, child] of Object.entries(rule.properties)) if (key in value) validate(value[key], child, `${location}.${key}`, errors, options);
  if (isObject(value) && rule.patternProperties) for (const [pattern, child] of Object.entries(rule.patternProperties)) for (const [key, childValue] of Object.entries(value)) if (new RegExp(pattern).test(key)) validate(childValue, child, `${location}.${key}`, errors, options);
}

// Return one representative entity from a template without pretending to evaluate CEL.
// This understands both forms used by gallery-template.ts: $repeat + siblings and $repeat + $nested.
function representativeTemplate(node) {
  if (!isObject(node)) return node;
  if (!node.$repeat) return node;
  if (isObject(node.$nested)) return representativeTemplate(node.$nested);
  return Object.fromEntries(Object.entries(node).filter(([key]) => key !== '$repeat' && key !== '$nested'));
}

function validateMeta(meta, location, errors) {
  if (!isObject(meta)) return errors.push(`${location}: must be an object`);
  for (const key of ['name', 'name_en', 'description', 'description_en', 'version', 'author', 'min_version']) if (key in meta && typeof meta[key] !== 'string') errors.push(`${location}.${key}: must be a string`);
  if ('tags' in meta && (!Array.isArray(meta.tags) || meta.tags.some((tag) => typeof tag !== 'string'))) errors.push(`${location}.tags: must be an array of strings`);
}

function validateParameters(parameters, location, errors) {
  if (!Array.isArray(parameters)) return errors.push(`${location}: must be an array`);
  const names = new Set();
  const types = new Set(['integer', 'string', 'integer[]', 'object[]']);
  parameters.forEach((parameter, index) => {
    const loc = `${location}[${index}]`;
    if (!isObject(parameter)) return errors.push(`${loc}: must be an object`);
    if (typeof parameter.name !== 'string' || !parameter.name.trim()) errors.push(`${loc}.name: must be a non-empty string`);
    else if (names.has(parameter.name)) errors.push(`${loc}.name: duplicate parameter '${parameter.name}'`); else names.add(parameter.name);
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
  if (discovery.inference !== undefined && (!isObject(discovery.inference) || !['max', 'count', 'unique_tuples', 'grouped'].includes(discovery.inference.strategy))) errors.push(`${location}.inference.strategy: invalid strategy`);
}

function validateTrigger(trigger, location, errors) {
  if (!isObject(trigger)) return errors.push(`${location}: must be an object`);
  if (!['state', 'packet', 'schedule', 'startup'].includes(trigger.type)) return errors.push(`${location}.type: invalid trigger type`);
  if (trigger.type === 'state' && typeof trigger.entity_id !== 'string') errors.push(`${location}.entity_id: required string`);
  if (trigger.type === 'packet' && !isObject(trigger.match)) errors.push(`${location}.match: required object`);
  if (trigger.type === 'schedule' && trigger.every === undefined && typeof trigger.cron !== 'string') errors.push(`${location}: schedule requires every or cron`);
  if (trigger.guard !== undefined && typeof trigger.guard !== 'string') errors.push(`${location}.guard: must be a string`);
}

const ACTIONS = new Set(['command', 'publish', 'log', 'delay', 'script', 'update_state', 'send_packet', 'if', 'repeat', 'wait_until', 'choose', 'stop']);
function validateAction(action, location, errors) {
  if (!isObject(action)) return errors.push(`${location}: must be an object`);
  if (!ACTIONS.has(action.action)) return errors.push(`${location}.action: invalid action '${action.action}'`);
  if (action.action === 'command' && typeof action.target !== 'string') errors.push(`${location}.target: required string`);
  if (action.action === 'publish' && typeof action.topic !== 'string') errors.push(`${location}.topic: required string`);
  if (action.action === 'log' && typeof action.message !== 'string') errors.push(`${location}.message: required string`);
  if (action.action === 'script' && typeof action.script !== 'string' && typeof action.code !== 'string') errors.push(`${location}: script or code is required`);
  if (action.action === 'update_state' && (typeof action.target_id !== 'string' || !isObject(action.state))) errors.push(`${location}: target_id and state are required`);
  if (action.action === 'send_packet' && !Array.isArray(action.data) && typeof action.data !== 'string') errors.push(`${location}.data: required byte array or expression string`);
  if (action.action === 'if') {
    if (typeof action.condition !== 'string') errors.push(`${location}.condition: required string`);
    if (!Array.isArray(action.then)) errors.push(`${location}.then: required array`); else action.then.forEach((item, i) => validateAction(item, `${location}.then[${i}]`, errors));
    if (action.else !== undefined) if (!Array.isArray(action.else)) errors.push(`${location}.else: must be an array`); else action.else.forEach((item, i) => validateAction(item, `${location}.else[${i}]`, errors));
  }
  if (action.action === 'repeat') {
    if (!Array.isArray(action.actions)) errors.push(`${location}.actions: required array`); else action.actions.forEach((item, i) => validateAction(item, `${location}.actions[${i}]`, errors));
  }
  if (action.action === 'wait_until' && typeof action.condition !== 'string') errors.push(`${location}.condition: required string`);
  if (action.action === 'choose') {
    if (!Array.isArray(action.choices)) errors.push(`${location}.choices: required array`); else action.choices.forEach((choice, i) => {
      if (!isObject(choice) || typeof choice.condition !== 'string' || !Array.isArray(choice.then)) errors.push(`${location}.choices[${i}]: requires condition and then`);
      else choice.then.forEach((item, j) => validateAction(item, `${location}.choices[${i}].then[${j}]`, errors));
    });
    if (action.default !== undefined) if (!Array.isArray(action.default)) errors.push(`${location}.default: must be an array`); else action.default.forEach((item, i) => validateAction(item, `${location}.default[${i}]`, errors));
  }
}

function validateAutomation(item, location, errors) {
  if (!isObject(item)) return errors.push(`${location}: must be an object`);
  if (typeof item.id !== 'string' || !item.id.trim()) errors.push(`${location}.id: required non-empty string`);
  if (!Array.isArray(item.trigger)) errors.push(`${location}.trigger: required array`); else item.trigger.forEach((trigger, i) => validateTrigger(trigger, `${location}.trigger[${i}]`, errors));
  if ('then' in item && 'actions' in item) errors.push(`${location}: 'then' and deprecated 'actions' cannot both be defined`);
  const actions = item.then ?? item.actions;
  if (!Array.isArray(actions)) errors.push(`${location}.then: required array`); else actions.forEach((action, i) => validateAction(action, `${location}.then[${i}]`, errors));
  if (item.else !== undefined) if (!Array.isArray(item.else)) errors.push(`${location}.else: must be an array`); else item.else.forEach((action, i) => validateAction(action, `${location}.else[${i}]`, errors));
}

function validateScript(item, location, errors) {
  if (!isObject(item)) return errors.push(`${location}: must be an object`);
  if (typeof item.id !== 'string' || !item.id.trim()) errors.push(`${location}.id: required non-empty string`);
  if (!Array.isArray(item.actions)) errors.push(`${location}.actions: required array`); else item.actions.forEach((action, i) => validateAction(action, `${location}.actions[${i}]`, errors));
  if (item.args !== undefined) {
    if (!isObject(item.args)) errors.push(`${location}.args: must be an object`);
    else for (const [name, arg] of Object.entries(item.args)) {
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
  if (document.meta === undefined) errors.push(`${relative}: missing required gallery 'meta'`); else validateMeta(document.meta, `${relative}.meta`, errors);
  if (document.parameters !== undefined) validateParameters(document.parameters, `${relative}.parameters`, errors);
  if (document.discovery !== undefined) validateDiscovery(document.discovery, `${relative}.discovery`, errors);

  if (document.entities !== undefined) {
    if (!isObject(document.entities)) errors.push(`${relative}.entities: must be an object`);
    else for (const [type, items] of Object.entries(document.entities)) {
      if (!ENTITY_TYPES.has(type)) { errors.push(`${relative}.entities.${type}: unknown entity type`); continue; }
      if (!Array.isArray(items)) { errors.push(`${relative}.entities.${type}: must be an array`); continue; }
      const definitionName = type === 'text_sensor' ? 'TextSensorEntity' : type === 'binary_sensor' ? 'BinarySensorEntity' : `${type[0].toUpperCase()}${type.slice(1)}Entity`;
      const definition = schema.definitions[definitionName];
      if (!definition) { errors.push(`${relative}.entities.${type}: schema definition not found`); continue; }
      items.forEach((item, index) => {
        const normalized = representativeTemplate(item);
        validate(normalized, definition, `${relative}.entities.${type}[${index}]`, errors, { allowTemplate: true, allowExpressionString: true });
        if (!isObject(normalized) || typeof normalized.id !== 'string' || !normalized.id.trim()) errors.push(`${relative}.entities.${type}[${index}].id: required non-empty string`);
      });
    }
  }

  if (document.automation !== undefined) {
    if (!Array.isArray(document.automation)) errors.push(`${relative}.automation: must be an array`); else document.automation.forEach((item, index) => validateAutomation(item, `${relative}.automation[${index}]`, errors));
  }
  if (document.scripts !== undefined) {
    if (!Array.isArray(document.scripts)) errors.push(`${relative}.scripts: must be an array`); else document.scripts.forEach((item, index) => validateScript(item, `${relative}.scripts[${index}]`, errors));
  }
  return errors;
}

const files = [];
function walk(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(file); else if (/\.ya?ml$/.test(entry.name)) files.push(file);
  }
}
walk(GALLERY_DIR); files.sort();
let failures = 0;
for (const file of files) {
  const errors = validateFile(file);
  if (errors.length) { failures += errors.length; errors.forEach((error) => console.error(`✗ ${error}`)); }
  else console.log(`✓ ${path.relative(ROOT, file)}`);
}
console.log(`\nValidated ${files.length} gallery YAML files: ${failures === 0 ? 'PASS' : `${failures} error(s)`}`);
process.exitCode = failures ? 1 : 0;

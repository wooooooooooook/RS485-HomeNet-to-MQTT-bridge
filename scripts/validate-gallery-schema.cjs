const fs = require('node:fs');
const path = require('node:path');
const yaml = require('js-yaml');

const ROOT = path.resolve(__dirname, '..');
const GALLERY_DIR = path.join(ROOT, 'gallery');
const schema = JSON.parse(
  fs.readFileSync(path.join(ROOT, 'packages/core/static/schema/homenet-bridge.schema.json'), 'utf8'),
);
const TEMPLATE_RE = /{{\s*[^}]+\s*}}/;
const EXPRESSION_KEY_RE = /^(state_|command_|data$|ack$)/;
const ENTITY_TYPES = [
  'light', 'climate', 'valve', 'button', 'sensor', 'fan', 'switch', 'lock',
  'number', 'select', 'text_sensor', 'text', 'binary_sensor',
];

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const isTemplate = (value) => typeof value === 'string' && TEMPLATE_RE.test(value);

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
  if (options.allowExpressionString && typeof value === 'string' && EXPRESSION_KEY_RE.test(property)) return;

  if (rule.anyOf) {
    if (rule.anyOf.some((branch) => {
      const local = [];
      validate(value, branch, location, local, options);
      return local.length === 0;
    })) return;
    if (options.allowTemplate && isTemplate(value)) return;
    errors.push(`${location}: does not match any allowed schema branch`);
    return;
  }

  if (rule.oneOf) {
    const matches = rule.oneOf.filter((branch) => {
      const local = [];
      validate(value, branch, location, local, options);
      return local.length === 0;
    }).length;
    if (matches !== 1) errors.push(`${location}: expected exactly one schema branch, matched ${matches}`);
    return;
  }

  if (rule.const !== undefined && value !== rule.const) {
    errors.push(`${location}: must equal ${JSON.stringify(rule.const)}`);
    return;
  }
  if (rule.enum && !rule.enum.includes(value)) {
    errors.push(`${location}: invalid value ${JSON.stringify(value)}`);
    return;
  }

  if (rule.type) {
    const types = Array.isArray(rule.type) ? rule.type : [rule.type];
    if (!types.some((type) => matchesType(value, type))) {
      if (options.allowTemplate && isTemplate(value)) return;
      errors.push(`${location}: expected ${types.join(' or ')}, got ${Array.isArray(value) ? 'array' : typeof value}`);
      return;
    }
  }

  if (rule.items && Array.isArray(value)) value.forEach((item, i) => validate(item, rule.items, `${location}[${i}]`, errors, options));
  if (isObject(value) && rule.required) for (const key of rule.required) if (!(key in value)) errors.push(`${location}: missing required property '${key}'`);
  if (isObject(value) && rule.properties) for (const [key, child] of Object.entries(rule.properties)) if (key in value) validate(value[key], child, `${location}.${key}`, errors, options);
  if (isObject(value) && rule.patternProperties) {
    for (const [pattern, child] of Object.entries(rule.patternProperties)) {
      const re = new RegExp(pattern);
      for (const [key, childValue] of Object.entries(value)) if (re.test(key)) validate(childValue, child, `${location}.${key}`, errors, options);
    }
  }
}

function normalizeTemplateItem(item) {
  if (!isObject(item)) return item;
  if (!isObject(item.$repeat)) return item;
  return Object.fromEntries(Object.entries(item).filter(([key]) => key !== '$repeat'));
}

function validateMeta(meta, location, errors) {
  if (!isObject(meta)) return errors.push(`${location}: must be an object`);
  for (const key of ['name', 'name_en', 'description', 'description_en', 'version', 'author', 'min_version']) {
    if (key in meta && typeof meta[key] !== 'string') errors.push(`${location}.${key}: must be a string`);
  }
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
  if (discovery.inference !== undefined && (!isObject(discovery.inference) || !['max', 'count', 'unique_tuples', 'grouped'].includes(discovery.inference.strategy))) errors.push(`${location}.inference.strategy: invalid strategy`);
}

function validateFile(filePath) {
  const relative = path.relative(ROOT, filePath);
  let document;
  try {
    document = yaml.load(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    return [`${relative}: YAML parse error: ${error.message}`];
  }
  if (!isObject(document)) return [`${relative}: document must be a YAML object`];

  const errors = [];
  if (document.meta === undefined) errors.push(`${relative}: missing required gallery 'meta'`);
  else validateMeta(document.meta, `${relative}.meta`, errors);
  if (document.parameters !== undefined) validateParameters(document.parameters, `${relative}.parameters`, errors);
  if (document.discovery !== undefined) validateDiscovery(document.discovery, `${relative}.discovery`, errors);

  if (document.entities !== undefined) {
    if (!isObject(document.entities)) errors.push(`${relative}.entities: must be an object`);
    else for (const [type, items] of Object.entries(document.entities)) {
      if (!ENTITY_TYPES.includes(type)) { errors.push(`${relative}.entities.${type}: unknown entity type`); continue; }
      if (!Array.isArray(items)) { errors.push(`${relative}.entities.${type}: must be an array`); continue; }
      const definitionName = type === 'text_sensor' ? 'TextSensorEntity' : type === 'binary_sensor' ? 'BinarySensorEntity' : `${type[0].toUpperCase()}${type.slice(1)}Entity`;
      const definition = schema.definitions[definitionName];
      if (!definition) { errors.push(`${relative}.entities.${type}: schema definition not found`); continue; }
      items.forEach((item, index) => {
        const normalized = normalizeTemplateItem(item);
        validate(normalized, definition, `${relative}.entities.${type}[${index}]`, errors, { allowTemplate: true, allowExpressionString: true });
        if (!isObject(normalized) || typeof normalized.id !== 'string' || !normalized.id.trim()) errors.push(`${relative}.entities.${type}[${index}].id: required non-empty string`);
      });
    }
  }

  if (document.automation !== undefined) {
    if (!Array.isArray(document.automation)) errors.push(`${relative}.automation: must be an array`);
    else document.automation.forEach((item, index) => {
      if (!isObject(item)) return errors.push(`${relative}.automation[${index}]: must be an object`);
      if ('then' in item && 'actions' in item) errors.push(`${relative}.automation[${index}]: 'then' and deprecated 'actions' cannot both be defined`);
      const normalized = 'then' in item ? item : ('actions' in item ? { ...item, then: item.actions } : item);
      validate(normalized, schema.definitions.AutomationConfig, `${relative}.automation[${index}]`, errors, { allowTemplate: true, allowExpressionString: true });
      if (typeof normalized.id !== 'string' || !normalized.id.trim()) errors.push(`${relative}.automation[${index}].id: required non-empty string`);
    });
  }

  if (document.scripts !== undefined) {
    if (!Array.isArray(document.scripts)) errors.push(`${relative}.scripts: must be an array`);
    else document.scripts.forEach((item, index) => {
      validate(item, schema.definitions.ScriptConfig, `${relative}.scripts[${index}]`, errors, { allowTemplate: true, allowExpressionString: true });
      if (!isObject(item) || typeof item.id !== 'string' || !item.id.trim()) errors.push(`${relative}.scripts[${index}].id: required non-empty string`);
    });
  }

  return errors;
}

const files = [];
function walk(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(file);
    else if (/\.ya?ml$/.test(entry.name)) files.push(file);
  }
}
walk(GALLERY_DIR);
files.sort();

let failures = 0;
for (const file of files) {
  const errors = validateFile(file);
  if (errors.length) {
    failures += errors.length;
    errors.forEach((error) => console.error(`✗ ${error}`));
  } else {
    console.log(`✓ ${path.relative(ROOT, file)}`);
  }
}

console.log(`\nValidated ${files.length} gallery YAML files: ${failures === 0 ? 'PASS' : `${failures} error(s)`}`);
process.exitCode = failures ? 1 : 0;

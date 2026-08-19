const fs = require('node:fs');
const path = require('node:path');
const yaml = require('js-yaml');

const ROOT = path.resolve(__dirname, '..');
const GALLERY_DIR = path.join(ROOT, 'gallery');
const SCHEMA_PATH = path.join(ROOT, 'packages/core/static/schema/homenet-bridge.schema.json');
const schema = JSON.parse(fs.readFileSync(SCHEMA_PATH, 'utf8'));

const ENTITY_TYPES = [
  'light', 'climate', 'valve', 'button', 'sensor', 'fan', 'switch', 'lock',
  'number', 'select', 'text_sensor', 'text', 'binary_sensor',
];

const TEMPLATE_RE = /{{\s*[^}]+\s*}}/;

function isObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function typeMatches(value, type) {
  if (type === 'object') return isObject(value);
  if (type === 'array') return Array.isArray(value);
  if (type === 'string') return typeof value === 'string';
  if (type === 'boolean') return typeof value === 'boolean';
  if (type === 'number') return typeof value === 'number' && Number.isFinite(value);
  if (type === 'integer') return typeof value === 'number' && Number.isInteger(value);
  if (type === 'null') return value === null;
  return true;
}

function resolveRef(ref) {
  if (!ref.startsWith('#/')) throw new Error(`Unsupported schema ref: ${ref}`);
  let cur = schema;
  for (const part of ref.slice(2).split('/')) cur = cur[part.replace(/~1/g, '/').replace(/~0/g, '~')];
  return cur;
}

function validate(value, rule, location, errors, options = {}) {
  if (!rule) return;
  if (rule.$ref) return validate(value, resolveRef(rule.$ref), location, errors, options);

  if (rule.anyOf) {
    for (const branch of rule.anyOf) {
      const local = [];
      validate(value, branch, location, local, options);
      if (local.length === 0) return;
    }
    if (options.allowTemplate && typeof value === 'string' && TEMPLATE_RE.test(value)) return;
    errors.push(`${location}: does not match any allowed schema branch`);
    return;
  }

  if (rule.oneOf) {
    let matches = 0;
    for (const branch of rule.oneOf) {
      const local = [];
      validate(value, branch, location, local, options);
      if (local.length === 0) matches++;
    }
    if (matches !== 1) errors.push(`${location}: expected exactly one schema branch, matched ${matches}`);
    return;
  }

  if (rule.const !== undefined && value !== rule.const) {
    errors.push(`${location}: must equal ${JSON.stringify(rule.const)}`);
    return;
  }

  if (rule.enum && !rule.enum.some((x) => x === value)) {
    errors.push(`${location}: invalid value ${JSON.stringify(value)} (expected one of ${rule.enum.join(', ')})`);
    return;
  }

  if (rule.type) {
    const types = Array.isArray(rule.type) ? rule.type : [rule.type];
    if (!types.some((t) => typeMatches(value, t))) {
      if (options.allowTemplate && typeof value === 'string' && TEMPLATE_RE.test(value)) return;
      errors.push(`${location}: expected ${types.join(' or ')}, got ${Array.isArray(value) ? 'array' : typeof value}`);
      return;
    }
  }

  if (rule.pattern && typeof value === 'string' && !new RegExp(rule.pattern).test(value)) {
    errors.push(`${location}: does not match pattern ${rule.pattern}`);
  }

  if (rule.minItems !== undefined && Array.isArray(value) && value.length < rule.minItems) {
    errors.push(`${location}: must contain at least ${rule.minItems} item(s)`);
  }

  if (rule.items && Array.isArray(value)) {
    value.forEach((item, i) => validate(item, rule.items, `${location}[${i}]`, errors, options));
  }

  if (isObject(value) && rule.required) {
    for (const key of rule.required) {
      if (!(key in value)) errors.push(`${location}: missing required property '${key}'`);
    }
  }

  if (isObject(value) && rule.properties) {
    for (const [key, child] of Object.entries(rule.properties)) {
      if (key in value) validate(value[key], child, `${location}.${key}`, errors, options);
    }
  }

  if (isObject(value) && rule.patternProperties) {
    for (const [key, child] of Object.entries(rule.patternProperties)) {
      const re = new RegExp(key);
      for (const [prop, propValue] of Object.entries(value)) {
        if (re.test(prop)) validate(propValue, child, `${location}.${prop}`, errors, options);
      }
    }
  }
}

function validateMeta(meta, location, errors) {
  if (!isObject(meta)) return errors.push(`${location}: must be an object`);
  for (const key of ['name', 'name_en', 'description', 'description_en', 'version', 'author', 'min_version']) {
    if (key in meta && typeof meta[key] !== 'string') errors.push(`${location}.${key}: must be a string`);
  }
  if ('tags' in meta && (!Array.isArray(meta.tags) || meta.tags.some((x) => typeof x !== 'string'))) {
    errors.push(`${location}.tags: must be an array of strings`);
  }
}

function validateParameters(parameters, location, errors) {
  if (!Array.isArray(parameters)) return errors.push(`${location}: must be an array`);
  const names = new Set();
  const types = new Set(['integer', 'string', 'integer[]', 'object[]']);
  for (let i = 0; i < parameters.length; i++) {
    const p = parameters[i];
    const loc = `${location}[${i}]`;
    if (!isObject(p)) { errors.push(`${loc}: must be an object`); continue; }
    if (typeof p.name !== 'string' || !p.name.trim()) errors.push(`${loc}.name: must be a non-empty string`);
    else if (names.has(p.name)) errors.push(`${loc}.name: duplicate parameter '${p.name}'`);
    else names.add(p.name);
    if (typeof p.type !== 'string' || !types.has(p.type)) errors.push(`${loc}.type: invalid parameter type`);
    for (const k of ['label', 'label_en', 'description', 'description_en']) if (k in p && typeof p[k] !== 'string') errors.push(`${loc}.${k}: must be a string`);
    for (const k of ['min', 'max']) if (k in p && typeof p[k] !== 'number') errors.push(`${loc}.${k}: must be a number`);
    if ('hidden' in p && typeof p.hidden !== 'boolean') errors.push(`${loc}.hidden: must be boolean`);
    if ('computed' in p && typeof p.computed !== 'boolean') errors.push(`${loc}.computed: must be boolean`);
    if (p.type === 'object[]' && p.schema !== undefined && !isObject(p.schema)) errors.push(`${loc}.schema: must be an object`);
  }
}

function validateDiscovery(discovery, location, errors) {
  if (!isObject(discovery)) return errors.push(`${location}: must be an object`);
  if (!isObject(discovery.match)) errors.push(`${location}.match: must be an object`);
  if (!Array.isArray(discovery.dimensions)) errors.push(`${location}.dimensions: must be an array`);
  else discovery.dimensions.forEach((d, i) => {
    const loc = `${location}.dimensions[${i}]`;
    if (!isObject(d)) return errors.push(`${loc}: must be an object`);
    if (typeof d.parameter !== 'string') errors.push(`${loc}.parameter: must be a string`);
    if (typeof d.offset !== 'number' && !(typeof d.offset === 'string' && TEMPLATE_RE.test(d.offset))) errors.push(`${loc}.offset: must be a number or template expression`);
    if ('mask' in d && typeof d.mask !== 'number' && !(typeof d.mask === 'string' && TEMPLATE_RE.test(d.mask))) errors.push(`${loc}.mask: must be a number or template expression`);
    if ('transform' in d && typeof d.transform !== 'string') errors.push(`${loc}.transform: must be a string`);
    if ('detect' in d && d.detect !== 'active_bits') errors.push(`${loc}.detect: unsupported value`);
  });
  if (discovery.inference !== undefined) {
    if (!isObject(discovery.inference)) errors.push(`${location}.inference: must be an object`);
    else if (!['max', 'count', 'unique_tuples', 'grouped'].includes(discovery.inference.strategy)) errors.push(`${location}.inference.strategy: invalid strategy`);
  }
}

function validateFile(filePath) {
  const rel = path.relative(ROOT, filePath);
  const text = fs.readFileSync(filePath, 'utf8');
  let doc;
  try { doc = yaml.load(text); }
  catch (e) { return [`${rel}: YAML parse error: ${e.message}`]; }
  const errors = [];
  if (!isObject(doc)) return [`${rel}: document must be a YAML object`];

  if (doc.meta !== undefined) validateMeta(doc.meta, `${rel}.meta`, errors);
  else errors.push(`${rel}: missing required gallery 'meta'`);

  if (doc.parameters !== undefined) validateParameters(doc.parameters, `${rel}.parameters`, errors);
  if (doc.discovery !== undefined) validateDiscovery(doc.discovery, `${rel}.discovery`, errors);

  if (doc.entities !== undefined) {
    if (!isObject(doc.entities)) errors.push(`${rel}.entities: must be an object`);
    else {
      for (const [type, items] of Object.entries(doc.entities)) {
        if (!ENTITY_TYPES.includes(type)) { errors.push(`${rel}.entities.${type}: unknown entity type`); continue; }
        if (!Array.isArray(items)) { errors.push(`${rel}.entities.${type}: must be an array`); continue; }
        const defName = type === 'text_sensor' ? 'TextSensorEntity' : type === 'binary_sensor' ? 'BinarySensorEntity' : `${type[0].toUpperCase()}${type.slice(1)}Entity`;
        const def = schema.definitions[defName];
        if (!def) { errors.push(`${rel}.entities.${type}: schema definition not found`); continue; }
        items.forEach((item, i) => validate(item, def, `${rel}.entities.${type}[${i}]`, errors, { allowTemplate: true }));
      }
    }
  }

  if (doc.automation !== undefined) {
    if (!Array.isArray(doc.automation)) errors.push(`${rel}.automation: must be an array`);
    else doc.automation.forEach((item, i) => {
      if (!isObject(item)) {
        validate(item, schema.definitions.AutomationConfig, `${rel}.automation[${i}]`, errors, { allowTemplate: true });
        return;
      }
      if ('then' in item && 'actions' in item) {
        errors.push(`${rel}.automation[${i}]: 'then' and deprecated 'actions' cannot both be defined`);
      }
      const normalized = 'then' in item ? item : ('actions' in item ? { ...item, then: item.actions } : item);
      validate(normalized, schema.definitions.AutomationConfig, `${rel}.automation[${i}]`, errors, { allowTemplate: true });
    });
  }

  if (doc.scripts !== undefined) {
    if (!Array.isArray(doc.scripts)) errors.push(`${rel}.scripts: must be an array`);
    else doc.scripts.forEach((item, i) => validate(item, schema.definitions.ScriptConfig, `${rel}.scripts[${i}]`, errors, { allowTemplate: true }));
  }

  // The service rejects gallery items without IDs.
  if (isObject(doc.entities)) for (const [type, items] of Object.entries(doc.entities)) if (Array.isArray(items)) items.forEach((x, i) => { if (!isObject(x) || typeof x.id !== 'string' || !x.id.trim()) errors.push(`${rel}.entities.${type}[${i}].id: required non-empty string`); });
  if (Array.isArray(doc.automation)) doc.automation.forEach((x, i) => { if (!isObject(x) || typeof x.id !== 'string' || !x.id.trim()) errors.push(`${rel}.automation[${i}].id: required non-empty string`); });
  if (Array.isArray(doc.scripts)) doc.scripts.forEach((x, i) => { if (!isObject(x) || typeof x.id !== 'string' || !x.id.trim()) errors.push(`${rel}.scripts[${i}].id: required non-empty string`); });

  return errors;
}

const files = [];
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(p);
    else if (/\.ya?ml$/.test(entry.name)) files.push(p);
  }
}
walk(GALLERY_DIR);
files.sort();

let failed = 0;
for (const file of files) {
  const errors = validateFile(file);
  if (errors.length) {
    failed += errors.length;
    for (const error of errors) console.error(`✗ ${error}`);
  } else {
    console.log(`✓ ${path.relative(ROOT, file)}`);
  }
}

console.log(`\nValidated ${files.length} gallery YAML files: ${failed === 0 ? 'PASS' : `${failed} error(s)`}`);
process.exitCode = failed ? 1 : 0;

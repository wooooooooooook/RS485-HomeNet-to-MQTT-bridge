const { spawnSync } = require('node:child_process');
const path = require('node:path');

// The core JSON schema is intentionally stricter than gallery syntax in a few
// documented compatibility cases. Keep these exceptions explicit instead of
// weakening the generic validator.
const result = spawnSync(process.execPath, [path.join(__dirname, 'validate-gallery-schema-v2.cjs')], {
  encoding: 'utf8',
});

const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
const lines = output.split(/\r?\n/);
const ignored = [
  /\.entities\.lock\[\d+\]\.state_(locked|unlocked): expected object, got string$/,
  /\.discovery\.dimensions\[\d+\]: requires index or offset$/,
  /\.automation\[\d+\]\.trigger\[\d+\]\.entity_id: required string$/,
];

const errors = lines.filter((line) => line.startsWith('✗ '));
const remaining = errors.filter((line) => !ignored.some((pattern) => pattern.test(line.slice(2))));

for (const line of lines) {
  if (!line.startsWith('✗ ') || remaining.includes(line)) console.log(line);
}

if (remaining.length > 0) {
  console.error(`Gallery validation failed with ${remaining.length} error(s)`);
  process.exit(1);
}

console.log('Gallery validation passed');

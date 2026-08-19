import fs from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config/index.js';

const EXAMPLES_DIR = path.resolve(process.cwd(), 'packages/core/config/examples');

async function getExampleFiles() {
  const entries = await fs.readdir(EXAMPLES_DIR, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && /\.ya?ml$/i.test(entry.name))
    .map((entry) => path.join(EXAMPLES_DIR, entry.name))
    .sort();
}

describe('core config examples', () => {
  it('loads every example configuration successfully', async () => {
    const files = await getExampleFiles();
    expect(files.length).toBeGreaterThan(0);

    for (const file of files) {
      await expect(loadConfig(file), path.basename(file)).resolves.toBeDefined();
    }
  });
});

#!/usr/bin/env node

/**
 * Sync versions from root package.json to all packages in the monorepo.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

function syncVersions() {
  const rootPkgPath = path.join(rootDir, 'package.json');
  if (!fs.existsSync(rootPkgPath)) {
    console.error('Root package.json not found');
    process.exit(1);
  }

  const rootPkg = JSON.parse(fs.readFileSync(rootPkgPath, 'utf8'));
  const version = rootPkg.version;

  console.log(`Syncing version ${version} to all packages...`);

  const packagesDir = path.join(rootDir, 'packages');
  const packages = fs.readdirSync(packagesDir);

  for (const pkgName of packages) {
    const pkgPath = path.join(packagesDir, pkgName, 'package.json');
    if (fs.existsSync(pkgPath)) {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      if (pkg.version !== version) {
        console.log(`- Updating ${pkg.name}: ${pkg.version} -> ${version}`);
        pkg.version = version;
        fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8');
      } else {
        console.log(`- ${pkg.name} is already at version ${version}`);
      }
    }
  }

  console.log('Done!');
}

syncVersions();

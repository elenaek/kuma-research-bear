#!/usr/bin/env node

/**
 * Sync version from package.json to manifest.json and constants/index.ts
 *
 * Usage: node scripts/sync-version.js
 *
 * This script reads the version from package.json and updates:
 * - src/manifest.json
 * - src/shared/constants/index.ts
 */

import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, '..');

// Read version from package.json
const packageJson = JSON.parse(readFileSync(join(rootDir, 'package.json'), 'utf8'));
const version = packageJson.version;

console.log(`📦 Syncing version: ${version}`);

// Update src/manifest.json
const manifestPath = join(rootDir, 'src', 'manifest.json');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
manifest.version = version;
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
console.log('✓ Updated src/manifest.json');

// Update src/shared/constants/index.ts
const constantsPath = join(rootDir, 'src', 'shared', 'constants', 'index.ts');
let constants = readFileSync(constantsPath, 'utf8');

// Replace the EXTENSION_VERSION line
constants = constants.replace(
  /export const EXTENSION_VERSION = ['"][\d.]+['"];/,
  `export const EXTENSION_VERSION = '${version}';`
);

writeFileSync(constantsPath, constants, 'utf8');
console.log('✓ Updated src/shared/constants/index.ts');

console.log('✨ Version sync complete!');

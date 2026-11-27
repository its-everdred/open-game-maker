#!/usr/bin/env node
import { stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { buildIndex, writeIndex } from '../dist/index.js';

const root = resolve(process.argv.slice(2).find((argument) => argument !== '--') ?? fileURLToPath(new URL('../../../assets-local', import.meta.url)));
const packs = await stat(join(root, 'packs')).catch(() => null);
if (!packs?.isDirectory()) throw new Error(`asset root must contain an existing packs directory: ${join(root, 'packs')}`);
const index = await buildIndex(root);
if (index.errors.length) {
  for (const error of index.errors) {
    process.stderr.write(`WARNING: skipped invalid card ${error.path}: ${error.errors.join('; ')}\n`);
  }
  process.stderr.write(`WARNING: ${index.errors.length} invalid card(s) skipped from the asset index\n`);
}
const output = await writeIndex(root, index);
process.stdout.write(`${index.cards.length} cards, ${index.errors.length} errors -> ${output}\n`);

#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';

const entry = new URL('../dist/bin/validate-cards.js', import.meta.url);
if (!existsSync(entry)) {
  console.error('validate-cards: build output missing; run: pnpm --filter @ogm/contracts build');
  process.exit(2);
}

const { run } = await import(entry.href);
let args = process.argv.slice(2);
if (args.includes('--paths-stdin')) {
  try {
    const paths = JSON.parse(readFileSync(0, 'utf8'));
    if (!Array.isArray(paths) || paths.some((path) => typeof path !== 'string'))
      throw new Error('expected an array of paths');
    args = [...args.filter((arg) => arg !== '--paths-stdin'), ...paths];
  } catch (error) {
    console.error(`validate-cards: invalid path list: ${error.message}`);
    process.exit(2);
  }
}
process.exitCode = run(args);

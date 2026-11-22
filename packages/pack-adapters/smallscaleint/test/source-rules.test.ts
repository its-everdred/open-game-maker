import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { findBlockedThemeWords } from '../../../gm-cli/src/skills/card-format.js';
import * as adapter from '../src/index.js';

const SRC = join(import.meta.dirname, '../src');
const sources = readdirSync(SRC)
  .filter((name) => name.endsWith('.ts'))
  .map((name) => ({ name, text: readFileSync(join(SRC, name), 'utf8') }));

describe('adapter source rules', () => {
  it('never names the private asset folder', () => {
    expect(sources.filter(({ text }) => text.includes('assets-local')).map(({ name }) => name)).toEqual([]);
  });

  it('exports role names, not fiction', () => {
    expect(findBlockedThemeWords(Object.keys(adapter))).toEqual([]);
  });

  it('loads in a browser: runtime contract imports come from @ogm/contracts/browser', () => {
    // The root entry reads files with node:fs; a game bundle importing it fails before its first frame.
    const runtimeRootImport = /^import (?!type )[^;]*from '@ogm\/contracts';/m;
    expect(sources.filter(({ text }) => runtimeRootImport.test(text)).map(({ name }) => name)).toEqual([]);
  });

  it('stays deterministic', () => {
    expect(sources.filter(({ text }) => /Math\.random|Date\.now/.test(text)).map(({ name }) => name)).toEqual([]);
  });
});

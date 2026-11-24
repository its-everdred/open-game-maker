import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Linter } from 'eslint';
import { describe, expect, it } from 'vitest';

import { IMPLICIT_GLOBALS } from '../../scripts/effekseer-runtime.mjs';

const runtime = join(dirname(fileURLToPath(import.meta.url)), '../../../../third_party/effekseer/effekseer.min.js');

describe('Effekseer runtime wrapper', () => {
  it('declares every name the vendored script assigns without declaring', () => {
    // As a module the script runs strict, where one undeclared write (splitted_path) threw while loading textures.
    const source = readFileSync(runtime, 'utf8');
    const lines = source.split('\n');
    const leaks = new Linter()
      .verify(source, [
        { languageOptions: { sourceType: 'script', ecmaVersion: 2022 }, rules: { 'no-implicit-globals': 'error' } },
      ])
      .filter((message) => message.messageId === 'globalVariableLeak')
      .map((message) => /^[\w$]+/.exec(lines[message.line - 1]!.slice(message.column - 1))![0]);
    expect([...new Set(leaks)].sort()).toEqual(IMPLICIT_GLOBALS);
  }, 60_000);
});

import { describe, expect, it } from 'vitest';
import { safePublishTestScript } from '../src/publish-test-script.js';

describe('published smoke-test configuration', () => {
  it.each(['gm test', 'gm test --ticks 100 --deadline=20 --json', 'gm test --inputs qa/run.json --out shots/run'])(
    'accepts %s',
    (script) => expect(safePublishTestScript(script)).toBe(true),
  );
  it.each([
    'gm test --help',
    'gm test --serve old-dist',
    'gm test --ticks --help',
    'gm test; true',
    'gm test --out x --serve=other',
  ])('rejects %s', (script) => expect(safePublishTestScript(script)).toBe(false));
});

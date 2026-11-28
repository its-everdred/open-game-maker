import { describe, expect, it } from 'vitest';
import { redactCapabilities } from '../src/qa/redact.js';

describe('QA capability redaction', () => {
  it('removes draft and preview tokens throughout diagnostic output', () => {
    const result = redactCapabilities({
      url: 'http://localhost/d/game/build/secret/index.html',
      errors: ['failed http://localhost/p/game/alias/file.js?x=1'],
    });
    expect(result).toEqual({
      url: 'http://localhost/d/game/build/<redacted>/index.html',
      errors: ['failed http://localhost/p/game/<redacted>/file.js?x=1'],
    });
  });
});

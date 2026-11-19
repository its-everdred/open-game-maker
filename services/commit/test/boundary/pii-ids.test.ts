import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { piiRule } from '../../src/boundary/rules/pii.js';
import type { BoundaryInput } from '../../src/boundary/types.js';

function reasons(content: string) {
  const input: BoundaryInput = {
    mode: 'diff',
    actor: 'agent',
    visibility: 'private',
    draft: true,
    files: [
      { path: 'AGENTS.md', status: 'added', bytes: content.length, sha256: '0'.repeat(64), binary: false, content },
    ],
    lockfile: null,
    blocklist: new Set(),
    profileNames: [],
  };
  return piiRule(input);
}

describe('phone detection in generated IDs', () => {
  it('accepts 10,000 generated game IDs in the actual template', () => {
    const template = readFileSync(
      new URL('../../../../packages/game-repo-template/templates/AGENTS.md', import.meta.url),
      'utf8',
    );
    const [heading, ...rest] = template.split('\n');
    const content = [
      ...Array.from({ length: 10_000 }, () => heading!.replaceAll('{{gameId}}', `g_${randomUUID()}`)),
      ...rest,
    ].join('\n');
    expect(reasons(content)).toEqual([]);
  }, 30_000);

  it.each(['+1 555 123 4567', '(555) 123-4567', '555-123-4567'])('still detects %s', (phone) => {
    expect(reasons(`Contact ${phone}`)).toEqual([
      expect.objectContaining({ detail: expect.stringContaining('phone number') }),
    ]);
  });

  it('detects a phone followed immediately by sentence punctuation', () => {
    expect(reasons('Call 555-123-4567.Thanks')).toHaveLength(1);
    expect(reasons('Call 555-123-4567.Dad')).toHaveLength(1);
  });

  it('ignores identifier tokens while detecting a phone on the same line', () => {
    expect(reasons('g_ece14169-0893-4659-bd44-37f0ee0e510e and 555-123-4567')).toHaveLength(1);
    expect(reasons('id abc14169-0893-4659 and 14169_0893-4659')).toEqual([]);
    expect(reasons('ece14169-0893-4659-bd44-37f0ee0e510e')).toEqual([]);
    expect(reasons('14169.0893-4659')).toEqual([]);
    expect(reasons('abc.14169-0893-4659')).toEqual([]);
    expect(reasons('1abc.14169-0893-4659')).toEqual([]);
    expect(reasons('g_abc.14169-0893-4659')).toEqual([]);
    expect(reasons('14169.0893-4659.')).toEqual([]);
    expect(reasons('14169-0893-4659.abc')).toEqual([]);
  });
});

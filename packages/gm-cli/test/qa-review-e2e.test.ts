import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { NOTE, PICK_NOTE, reached, type Report } from '../src/qa-review-e2e.js';
import { gm, tempDir } from './helpers.js';

function host(qa: string) {
  const home = tempDir();
  const env = join(home, '.config', 'ogm', 'env');
  mkdirSync(env, { recursive: true });
  writeFileSync(
    join(env, 'api.env'),
    'OGM_APP_ORIGIN=https://app.example.test\nOGM_API_PORT=4300\nOGM_INTERNAL_TOKEN=t\n',
  );
  if (qa) writeFileSync(join(env, 'qa.env'), qa);
  return home;
}

describe('gm qa review-e2e', () => {
  // The deploy hook reads the last line, so a host that cannot run the E2E still ends with a failing exit line.
  it('fails with its exit line when the host has no QA session', async () => {
    const { code, out, err } = await gm(['qa', 'review-e2e'], { home: host('') });
    expect(code).toBe(1);
    expect(out.at(-1)).toBe('exit=1 qa-review-e2e');
    expect(err.join('\n')).toContain('ops/bin/ogm-qa-session');
  });

  it('fails with its exit line when the QA session has expired', async () => {
    const qa =
      'OGM_QA_SESSION_COOKIE_NAME=s\nOGM_QA_SESSION_COOKIE=v\nOGM_QA_SESSION_EXPIRES=2020-01-01T00:00:00.000Z\n';
    const { code, out, err } = await gm(['qa', 'review-e2e'], { home: host(qa) });
    expect(code).toBe(1);
    expect(out.at(-1)).toBe('exit=1 qa-review-e2e');
    expect(err.join('\n')).toContain('expired');
  });
});

describe('verdicts reaching aiur', () => {
  const delivered: Report = {
    round: { verdict: 'needs_work', notes: NOTE, dispatch: 'delivered' },
    received: [
      { kind: 'answer', response: JSON.stringify({ answers: [{ option_id: 'b' }], notes: PICK_NOTE }) },
      { kind: 'rework', reason: `<!-- marker -->\n${NOTE}` },
    ],
  };

  it('passes only when the round note and the Command pick with its note both arrived', () => {
    expect(reached(delivered)).toBeNull();
  });

  it('fails when the round verdict stayed in the app', () => {
    expect(reached({ ...delivered, received: delivered.received.filter((item) => item.kind !== 'rework') })).toBe(
      'the round verdict did not reach aiur',
    );
  });

  it('fails when the Command answer is not the pick the creator made', () => {
    const wrong = { kind: 'answer', option: 'a' };
    expect(reached({ ...delivered, received: [delivered.received[1]!, wrong] })).toBe(
      'the Command answer is not B with its note',
    );
  });
});

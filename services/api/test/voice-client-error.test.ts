import { expect, it } from 'vitest';

import { asUser, installUsers, makeApp, makeDeps, type TestUser } from './helpers.js';

const creator: TestUser = {
  kind: 'user',
  userId: 'u-creator',
  email: 'u-creator@example.com',
  familyId: 'f-family',
  platformRole: 'none',
  capability: 'creator',
};
const iphone = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1';

async function setup() {
  const deps = makeDeps();
  installUsers(deps, [creator]);
  const { app } = await makeApp(deps);
  const report = (body: unknown, headers: Record<string, string> = asUser(creator.userId)) =>
    app.request('/api/v1/voice/client-error', {
      method: 'POST',
      headers: { ...headers, 'content-type': 'application/json', 'user-agent': iphone },
      body: JSON.stringify(body),
    });
  return { deps, report };
}

it('logs one voice_client_error line with the cause and user agent', async () => {
  const { deps, report } = await setup();
  const response = await report({
    action: 'dictation',
    code: 'mic_denied',
    message: 'Microphone permission denied.',
    target_kind: 'edit',
  });
  expect(response.status).toBe(204);
  expect(deps.lines.filter((line) => line.event === 'voice_client_error')).toEqual([
    {
      event: 'voice_client_error',
      user_id: creator.userId,
      action: 'dictation',
      code: 'mic_denied',
      message: 'Microphone permission denied.',
      target_kind: 'edit',
      user_agent: iphone,
    },
  ]);
});

it('rejects anonymous, unknown, oversized or extra fields and logs nothing', async () => {
  const { deps, report } = await setup();
  const valid = { action: 'voice', code: 'start_failed', message: 'x' };
  expect((await report(valid, {})).status).toBe(401);
  for (const body of [
    { ...valid, action: 'other' },
    { ...valid, code: '' },
    { ...valid, message: 'x'.repeat(501) },
    { ...valid, token: 'secret' },
    { ...valid, audio: 'AAAA' },
  ])
    expect((await report(body)).status).toBe(400);
  expect(deps.lines.some((line) => line.event === 'voice_client_error')).toBe(false);
});

it('rate limits a flood of reports', async () => {
  const { report } = await setup();
  const statuses = [];
  for (let index = 0; index < 21; index += 1)
    statuses.push((await report({ action: 'send', code: 'not_sent', message: 'x' })).status);
  expect(statuses.slice(0, 20).every((status) => status === 204)).toBe(true);
  expect(statuses[20]).toBe(429);
});

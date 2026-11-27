import { createHmac } from 'node:crypto';
import { once } from 'node:events';

import { expect, it } from 'vitest';
import WebSocket from 'ws';

import { startDictationSystemServer } from '../e2e/dictation-system-server.js';

const secret = 'local-test-voice-secret-0123456789';
const claims = {
  scope: 'dictate',
  sub: 'player',
  exp: Math.floor(Date.now() / 1000) + 300,
  nonce: 'test-nonce',
  target: {
    kind: 'build',
    game_id: 'g_8f1c2a4e-5b6d-4c7e-9f00-1a2b3c4d5e01',
    job_id: 'j_8f1c2a4e-5b6d-4c7e-9f00-1a2b3c4d5e6f',
    ticket: '42',
    creator_id: 'player',
  },
};

function signed(payload: object, key = secret): string {
  const body = `vct1.${Buffer.from(JSON.stringify(payload)).toString('base64url')}`;
  return `${body}.${createHmac('sha256', key).update(body).digest('base64url')}`;
}

it('accepts a matching dictate token and rejects forged, expired, wrong-scope and wrong-target tokens', async () => {
  const server = await startDictationSystemServer();
  try {
    const connect = (token: string) => new WebSocket(`${server.url}?mode=dictate&token=${token}`);
    const valid = connect(signed(claims));
    await once(valid, 'open');
    const transcript = once(valid, 'message');
    valid.send(JSON.stringify({ type: 'audio', data_b64: 'AA==' }));
    valid.send(JSON.stringify({ type: 'commit' }));
    const [message] = await transcript;
    expect(JSON.parse(message.toString())).toMatchObject({ type: 'transcript', kind: 'final' });
    expect(server.stats()).toEqual({ audioFrames: 1, commits: 1 });
    valid.close();

    for (const token of [
      signed(claims, 'wrong-secret'),
      signed({ ...claims, exp: 1 }),
      signed({ ...claims, scope: 'converse' }),
      signed({ ...claims, target: { ...claims.target, job_id: 'other' } }),
    ]) {
      const rejected = connect(token);
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const [code] = (await Promise.race([
          once(rejected, 'close'),
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new Error('invalid token was not rejected')), 3_000);
          }),
        ])) as [number];
        expect(code).toBe(4401);
      } finally {
        clearTimeout(timer);
      }
    }
  } finally {
    await server.close();
  }
});

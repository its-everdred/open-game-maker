import { createServer } from 'node:http';
import { createHmac, timingSafeEqual } from 'node:crypto';

import { WebSocketServer } from 'ws';

const secret = 'local-test-voice-secret-0123456789';

function validToken(token: string | null): boolean {
  if (!token) return false;
  const [version, payload, signature, ...extra] = token.split('.');
  if (version !== 'vct1' || !payload || !signature || extra.length) return false;
  const expected = createHmac('sha256', secret).update(`${version}.${payload}`).digest();
  const actual = Buffer.from(signature, 'base64url');
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return false;
  try {
    const claims: unknown = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (typeof claims !== 'object' || claims === null) return false;
    const { scope, sub, exp, nonce, target } = claims as Record<string, unknown>;
    if (typeof target !== 'object' || target === null) return false;
    const build = target as Record<string, unknown>;
    return (
      scope === 'dictate' &&
      typeof sub === 'string' &&
      sub.length > 0 &&
      typeof exp === 'number' &&
      exp > Date.now() / 1000 &&
      typeof nonce === 'string' &&
      nonce.length > 0 &&
      build.kind === 'build' &&
      build.game_id === 'g_8f1c2a4e-5b6d-4c7e-9f00-1a2b3c4d5e01' &&
      build.job_id === 'j_8f1c2a4e-5b6d-4c7e-9f00-1a2b3c4d5e6f' &&
      build.ticket === '42' &&
      build.creator_id === sub
    );
  } catch {
    return false;
  }
}

/** Local provider boundary for the application-level dictation journey. */
export async function startDictationSystemServer() {
  const server = createServer();
  const websocket = new WebSocketServer({ server });
  let audioFrames = 0;
  let commits = 0;
  websocket.on('connection', (socket, request) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    if (url.searchParams.get('mode') !== 'dictate' || !validToken(url.searchParams.get('token'))) {
      socket.close(4401, 'unauthorized');
      return;
    }
    let committed = false;
    socket.on('message', (data) => {
      let frame: { v?: unknown; type?: unknown; data_b64?: unknown };
      try {
        frame = JSON.parse(data.toString()) as typeof frame;
      } catch {
        socket.send(JSON.stringify({ v: 1, type: 'error', code: 'invalid_frame' }));
        return;
      }
      const audio = frame?.data_b64;
      const encoded =
        typeof audio === 'string' && /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(audio);
      const bytes = encoded ? Buffer.from(audio, 'base64').length : 0;
      if (frame?.v === 1 && frame.type === 'audio' && !committed && bytes > 0 && bytes <= 64_000) {
        audioFrames += 1;
      } else if (frame?.v === 1 && frame.type === 'commit' && !committed) {
        committed = true;
        commits += 1;
        socket.send(JSON.stringify({ v: 1, type: 'transcript', kind: 'final', text: 'Make the lantern glow blue' }));
      } else if (frame?.v === 1 && frame.type === 'commit' && committed) {
        return;
      } else if (frame?.v === 1 && frame.type === 'stop') {
        socket.send(JSON.stringify({ v: 1, type: 'ended' }));
      } else {
        socket.send(JSON.stringify({ v: 1, type: 'error', code: 'invalid_frame' }));
      }
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('dictation server has no TCP port');
  return {
    url: `ws://127.0.0.1:${address.port}/voice`,
    stats: () => ({ audioFrames, commits }),
    async close() {
      for (const socket of websocket.clients) socket.terminate();
      await new Promise<void>((resolve, reject) => websocket.close((error) => (error ? reject(error) : resolve())));
      await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    },
  };
}

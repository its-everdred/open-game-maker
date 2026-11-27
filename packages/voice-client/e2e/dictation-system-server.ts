import { createServer } from 'node:http';

import { WebSocketServer } from 'ws';

/** Local provider boundary for the application-level dictation journey. */
export async function startDictationSystemServer() {
  const server = createServer();
  const websocket = new WebSocketServer({ server });
  let audioFrames = 0;
  let commits = 0;
  websocket.on('connection', (socket, request) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    if (url.searchParams.get('mode') !== 'dictate' || !url.searchParams.get('token')) {
      socket.close(4401, 'unauthorized');
      return;
    }
    socket.on('message', (data) => {
      const frame = JSON.parse(data.toString()) as { type?: string; data_b64?: string };
      if (frame.type === 'audio' && frame.data_b64) audioFrames += 1;
      if (frame.type === 'commit') {
        commits += 1;
        socket.send(JSON.stringify({ v: 1, type: 'transcript', kind: 'final', text: 'Make the lantern glow blue' }));
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

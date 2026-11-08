import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';

const PAGE = readFileSync(fileURLToPath(new URL('../fixtures/qa-game/index.html', import.meta.url)), 'utf8');
/** A seat that has not polled for this long has left the room. */
const PRESENCE_MS = 600;
const COUNTDOWN_MS = 3_000;

type Room = { tokens: string[]; xs: number[]; seen: number[]; startAt: number | null };

/**
 * Serves the qa-game fixture and its room API on `127.0.0.1`: what a hosted game's page and its rooms service do, small
 * enough that the room check runs against real sockets-free HTTP polling with no game repository.
 */
export async function serveQaGame(): Promise<{ url: string; close(): Promise<void> }> {
  const rooms = new Map<string, Room>();
  let next = 1;
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    const send = (body: unknown) =>
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(body));
    let raw = '';
    req.on('data', (chunk: Buffer) => (raw += chunk.toString()));
    req.on('end', () => {
      const body = raw ? (JSON.parse(raw) as { token?: string; dx?: number }) : {};
      const parts = url.pathname.split('/').filter(Boolean);
      if (parts[0] === 'down') {
        /* What the games host answers while its upstream is away: a painted error page, not a blank one. */
        res.writeHead(502, { 'content-type': 'text/html' }).end('<h1>502 Bad Gateway</h1>');
        return;
      }
      if (parts[0] !== 'room') {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(PAGE);
        return;
      }
      if (parts[1] === 'create') {
        const code = `R${next++}`;
        rooms.set(code, { tokens: [], xs: [], seen: [], startAt: null });
        send({ code });
        return;
      }
      const room = rooms.get(parts[1] ?? '');
      if (!room) {
        res.writeHead(404).end();
        return;
      }
      const now = Date.now();
      const token = body.token ?? url.searchParams.get('token') ?? '';
      let seat = room.tokens.indexOf(token);
      if (parts[2] === 'join') {
        if (seat < 0) {
          seat = room.tokens.length;
          room.tokens.push(`${parts[1]}-${seat}`);
          room.xs.push(0);
        }
        room.seen[seat] = now;
        send({ code: parts[1], seat, token: room.tokens[seat] });
        return;
      }
      if (seat >= 0) room.seen[seat] = now;
      if (parts[2] === 'start' && seat === 0) room.startAt = now + COUNTDOWN_MS;
      if (parts[2] === 'move' && seat >= 0) room.xs[seat] = Math.max(0, (room.xs[seat] ?? 0) + (body.dx ?? 0));
      send({
        now,
        startAt: room.startAt,
        xs: room.xs,
        present: room.seen.filter((t) => now - t < PRESENCE_MS).length,
      });
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}/`,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

import { readFileSync, readdirSync } from 'node:fs';
import { relative, resolve } from 'node:path';

import { expect, it } from 'vitest';

it('keeps room sends on the reviewed literal-message allowlist', () => {
  const webRoot = process.cwd();
  const roomRoot = resolve(webRoot, 'src/features/room');
  const files = productionFiles(roomRoot).concat(resolve(webRoot, 'src/routes/game/GameScreen.tsx'));
  const calls = files.flatMap((file) =>
    readFileSync(file, 'utf8')
      .split('\n')
      .map((line) => `${relative(webRoot, file)}: ${line.trim()}`)
      .filter((line) => line.includes('.send(')),
  );

  expect(calls).toEqual([
    "src/features/room/RoomControls.tsx: roomSession.send({ t: 'kick', userId });",
    'src/features/room/session.ts: send: (message) => client.send(message),',
    "src/features/room/useMenuRoomPause.ts: room.session?.send({ t: 'match.resume.request' });",
    "src/features/room/useMenuRoomPause.ts: room.session.send({ t: 'match.pause.request' });",
    "src/features/room/useRoomRuntime.ts: play: () => session.send({ t: 'phase', to: 'playing' }),",
    "src/features/room/useRoomRuntime.ts: edit: () => session.send({ t: 'phase', to: 'editing' }),",
    "src/routes/game/GameScreen.tsx: room.session?.send({ t: 'phase', to: nextMode === 'play' ? 'playing' : 'editing' });",
    "src/routes/game/GameScreen.tsx: if (roomId !== undefined && room.snapshot?.matchPause) room.session?.send({ t: 'match.resume.request' });",
  ]);
});

function productionFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) return productionFiles(path);
      return /\.tsx?$/.test(entry.name) && !entry.name.includes('.test.') ? [path] : [];
    })
    .sort();
}

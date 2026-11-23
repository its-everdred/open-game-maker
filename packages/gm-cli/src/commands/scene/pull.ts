import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, relative } from 'node:path';

import { EXIT, UsageError, type GmCommand } from '../../command.js';
import { printJson } from '../../context.js';
import { sceneRemote } from '../../scene/remote.js';
import {
  persistMigration,
  readStore,
  sceneRef,
  withSceneLock,
  workingCopyPath,
  writeStore,
} from '../../scene/store.js';
import { ticketFor } from '../../ticket.js';

export const command: GmCommand = {
  name: 'scene pull',
  summary: "copy a scene's latest revision (Kevin's edits included) to edit and push back",
  usage: '<game> <scene> [--pack <adapter>]',
  example: 'scene pull dusk-helm graveyard',
  flags: { pack: { type: 'string', help: 'pack adapter id, to start a scene that does not exist yet' } },
  async run(ctx, args, flags) {
    if (args.length !== 2) throw new UsageError('give a game and a scene', 'gm scene pull dusk-helm graveyard');
    const ref = sceneRef(ctx.cwd, args[0]!, args[1]!);
    const ticket = await ticketFor(ctx);
    const author = `agent:${ticket}`;
    const pack = typeof flags.pack === 'string' ? flags.pack : undefined;
    const remote = sceneRemote(ctx, ticket, ref.scene);
    const store = await withSceneLock(ref, async () => {
      const local = async () => persistMigration(ref, await readStore(ref, pack), author, new Date());
      if (!remote) return local();
      // The shared store holds Kevin's saves from the map maker; this checkout's files only start it.
      let shared = await remote.get();
      if (!shared) {
        const start = await local();
        if (!start.exists) return start;
        shared = await remote.seed({ head: start.head, log: start.log });
      }
      await writeStore(ref, shared);
      return shared;
    });
    const copy = { game: ref.game, scene: ref.scene, baseRev: store.head.rev, doc: store.head.doc };
    const path = workingCopyPath(ref);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, `${JSON.stringify(copy, null, 2)}\n`);
    if (ctx.json) printJson(ctx, { path, baseRev: copy.baseRev });
    else ctx.out(`pulled ${ref.game}/${ref.scene} at rev ${copy.baseRev}: edit doc in ${relative(ctx.cwd, path)}`);
    return EXIT.ok;
  },
};

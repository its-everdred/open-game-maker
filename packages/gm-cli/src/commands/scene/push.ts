import { readFile, writeFile } from 'node:fs/promises';

import { SceneDocSchema } from '@ogm/contracts';
import { commitScene, describeConflict, InvalidSceneError, SceneBaseUnavailableError } from '@ogm/design-log';
import { z } from 'zod';

import { CommandError, EXIT, UsageError, type GmCommand } from '../../command.js';
import { printJson } from '../../context.js';
import {
  persistMigration,
  readStore,
  sceneRef,
  validateHd2d,
  withSceneLock,
  workingCopyPath,
  writeRevision,
  writeStore,
} from '../../scene/store.js';
import { ticketFor } from '../../ticket.js';
import { sceneRemote } from '../../scene/remote.js';

const workingCopySchema = z.strictObject({
  game: z.string(),
  scene: z.string(),
  baseRev: z.number().int().nonnegative(),
  doc: SceneDocSchema,
});

export const command: GmCommand = {
  name: 'scene push',
  summary: 'save your edits to a pulled scene; refused where they would overwrite Kevin',
  usage: '<game> <scene> [--label <what changed>]',
  example: 'scene push dusk-helm graveyard --label "add north graves"',
  flags: { label: { type: 'string', help: 'what this revision changes' } },
  async run(ctx, args, flags) {
    if (args.length !== 2) throw new UsageError('give a game and a scene', 'gm scene push dusk-helm graveyard');
    const ref = sceneRef(ctx.cwd, args[0]!, args[1]!);
    const ticket = await ticketFor(ctx);
    const author = `agent:${ticket}`;
    const path = workingCopyPath(ref);
    let raw: unknown;
    try {
      raw = JSON.parse(await readFile(path, 'utf8'));
    } catch {
      throw new UsageError(`no working copy at ${path}`, `gm scene pull ${ref.game} ${ref.scene}`);
    }
    const parsed = workingCopySchema.safeParse(raw);
    if (!parsed.success) {
      const issues = parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ');
      throw new CommandError(`invalid working copy ${path}: ${issues}`);
    }
    const copy = parsed.data;
    if (copy.game !== ref.game || copy.scene !== ref.scene)
      throw new CommandError(`${path} is not ${ref.game}/${ref.scene}`);
    validateHd2d(copy.doc);

    const label = typeof flags.label === 'string' ? flags.label : '';
    const remote = sceneRemote(ctx, ticket, ref.scene);
    const result = await withSceneLock(ref, async () => {
      if (remote) {
        // The API applies the same commit rules on the shared store, then this checkout mirrors what it holds.
        const pushed = await remote.push({ baseRev: copy.baseRev, doc: copy.doc, label });
        if (pushed.ok) {
          const shared = await remote.get();
          if (shared) await writeStore(ref, shared);
        }
        return pushed;
      }
      const now = new Date();
      const store = await persistMigration(ref, await readStore(ref, copy.doc.packAdapter), author, now);
      let commit: ReturnType<typeof commitScene>;
      try {
        commit = commitScene({
          head: store.head,
          log: store.log,
          doc: copy.doc,
          baseRev: copy.baseRev,
          author,
          source: 'cli',
          label,
          now,
        });
      } catch (error) {
        if (error instanceof SceneBaseUnavailableError || error instanceof InvalidSceneError) {
          throw new CommandError(`cannot push ${ref.game}/${ref.scene}: ${error.message}`);
        }
        throw error;
      }
      if (commit.ok && commit.revision) await writeRevision(ref, commit.head, commit.revision);
      return commit;
    });

    if (!result.ok) {
      const hint = `pull again (gm scene pull ${ref.game} ${ref.scene}), leave what Kevin owns as it is and redo the rest`;
      if (ctx.json) {
        const conflicts = result.conflicts.map((conflict) => ({ ...conflict, message: describeConflict(conflict) }));
        printJson(ctx, { ok: false, conflicts, hint });
      } else {
        ctx.err(`push refused: ${result.conflicts.length} conflict(s); nothing was saved`);
        for (const conflict of result.conflicts) ctx.err(`  ${describeConflict(conflict)}`);
        ctx.err(hint);
      }
      return EXIT.failed;
    }
    await writeFile(path, `${JSON.stringify({ ...copy, baseRev: result.head.rev, doc: result.head.doc }, null, 2)}\n`);
    const rev = result.head.rev;
    const link = editorLink(ctx.env?.OGM_APP_ORIGIN, ref.game, ref.scene, rev);
    if (ctx.json) printJson(ctx, { ok: true, rev, rebased: result.rebased, saved: result.revision !== null, link });
    else if (!result.revision) ctx.out(`no changes to ${ref.game}/${ref.scene} (rev ${rev})`);
    else {
      ctx.out(
        `pushed ${ref.game}/${ref.scene} rev ${rev}${result.rebased ? ` (rebased from rev ${copy.baseRev})` : ''}`,
      );
      ctx.out(`open in the editor: ${link}`);
    }
    return EXIT.ok;
  },
};

/**
 * The map maker opened on this scene (#1212), for the agent's update to Kevin; a path when no app origin is set. The
 * game's short link (`/<slug>/edit`) resolves the slug the workspace knows to the game id the editor page needs.
 */
export function editorLink(origin: string | undefined, game: string, scene: string, rev: number): string {
  const query = new URLSearchParams({ scene, rev: String(rev) });
  return `${(origin ?? '').replace(/\/$/, '')}/${encodeURIComponent(game)}/edit?${query}`;
}

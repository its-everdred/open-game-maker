import { GameRepoTemplateSource } from '@ogm/game-repo-template';
import { describe, expect, it } from 'vitest';

import { createGame } from '../src/ops/create-game.js';
import { DefaultTemplateSource, withGameTemplates } from '../src/template-source.js';
import { contextWith, fakeRequest } from './helpers.js';

describe('create_game with the game-repo template', () => {
  it('commits a game without skills and creates the game label', async () => {
    const { request, calls } = fakeRequest((call) => {
      if (call.route.endsWith('/git/ref/{ref}')) return { object: { sha: 'main-1' } };
      if (call.route.endsWith('/git/commits/{commit_sha}')) return { tree: { sha: 'base-tree' } };
      if (call.route.endsWith('/git/trees/{tree_sha}')) return { truncated: false, tree: [] };
      if (call.route.endsWith('/git/trees')) return { sha: 'tree-1' };
      if (call.route.endsWith('/git/commits')) return { sha: 'commit-1' };
      if (call.route === 'POST /repos/{owner}/{repo}/pulls') return { number: 7, title: 'Add game castle-game' };
      if (call.route.endsWith('/pulls/{pull_number}/merge')) return { merged: true, message: 'ok', sha: 'merge-1' };
      return {};
    });
    const templates = withGameTemplates(new GameRepoTemplateSource(), new DefaultTemplateSource());
    const result = await createGame(
      {
        kind: 'create_game',
        gameId: 'g1',
        slug: 'castle-game',
        templateRef: 'game-3d@1',
        visibility: 'private',
      },
      contextWith(request, { templates }),
    );
    expect(result).toEqual({ ok: true, sha: 'merge-1' });

    const tree = calls.find((call) => call.route.endsWith('/git/trees'))!.parameters.tree as {
      path: string;
      mode: string;
      content: string;
    }[];
    expect(calls.filter((call) => call.route.endsWith('/git/blobs'))).toHaveLength(0);
    const folder = 'games/castle-game';
    expect(tree.some((entry) => /\/(?:\.claude|\.codex|\.agents)\/skills(?:\/|$)/u.test(entry.path))).toBe(false);
    expect(tree.some((entry) => entry.path.includes('node_modules'))).toBe(false);
    expect(tree.length).toBeLessThan(100);
    expect(tree.find((entry) => entry.path === `${folder}/AGENTS.md`)!.mode).toBe('100644');
    // The workflow belongs to the instance repository, so it never lands inside a game's folder.
    expect(tree.some((entry) => entry.path.includes('/.github/'))).toBe(false);

    const labels = calls.filter((call) => call.route === 'POST /repos/{owner}/{repo}/labels');
    expect(labels.map((call) => call.parameters.name)).toEqual(['game:castle-game']);
  });

  it('keeps the built-in default ref', async () => {
    const templates = withGameTemplates(new GameRepoTemplateSource(), new DefaultTemplateSource());
    const rendered = await templates.render('default', { gameId: 'g1', owner: 'alice', visibility: 'private' });
    expect(rendered.files.map((file) => file.path)).toContain('README.md');
  });
});

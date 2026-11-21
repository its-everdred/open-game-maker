import { describe, expect, it, vi } from 'vitest';

import { createDraftScopeTicket } from '../../src/new-game/draft-assistant.js';

describe('draft scope assistant ticket', () => {
  it('creates a scope-only shared ticket without game repository or commit work', async () => {
    const create = vi.fn().mockResolvedValue({ number: 42, url: 'https://example.test/issues/42' });
    const ensureLabel = vi.fn().mockResolvedValue(undefined);
    const findByMarkers = vi.fn().mockResolvedValue(null);
    const close = vi.fn().mockResolvedValue(undefined);
    const enqueueTodo = vi.fn().mockResolvedValue(undefined);

    const result = await createDraftScopeTicket({
      repo: 'owner/instance',
      draftId: 'd_draft-1',
      choices: {
        genre: 'platformer',
        vibe: 'cozy',
        family: 'chunky-low-poly',
        world: 'island',
        players: 'single',
        pov: 'isometric',
      },
      issues: { create, ensureLabel, findByMarkers, close },
      aiur: { enqueueTodo },
    });

    expect(result).toEqual({ repo: 'owner/instance', ticket: '42' });
    expect(create).toHaveBeenCalledWith(
      'owner/instance',
      expect.objectContaining({
        labels: ['agent:todo', 'complexity:1', 'feature:gm-d_draft-1'],
        body: expect.stringContaining('Do not create or modify files, branches, commits, or pull requests.'),
      }),
    );
    expect(ensureLabel).toHaveBeenCalledWith(
      'owner/instance',
      'feature:gm-d_draft-1',
      '0e8a16',
      'Temporary scope session',
    );
    expect(enqueueTodo).toHaveBeenCalledWith(['42']);
  });

  it('reuses an issue after an ambiguous create instead of duplicating the draft session', async () => {
    const create = vi.fn();
    const enqueueTodo = vi.fn().mockResolvedValue(undefined);

    const result = await createDraftScopeTicket({
      repo: 'owner/instance',
      draftId: 'd_draft-2',
      choices: {
        genre: 'platformer',
        vibe: 'cozy',
        family: 'chunky-low-poly',
        world: 'island',
        players: 'single',
        pov: 'isometric',
      },
      issues: {
        create,
        ensureLabel: vi.fn().mockResolvedValue(undefined),
        findByMarkers: vi.fn().mockResolvedValue({ number: 43, url: '', labels: [] }),
        close: vi.fn().mockResolvedValue(undefined),
      },
      aiur: { enqueueTodo },
    });

    expect(result.ticket).toBe('43');
    expect(create).not.toHaveBeenCalled();
    expect(enqueueTodo).toHaveBeenCalledWith(['43']);
  });

  it('closes the temporary issue if dispatch fails', async () => {
    const close = vi.fn().mockResolvedValue(undefined);
    const enqueueTodo = vi.fn().mockRejectedValue(new Error('dispatch unavailable'));

    await expect(
      createDraftScopeTicket({
        repo: 'owner/instance',
        draftId: 'd_draft-3',
        choices: {
          genre: 'platformer',
          vibe: 'cozy',
          family: 'chunky-low-poly',
          world: 'island',
          players: 'single',
          pov: 'isometric',
        },
        issues: {
          create: vi.fn().mockResolvedValue({ number: 44, url: '' }),
          ensureLabel: vi.fn().mockResolvedValue(undefined),
          findByMarkers: vi.fn().mockResolvedValue(null),
          close,
        },
        aiur: { enqueueTodo },
      }),
    ).rejects.toThrow('dispatch unavailable');

    expect(close).toHaveBeenCalledWith('owner/instance', 44);
  });
});

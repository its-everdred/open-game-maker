import { describe, expect, it, vi } from 'vitest';
import { createWorkpadReader } from '../../src/worker-progress/workpad.js';

describe('workpad reader', () => {
  it('reads the agent workpad without exposing other comments', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(
          JSON.stringify([{ body: 'A different comment' }, { body: '## Agent Workpad\n- [x] Done\n- [ ] Next' }]),
          { status: 200 },
        ),
      );
    const read = createWorkpadReader({ owner: 'owner', name: 'games' }, 'secret', fetcher);
    expect(await read('12')).toBe('## Agent Workpad\n- [x] Done\n- [ ] Next');
    expect(await read('12')).toContain('Agent Workpad');
    expect(fetcher).toHaveBeenCalledOnce();
    expect(String(fetcher.mock.calls[0]?.[0])).toBe(
      'https://api.github.com/repos/owner/games/issues/12/comments?per_page=100&page=1',
    );
  });
  it('does not request a non-numeric ticket', async () => {
    const fetcher = vi.fn<typeof fetch>();
    const read = createWorkpadReader({ owner: 'owner', name: 'games' }, 'secret', fetcher);
    expect(await read('../bad')).toBe('');
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('separates workpads for the same ticket in different game repositories', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockImplementation(async () => new Response(JSON.stringify([]), { status: 200 }));
    const read = createWorkpadReader({ owner: 'owner', name: 'games' }, 'secret', fetcher);
    await read('12');
    await read('12', { owner: 'other', name: 'game' });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(String(fetcher.mock.calls[1]?.[0])).toContain('/repos/other/game/issues/12/comments');
  });
});

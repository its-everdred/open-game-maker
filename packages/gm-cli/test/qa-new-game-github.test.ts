import { describe, expect, it, vi } from 'vitest';

import { closeQaParent, newGameParents } from '../src/qa-new-game-github.js';

describe('New Game parent lookup', () => {
  it('scopes the GitHub lookup to the exact request and rejects invalid repository input', async () => {
    const invoke = vi.fn(async () => [
      { number: 7, title: 'QA', body: 'brief', labels: [{ name: 'request:new-game' }] },
    ]);
    await expect(newGameParents('example/games', 'j_123', invoke)).resolves.toEqual([
      { number: 7, repo: 'example/games', title: 'QA', body: 'brief', labels: ['request:new-game'] },
    ]);
    expect(invoke).toHaveBeenCalledWith('GET', expect.stringContaining('feature%3Agm-j_123'));
    await expect(newGameParents('../other', 'j_123', invoke)).rejects.toThrow('invalid repository');
    expect(invoke).toHaveBeenCalledTimes(1);
  });
});

describe('QA parent cleanup', () => {
  it('closes and verifies only the issue that names this QA game and request', async () => {
    const issue = {
      number: 7,
      title: 'QA',
      body: '- Game: g_123\n- Private context reference: j_123\n<!-- gm-job:j_123 gm-ticket:new-game gm-sig:abc -->',
      labels: [{ name: 'request:new-game' }, { name: 'feature:gm-j_123' }],
    };
    const invoke = vi.fn(async (method: string, path: string) => {
      if (path.includes('?')) return [issue];
      if (method === 'PATCH') return {};
      return { number: 7, state: 'closed' };
    });
    await closeQaParent('example/games', 'j_123', 'g_123', 7, invoke);
    expect(invoke).toHaveBeenCalledWith('PATCH', '/repos/example/games/issues/7', { state: 'closed' });
    const other = vi.fn(async () => [{ ...issue, body: '- Game: g_other' }]);
    await expect(closeQaParent('example/games', 'j_123', 'g_123', 7, other)).rejects.toThrow('does not match');
    expect(other).toHaveBeenCalledTimes(1);
  });
});

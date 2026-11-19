import { describe, expect, it, vi } from 'vitest';
import { assertNoQaIssues, assertQaJobTickets, closeQaScopeIssue, qaScopePaths } from '../src/qa-new-game-issues.js';

describe('QA issue cleanup', () => {
  it('extracts only the exact session artifact from the verified scope issue', async () => {
    const request = vi.fn(async (_method: string) => ({
      number: 9,
      body: '<!-- gm-job:j_123 gm-ticket:scope gm-sig:abc gm-scope:s_123 -->',
    }));
    await expect(qaScopePaths('example/games', [{ issue: 9, sessionId: 's_123' }], request)).resolves.toEqual([
      '.gm/scope/s_123.json',
    ]);
    const bad = vi.fn(async () => ({ number: 9, body: '<!-- gm-ticket:scope gm-scope:../other -->' }));
    await expect(qaScopePaths('example/games', [{ issue: 9, sessionId: 's_123' }], bad)).rejects.toThrow(/session/);
    await expect(qaScopePaths('example/games', [{ issue: 9, sessionId: 's_other' }], request)).rejects.toThrow(
      /does not match/,
    );
    expect(request.mock.calls.every(([method]) => method === 'GET')).toBe(true);
  });

  it('closes only the scope issue carrying the exact job marker and verifies closure', async () => {
    const issue = {
      number: 9,
      state: 'open',
      labels: [{ name: 'feature:gm-j_123' }],
      body: '<!-- gm-job:j_123 gm-ticket:scope gm-sig:abc -->',
    };
    let closed = false;
    const request = vi.fn(async (method: string): Promise<unknown> => {
      if (method === 'PATCH') {
        closed = true;
        return {};
      }
      return { ...issue, state: closed ? 'closed' : 'open' };
    });
    await closeQaScopeIssue('example/games', 'j_123', 9, request);
    expect(request).toHaveBeenCalledWith('PATCH', '/repos/example/games/issues/9', { state: 'closed' });
    const bad = vi.fn(async () => ({ ...issue, body: 'unrelated issue' }));
    await expect(closeQaScopeIssue('example/games', 'j_123', 9, bad)).rejects.toThrow(/does not match/);
    expect(bad).toHaveBeenCalledTimes(1);
  });

  it('refuses cleanup while any open issue still targets the QA daemon', async () => {
    const request = vi.fn(async () => [{ number: 10, labels: [{ name: 'qa-game:todo' }] }]);
    await expect(assertNoQaIssues('example/games', 'qa-game', request)).rejects.toThrow(/open QA issue/);
  });

  it('detects an issue filed remotely before its database checkpoint was saved', async () => {
    const request = vi.fn(async () => [
      { number: 10, labels: [{ name: 'feature:gm-j_123' }], body: '<!-- gm-job:j_123 gm-ticket:scope gm-sig:abc -->' },
    ]);
    await expect(assertQaJobTickets('example/games', 'j_123', [], request)).rejects.toThrow(/checkpoint/);
    await expect(
      assertQaJobTickets('example/games', 'j_123', [{ key: 'scope', issue: 10 }], request),
    ).resolves.toBeUndefined();
  });
});

import { describe, expect, it, vi } from 'vitest';
import { execFileSync } from 'node:child_process';

import { ticketDesignFromIssue } from '../src/commands/check/index.js';

describe('ticket design labels', () => {
  it('reads glass labels from the actual GitHub issue and fails closed on lookup errors', () => {
    const run = vi
      .fn()
      .mockReturnValueOnce('https://github.com/example/open-game-maker.git\n')
      .mockReturnValueOnce(JSON.stringify({ labels: [{ name: 'design:ogm-glass' }] }));
    expect(ticketDesignFromIssue('/workspace', '123', run as unknown as typeof execFileSync)).toEqual({
      design: 'ogm-glass',
    });
    expect(run.mock.calls[1]?.[1]).toEqual(['issue', 'view', '123', '--json', 'labels']);

    const other = vi.fn().mockReturnValueOnce('https://github.com/example/game.git\n');
    expect(ticketDesignFromIssue('/workspace', '123', other as unknown as typeof execFileSync)).toEqual({});
    expect(other).toHaveBeenCalledTimes(1);

    const failure = vi
      .fn()
      .mockReturnValueOnce('https://github.com/example/open-game-maker.git\n')
      .mockImplementationOnce(() => {
        throw new Error('offline');
      });
    expect(ticketDesignFromIssue('/workspace', '123', failure as unknown as typeof execFileSync).error).toContain(
      'cannot read design labels for ticket #123',
    );
  });
});

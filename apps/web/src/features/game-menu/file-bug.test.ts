import { describe, expect, it, vi } from 'vitest';

import { fileBug, REPORT_TEXT_MAX } from './file-bug';

const target = { gameId: 'g1', branchId: 'main' };
const bug = { text: 'The goblin froze', log: 'game g1\nbuild b1', attempt: 'a1' };

describe('filing a bug from the play menu (#1326)', () => {
  it('gives the owner an agent: a fix job whose chat opens with the bug and its log', async () => {
    const admit = vi.fn().mockResolvedValue({ kind: 'accepted', jobId: 'job-7' });
    const report = vi.fn();

    expect(await fileBug({ admit, report }, { ...target, owner: true }, bug)).toEqual({ jobId: 'job-7' });

    const request = admit.mock.calls[0]![0];
    // Admission makes an `edit:` request's summary the conversation's first message.
    expect(request.idempotencyKey).toBe('edit:bug-a1');
    expect(request.plan.summary).toBe('Bug: The goblin froze\n\nLog:\ngame g1\nbuild b1');
    expect(request.plan.title).toBe('Bug: The goblin froze');
    expect(report).not.toHaveBeenCalled();
  });

  it('sends a retry of the same bug with the same key, so a lost response never files it twice', async () => {
    const admit = vi.fn().mockResolvedValue({ kind: 'accepted', jobId: 'job-7' });
    await fileBug({ admit, report: vi.fn() }, { ...target, owner: true }, bug);
    await fileBug({ admit, report: vi.fn() }, { ...target, owner: true }, bug);
    expect(admit.mock.calls[0]![0].idempotencyKey).toBe(admit.mock.calls[1]![0].idempotencyKey);
  });

  it('fails loudly when Energy refuses the fix job', async () => {
    const admit = vi.fn().mockResolvedValue({ kind: 'refused' });
    await expect(fileBug({ admit, report: vi.fn() }, { ...target, owner: true }, bug)).rejects.toThrow(
      'bug_not_admitted',
    );
  });

  it("reports a player's bug without promising a conversation they cannot open", async () => {
    const admit = vi.fn();
    const report = vi.fn().mockResolvedValue({ reportId: 'r1', jobId: 'repair-1' });

    expect(await fileBug({ admit, report }, { ...target, owner: false }, bug)).toEqual({});

    expect(admit).not.toHaveBeenCalled();
    expect(report).toHaveBeenCalledWith({ text: 'The goblin froze\n\ngame g1\nbuild b1' });
  });

  it('keeps the description whole when the log has to be cut to fit a report', async () => {
    const report = vi.fn().mockResolvedValue({ queued: true });
    await fileBug({ admit: vi.fn(), report }, { ...target, owner: false }, { ...bug, log: 'x'.repeat(5000) });
    const sent = report.mock.calls[0]![0].text as string;
    expect(sent).toHaveLength(REPORT_TEXT_MAX);
    expect(sent.startsWith('The goblin froze\n\n')).toBe(true);
  });
});

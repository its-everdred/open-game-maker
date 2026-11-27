import { beforeEach, describe, expect, it, vi } from 'vitest';

const { upload, post } = vi.hoisted(() => ({ upload: vi.fn(), post: vi.fn() }));
vi.mock('../build-chat/attachments', () => ({ uploadChatAttachment: upload }));
vi.mock('../../lib/api/client', () => ({ api: post }));

import { fileBug, REPORT_TEXT_MAX } from './file-bug';

const target = { gameId: 'g1', branchId: 'main' };
const bug = { text: 'The goblin froze', log: 'game g1\nbuild b1', attempt: 'a1' };

describe('filing a bug from the play menu (#1326)', () => {
  beforeEach(() => {
    upload.mockReset();
    post.mockReset();
  });

  it('attaches captured stills to the admitted repair conversation', async () => {
    upload.mockImplementation(async (_jobId: string, file: File) => ({ id: file.name }));
    const admit = vi.fn().mockResolvedValue({ kind: 'accepted', jobId: 'job-7' });
    const captures = [
      { label: 'Now', image: 'data:image/webp;base64,YWJj' },
      { label: '−5 s', image: 'data:image/webp;base64,ZGVm' },
    ];

    await fileBug({ admit, report: vi.fn() }, { ...target, owner: true }, { ...bug, captures });

    expect(upload).toHaveBeenCalledTimes(2);
    expect(upload.mock.calls.map((call) => [call[0], call[1].name, call[2]])).toEqual([
      ['job-7', 'game-now.webp', 'image/webp'],
      ['job-7', 'game-5-s.webp', 'image/webp'],
    ]);
    expect(post).toHaveBeenCalledWith('/jobs/job-7/chat', {
      method: 'POST',
      json: { text: 'Recent game screenshots', attachments: ['game-now.webp', 'game-5-s.webp'] },
      signal: expect.any(AbortSignal),
    });
  });

  it('keeps the admitted bug conversation when screenshot attachment fails', async () => {
    upload.mockRejectedValue(new Error('attachment_unavailable'));
    const admit = vi.fn().mockResolvedValue({ kind: 'accepted', jobId: 'job-7' });
    const captures = [{ label: 'Now', image: 'data:image/webp;base64,YWJj' }];

    await expect(
      fileBug({ admit, report: vi.fn() }, { ...target, owner: true }, { ...bug, captures }),
    ).resolves.toEqual({
      jobId: 'job-7',
    });
    expect(upload).toHaveBeenCalledOnce();
    expect(post).not.toHaveBeenCalled();
  });

  it('posts screenshots whose uploads succeeded when another upload fails', async () => {
    upload
      .mockRejectedValueOnce(new DOMException('Upload timed out', 'AbortError'))
      .mockResolvedValueOnce({ id: 'game-5-s.webp' });
    const admit = vi.fn().mockResolvedValue({ kind: 'accepted', jobId: 'job-7' });
    const captures = [
      { label: 'Now', image: 'data:image/webp;base64,YWJj' },
      { label: '−5 s', image: 'data:image/webp;base64,ZGVm' },
    ];

    await expect(
      fileBug({ admit, report: vi.fn() }, { ...target, owner: true }, { ...bug, captures }),
    ).resolves.toEqual({
      jobId: 'job-7',
    });
    expect(post).toHaveBeenCalledWith('/jobs/job-7/chat', {
      method: 'POST',
      json: { text: 'Recent game screenshots', attachments: ['game-5-s.webp'] },
      signal: expect.any(AbortSignal),
    });
    expect(post.mock.calls[0]?.[1].signal.aborted).toBe(false);
  });

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
    expect(report).toHaveBeenCalledWith({ text: 'The goblin froze\n\ngame g1\nbuild b1', captures: undefined });
  });

  it('forwards screenshots with a non-owner report for the report service', async () => {
    const report = vi.fn().mockResolvedValue({ reportId: 'r1' });
    const captures = [{ label: 'Now', image: 'data:image/webp;base64,YWJj' }];

    await fileBug({ admit: vi.fn(), report }, { ...target, owner: false }, { ...bug, captures });

    expect(report).toHaveBeenCalledWith({ text: 'The goblin froze\n\ngame g1\nbuild b1', captures });
  });

  it('keeps the description whole when the log has to be cut to fit a report', async () => {
    const report = vi.fn().mockResolvedValue({ queued: true });
    await fileBug({ admit: vi.fn(), report }, { ...target, owner: false }, { ...bug, log: 'x'.repeat(5000) });
    const sent = report.mock.calls[0]![0].text as string;
    expect(sent).toHaveLength(REPORT_TEXT_MAX);
    expect(sent.startsWith('The goblin froze\n\n')).toBe(true);
  });
});

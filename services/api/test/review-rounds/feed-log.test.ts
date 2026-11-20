import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';

import { appendReviewLogRecord, logReviewFeedRefresh, logReviewPublish } from '../../src/review-rounds/feed-log.js';

it('writes publish and feed refresh records that join on game and round id', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'ogm-review-log-'));
  try {
    const path = join(directory, 'review-publishes.log');
    const log = vi.fn();
    const item = { ticket: '57', id: 'round-1', postedAt: '2026-11-19T11:00:00.000Z' };
    await logReviewPublish('game-1', item, log, path);
    await logReviewFeedRefresh('rounds', 'game-1', [item], log, path);
    const rows = (await readFile(path, 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.event)).toEqual(['publish', 'feed_refresh']);
    expect(rows.every((row) => row.gameId === 'game-1' && row.items[0].id === 'round-1')).toBe(true);
    expect(log).not.toHaveBeenCalled();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

it('retains the recent metric window while bounding the review feed log', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'ogm-review-log-'));
  try {
    const path = join(directory, 'review-publishes.log');
    const now = new Date('2026-11-19T12:00:00Z');
    const old = Array.from({ length: 12 }, (_, index) =>
      JSON.stringify({
        timestamp: '2026-11-16T12:00:00.000Z',
        event: 'feed_refresh',
        source: 'rounds',
        gameId: 'g',
        items: [{ id: `old-${index}` }],
      }),
    );
    const recent = JSON.stringify({
      timestamp: '2026-11-19T11:00:00.000Z',
      event: 'feed_refresh',
      source: 'rounds',
      gameId: 'g',
      items: [{ id: 'recent' }],
    });
    await writeFile(path, `${[...old, recent].join('\n')}\n`);
    const current = `${JSON.stringify({ timestamp: now.toISOString(), event: 'publish', source: 'rounds', gameId: 'g', items: [{ id: 'current' }] })}\n`;
    await appendReviewLogRecord(path, current, now, { maxBytes: 500, retainMs: 48 * 60 * 60 * 1000 });
    const rows = (await readFile(path, 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as { items: { id: string }[] });
    expect(rows.flatMap((row) => row.items.map((item) => item.id))).toEqual(['recent', 'current']);
    expect((await stat(path)).size).toBeLessThanOrEqual(500);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

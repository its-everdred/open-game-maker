import { expect, it } from 'vitest';
import { collectCommands, collectReviewTickets, feedCards, type Run, type Source } from './sources.js';

const source: Source = { key: 'core', checkout: '.', repository: 'example/repo', aiur: 'aiur', decideRepo: 'core' };

it('reads open Commands and rejects an unavailable listing', () => {
  const run: Run = (_program, args) =>
    args.includes('--filter')
      ? 'Commands captured\ndec_ab Needs you'
      : JSON.stringify({
          data: {
            selected: {
              decision_id: 'dec_ab',
              question: 'Review?',
              created_at: '',
              ticket: { identifier: '2' },
              options: [{ id: 'yes', label: 'Yes' }],
            },
          },
        });
  expect(collectCommands(source, run, () => [])[0]?.ticket).toBe(2);
  expect(() =>
    collectCommands(
      source,
      () => 'offline',
      () => [],
    ),
  ).toThrow('Cannot read Commands');
});

it('requires engine media for pack feeds and keeps round options', () => {
  const line = JSON.stringify({ key: 'demo', engine_image: '/render.png', options: ['A', 'B'], ticket: 12 });
  expect(feedCards('pixel-preview', line, () => undefined)).toEqual([]);
  const cards = feedCards('pixel-preview', line, (path) => ({ kind: 'img', src: path }));
  expect(cards[0]?.shared[0]?.src).toBe('/render.png');
  expect(cards[0]?.options.map((option) => option.id)).toEqual(['a', 'b']);
});

it('uses the live preview URL for a round, including its scenario', () => {
  const line = JSON.stringify({
    key: 'round',
    image: '/render.png',
    play: 'https://example.test/old',
    preview_url: 'https://example.test/live/demo/12/?scenario=yard',
  });
  const cards = feedCards('rounds', line, (path) => ({ kind: 'img', src: path }));
  expect(cards[0]?.play).toBe('https://example.test/live/demo/12/?scenario=yard');
  const playableOnly = feedCards(
    'rounds',
    JSON.stringify({ key: 'live', preview_url: 'https://example.test/live/demo/12' }),
    () => undefined,
  );
  expect(playableOnly[0]?.play).toBe('https://example.test/live/demo/12');
});

it('uses workpad and relevant PR media for human-review tickets', () => {
  const run: Run = (_program, args) => {
    if (args[0] === 'issue' && args[1] === 'list') return JSON.stringify([{ number: 12, title: 'Review', body: '' }]);
    if (args[0] === 'issue')
      return JSON.stringify({
        comments: [
          { body: '## Agent Workpad\nworkpad.png', author: { login: 'worker' } },
          { body: '## Agent Workpad\nspoof.png', author: { login: 'stranger' } },
        ],
      });
    return JSON.stringify([
      { body: 'Closes #12\npr.png', author: { login: 'worker' } },
      { body: 'Closes #123\nother.png', author: { login: 'worker' } },
    ]);
  };
  const cards = collectReviewTickets({ ...source, trustedAuthors: ['worker'] }, run, (text) =>
    [...text.matchAll(/\w+\.png/g)].map((m) => ({ kind: 'img', src: m[0] })),
  );
  expect(cards[0]?.shared.map((media) => media.src)).toEqual(['workpad.png', 'pr.png']);
  const other = collectReviewTickets({ ...source, id: 'second', trustedAuthors: ['worker'] }, run, (text) =>
    [...text.matchAll(/\w+\.png/g)].map((m) => ({ kind: 'img', src: m[0] })),
  );
  expect(other[0]?.key).not.toBe(cards[0]?.key);
});

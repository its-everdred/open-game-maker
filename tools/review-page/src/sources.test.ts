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

it('uses workpad and relevant PR media for human-review tickets', () => {
  const run: Run = (_program, args) => {
    if (args[0] === 'issue' && args[1] === 'list') return JSON.stringify([{ number: 12, title: 'Review', body: '' }]);
    if (args[0] === 'issue')
      return JSON.stringify({ comments: [{ body: '## Agent Workpad\nworkpad.png' }, { body: 'unrelated.png' }] });
    return JSON.stringify([{ body: 'Closes #12\npr.png' }, { body: 'Closes #123\nother.png' }]);
  };
  const cards = collectReviewTickets(source, run, (text) =>
    [...text.matchAll(/\w+\.png/g)].map((m) => ({ kind: 'img', src: m[0] })),
  );
  expect(cards[0]?.shared.map((media) => media.src)).toEqual(['workpad.png', 'pr.png']);
});

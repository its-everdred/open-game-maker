import type { GameCommand } from '@ogm/contracts';

// A Command as the inbox route returns it: two text options, a recommended one, and one option carrying video (A1).
export function commandFixture(overrides: Partial<GameCommand> = {}): GameCommand {
  return {
    job_id: 'j_1',
    ticket: '478',
    title: 'Build the moon gate',
    command_id: 'm_3',
    decision_id: 'd_1',
    version: 3,
    question: 'Which gate should the courtyard use?',
    options: [
      {
        id: 'stone',
        label: 'Stone arch',
        media: {
          url: 'https://media.example.test/arch.mp4',
          poster: 'https://media.example.test/arch.jpg',
          width: 640,
          height: 360,
          duration_ms: 4000,
        },
      },
      { id: 'wood', label: 'Wooden door' },
    ],
    recommend: 'stone',
    blocking: true,
    opened_at: '2026-11-04T10:00:00.000Z',
    ...overrides,
  };
}

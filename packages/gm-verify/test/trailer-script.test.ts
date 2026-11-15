import { expect, it } from 'vitest';

import { trailerScriptSchema } from '../src/trailer.js';

it('accepts timed actions and clicks across named scenarios within the trailer length', () => {
  const script = trailerScriptSchema.parse([
    { seconds: 5, surface: 'page', inputs: [{ t: 1, click: '[data-play]' }] },
    {
      scenario: 'combo',
      seconds: 10,
      inputs: [
        { t: 2, action: 'hardDrop' },
        { t: 3, action: 'move', value: { x: -1, y: 0 } },
      ],
    },
  ]);
  expect(script[1]!.inputs[0]).toMatchObject({ action: 'hardDrop', phase: 'down', playerIndex: 0 });
  expect(script[1]!.surface).toBe('canvas');
  expect(trailerScriptSchema.parse([{ seconds: 15.125 }])[0]!.seconds).toBe(15.125);
  expect(() => trailerScriptSchema.parse([{ seconds: 14 }])).toThrow('15–30');
  expect(() => trailerScriptSchema.parse([{ seconds: 15, inputs: [{ t: 15, action: 'hardDrop' }] }])).toThrow(
    'outside',
  );
});

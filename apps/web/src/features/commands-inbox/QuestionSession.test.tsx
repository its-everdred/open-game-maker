import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { DecisionVoice } from './decision-voice';
import { QuestionSession } from './QuestionSession';

afterEach(cleanup);

describe('a quick question session', () => {
  // The session is the game's queued product questions (#612): the call it opens names the game and the creator, and
  // starts without a second press.
  it('opens a self-starting voice chat aimed at the game’s queued questions', () => {
    const voice = vi.fn<typeof DecisionVoice>(() => <button type="button">mic</button>);
    render(
      <QuestionSession
        session={{ game_id: 'g_castle', game_title: 'Castle', count: 6 }}
        creatorId="u_1"
        onClose={vi.fn()}
        voice={voice}
      />,
    );

    expect(screen.getByRole('dialog', { name: 'Castle' })).toBeVisible();
    expect(screen.getByLabelText('6 questions')).toHaveTextContent('6');
    expect(voice.mock.calls[0]![0]).toMatchObject({
      target: { kind: 'questions', game_id: 'g_castle', creator_id: 'u_1' },
      autoStart: true,
    });
  });
});

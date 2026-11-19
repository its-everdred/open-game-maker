import { render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { EditConversation } from './EditConversation';

vi.mock('../../lib/api/session', () => ({ useSession: () => ({ data: { user: { id: 'creator' } } }) }));
vi.mock('../../features/build-chat/Chat', () => ({
  Chat: ({ dictationTarget }: { dictationTarget?: { kind: string; game_id: string; creator_id: string } }) => (
    <output>{JSON.stringify(dictationTarget)}</output>
  ),
}));

it('authorizes transcription against the game before a build job exists', () => {
  render(<EditConversation gameId="game" branchId="main" title="Game" onAdmitted={() => {}} reading="inline" />);
  expect(JSON.parse(screen.getByRole('status').textContent!)).toEqual({
    kind: 'edit',
    game_id: 'game',
    creator_id: 'creator',
    session_id: expect.any(String),
  });
});

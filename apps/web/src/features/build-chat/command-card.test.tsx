import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CommandCard } from './command-card';

const message = {
  id: 'm_8f1c2a4e-5b6d-4c7e-9f00-1a2b3c4d5e6f',
  job_id: 'j_8f1c2a4e-5b6d-4c7e-9f00-1a2b3c4d5e6f',
  at: '2026-11-01T09:15:00Z',
  actor: 'agent' as const,
  kind: 'command' as const,
  command: {
    decision_id: 'decision-1',
    question: 'Which door?',
    options: [
      { id: 'wood', label: 'Wooden' },
      { id: 'iron', label: 'Iron' },
    ],
    recommend: 'iron',
    blocking: true,
    status: 'open' as const,
  },
};

afterEach(cleanup);

describe('CommandCard', () => {
  it('puts the recommended option first, marks it in text, and keeps 64px targets', () => {
    render(<CommandCard message={message} budget={{ used: 2, max: 3 }} onAnswer={vi.fn()} />);

    const options = screen.getAllByRole('button');
    expect(options.map((option) => option.getAttribute('aria-label'))).toEqual(['Iron', 'Wooden']);
    expect(options[0]).toHaveTextContent("Builder's pick");
    expect(options[0]).toHaveStyle({ minHeight: '64px' });
    expect(screen.getByText('Question 2 of 3')).toBeVisible();
    expect(screen.getByText('The builder is waiting on this')).toBeVisible();
  });

  it('badges a generated asset option', () => {
    const generated = {
      ...message,
      command: {
        ...message.command,
        options: [{ id: 'wood', label: 'Wooden', aiGenerated: true }],
      },
    };
    render(<CommandCard message={generated} onAnswer={vi.fn()} />);

    expect(screen.getByLabelText('AI-generated')).toHaveTextContent('AI');
    expect(screen.getByRole('button', { name: 'Wooden, AI-generated' })).toBeVisible();
  });

  it('shows an unlinked command as waiting with no tappable choices', () => {
    render(
      <CommandCard message={{ ...message, command: { ...message.command, decision_id: '' } }} onAnswer={vi.fn()} />,
    );

    expect(screen.getByText('Waiting for the builder to ask')).toBeVisible();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('shows the answered choice and never calls the answer handler again', () => {
    const onAnswer = vi.fn();
    render(
      <CommandCard
        message={{
          ...message,
          command: { ...message.command, status: 'answered', option_id: 'wood' },
        }}
        onAnswer={onAnswer}
      />,
    );

    const chosen = screen.getByRole('button', { name: 'Wooden' });
    expect(chosen).toHaveAttribute('aria-pressed', 'true');
    expect(chosen).toBeDisabled();
    fireEvent.click(chosen);
    expect(onAnswer).not.toHaveBeenCalled();
  });

  it('shows a moot command without choices', () => {
    render(
      <CommandCard message={{ ...message, command: { ...message.command, status: 'moot' } }} onAnswer={vi.fn()} />,
    );

    expect(screen.getByText('No longer needed')).toBeVisible();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});

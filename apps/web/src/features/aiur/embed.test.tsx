import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { commandFixture } from '../commands-inbox/fixtures';
import { AIUR_COMMANDS_TAG, AIUR_CONVERSATION_TAG, AiurCommands, AiurConversation, gameScope, jobScope } from './embed';

// aiur's packages are not in the workspace yet (aiur#7487, #7488), so the adapter has to work both ways: today it
// renders the surface's own markup, and once aiur ships the custom element it hands that element the same props.
function defineStub(tag: string) {
  if (customElements.get(tag)) return;
  customElements.define(tag, class extends HTMLElement {});
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('aiur embed adapter', () => {
  it('renders the surface markup and scopes it to the game while aiur is not installed', () => {
    expect(customElements.get(AIUR_COMMANDS_TAG)).toBeUndefined();
    const scope = gameScope('g_1', ['478']);
    render(
      <AiurCommands scope={scope} commands={[commandFixture()]} onAnswer={() => undefined}>
        <p>own markup</p>
      </AiurCommands>,
    );

    expect(screen.getByText('own markup')).toBeVisible();
    expect(document.querySelector(AIUR_COMMANDS_TAG)).toBeNull();
    expect(scope).toEqual({
      game: 'g_1',
      tickets: ['478'],
      commands: '/api/v1/games/g_1/commands',
      conversation: '',
      stream: '',
    });
  });

  it('hands the installed element its commands and reports its answers', async () => {
    defineStub(AIUR_COMMANDS_TAG);
    const onAnswer = vi.fn();
    const commands = [commandFixture()];
    render(
      <AiurCommands scope={gameScope('g_1', ['478'])} commands={commands} onAnswer={onAnswer}>
        <p>own markup</p>
      </AiurCommands>,
    );

    const element = document.querySelector(AIUR_COMMANDS_TAG);
    expect(element).not.toBeNull();
    expect(element).toHaveAttribute('data-tickets', '478');
    expect(element).toHaveProperty('commands', commands);
    expect(element).toHaveProperty('scope.commands', '/api/v1/games/g_1/commands');

    element!.dispatchEvent(
      new CustomEvent('aiur-answer', {
        detail: { job_id: 'j_1', command_id: 'm_3', option_id: 'stone' },
      }),
    );

    await waitFor(() =>
      expect(onAnswer).toHaveBeenCalledWith({ job_id: 'j_1', command_id: 'm_3', option_id: 'stone' }),
    );
  });

  it('scopes a job conversation to its ticket and to the job proxy', () => {
    defineStub(AIUR_CONVERSATION_TAG);
    const onAnswer = vi.fn();
    render(
      <AiurConversation scope={jobScope('g_1', 'j_1', '478')} title="Build the moon gate" onAnswer={onAnswer}>
        <p>own conversation</p>
      </AiurConversation>,
    );

    const element = document.querySelector(AIUR_CONVERSATION_TAG);
    expect(element).toHaveProperty('title', 'Build the moon gate');
    expect(element).toHaveProperty('scope.tickets', ['478']);
    expect(element).toHaveProperty('scope.conversation', '/api/v1/jobs/j_1/chat/messages');
    expect(element).toHaveProperty('scope.stream', '/api/v1/jobs/j_1/chat');

    element!.dispatchEvent(
      new CustomEvent('aiur-answer', { detail: { job_id: 'j_1', command_id: 'm_3', option_id: 'wood' } }),
    );
    expect(onAnswer).toHaveBeenCalledWith({ job_id: 'j_1', command_id: 'm_3', option_id: 'wood' });
  });

  it('scopes a job with no ticket to an empty ticket set', () => {
    expect(jobScope('g_1', 'j_1', null).tickets).toEqual([]);
  });

  it('keeps the latest answer handler without re-registering the listener', () => {
    defineStub(AIUR_COMMANDS_TAG);
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = render(
      <AiurCommands scope={gameScope('g_1', [])} commands={[]} onAnswer={first}>
        <p>own markup</p>
      </AiurCommands>,
    );
    rerender(
      <AiurCommands scope={gameScope('g_1', [])} commands={[]} onAnswer={second}>
        <p>own markup</p>
      </AiurCommands>,
    );

    fireEvent(
      document.querySelector(AIUR_COMMANDS_TAG)!,
      new CustomEvent('aiur-answer', { detail: { job_id: 'j_1', command_id: 'm_3', option_id: 'wood' } }),
    );

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });
});

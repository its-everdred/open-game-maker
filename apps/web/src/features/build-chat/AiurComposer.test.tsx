import { render, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import type { AiurComposer as ComposerElement } from '@aiur/conversation';
import { AiurComposer } from './AiurComposer';

it('sends a draft through the host job adapter', async () => {
  const startJob = vi.fn().mockResolvedValue('job-1');
  const postText = vi.fn();
  const { container } = render(<AiurComposer jobId="draft" startJob={startJob} postText={postText} />);
  const composer = container.querySelector('aiur-composer') as ComposerElement;
  await waitFor(() => expect(composer.onSend).toBeTypeOf('function'));
  composer.value = 'Make it brighter';
  await composer.send();
  expect(startJob).toHaveBeenCalledWith('Make it brighter');
  expect(postText).not.toHaveBeenCalled();
});

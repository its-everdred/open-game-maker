import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { BugComposer } from './BugComposer';

const openConversation = vi.hoisted(() => vi.fn());
vi.mock('../build-chat/conversation', () => ({ openConversation }));

afterEach(() => {
  cleanup();
  openConversation.mockClear();
});

function describeIssue(text: string) {
  fireEvent.change(screen.getByRole('textbox', { name: 'Describe the issue' }), { target: { value: text } });
  fireEvent.click(screen.getByRole('button', { name: 'Send' }));
}

describe('File a bug (#1326)', () => {
  it('sends the description with the log, then offers the agent or close', async () => {
    const fileBug = vi.fn().mockResolvedValue({ jobId: 'job-7' });
    const onBack = vi.fn();
    render(<BugComposer log="game g1" fileBug={fileBug} onBack={onBack} />);
    expect(screen.getByText('game.log')).toBeInTheDocument();
    await act(async () => describeIssue('The goblin froze'));
    expect(fileBug).toHaveBeenCalledWith('The goblin froze', 'game g1', expect.any(String), []);
    fireEvent.click(screen.getByRole('button', { name: 'Keep talking to the agent' }));
    expect(openConversation).toHaveBeenCalledWith('job-7');
    expect(onBack).toHaveBeenCalled();
  });

  it('offers only Close when no agent took the bug', async () => {
    render(<BugComposer log="" fileBug={vi.fn().mockResolvedValue({})} onBack={vi.fn()} />);
    await act(async () => describeIssue('Sound cuts out'));
    expect(screen.queryByRole('button', { name: 'Keep talking to the agent' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument();
  });

  it('shows captured stills and sends them with the report', async () => {
    const capture = { label: '−5 s', image: 'data:image/webp;base64,YWJj' };
    const fileBug = vi.fn().mockResolvedValue({});
    render(
      <BugComposer
        log="game g1"
        fileBug={fileBug}
        captureStills={vi.fn().mockResolvedValue([capture])}
        onBack={vi.fn()}
      />,
    );
    await act(async () => Promise.resolve());
    expect(screen.getByRole('img', { name: 'Game screenshot −5 s' })).toHaveAttribute('src', capture.image);
    await act(async () => describeIssue('The door is stuck'));
    expect(fileBug).toHaveBeenCalledWith('The door is stuck', 'game g1', expect.any(String), [capture]);
  });

  it('waits for the current screenshot request when the player submits immediately', async () => {
    let finishCapture!: (captures: { label: string; image: string }[]) => void;
    const capture = { label: 'Now', image: 'data:image/webp;base64,YWJj' };
    const captureStills = vi.fn(
      () => new Promise<{ label: string; image: string }[]>((resolve) => (finishCapture = resolve)),
    );
    const fileBug = vi.fn().mockResolvedValue({});
    render(<BugComposer log="game g1" fileBug={fileBug} captureStills={captureStills} onBack={vi.fn()} />);

    fireEvent.change(screen.getByRole('textbox', { name: 'Describe the issue' }), {
      target: { value: 'The door is stuck' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(fileBug).not.toHaveBeenCalled();

    await act(async () => finishCapture([capture]));
    expect(fileBug).toHaveBeenCalledWith('The door is stuck', 'game g1', expect.any(String), [capture]);
  });

  it('still submits the bug when screenshot capture is unsupported', async () => {
    const fileBug = vi.fn().mockResolvedValue({});
    render(
      <BugComposer
        log="game g1"
        fileBug={fileBug}
        captureStills={vi.fn().mockRejectedValue(new Error('unsupported'))}
        onBack={vi.fn()}
      />,
    );

    await act(async () => describeIssue('The game froze'));

    expect(fileBug).toHaveBeenCalledWith('The game froze', 'game g1', expect.any(String), []);
  });

  it('keeps a failed bug on screen with Retry', async () => {
    const fileBug = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({});
    render(<BugComposer log="log" fileBug={fileBug} onBack={vi.fn()} />);
    await act(async () => describeIssue('Stuck on the gate'));
    expect(screen.getByText('Not sent')).toBeInTheDocument();
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Retry' })));
    // The retry is the same bug, so it carries the same attempt and cannot file twice.
    expect(fileBug.mock.calls[1]).toEqual(fileBug.mock.calls[0]);
    expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument();
  });

  it('does not send an empty description', () => {
    const fileBug = vi.fn();
    render(<BugComposer log="" fileBug={fileBug} onBack={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
    expect(fileBug).not.toHaveBeenCalled();
  });
});

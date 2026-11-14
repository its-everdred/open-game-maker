import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SharedSettings } from './SharedSettings';

const auth = vi.hoisted(() => ({ signOut: vi.fn(), reset: vi.fn() }));
vi.mock('../../lib/api/auth', () => ({ signOut: auth.signOut }));
vi.mock('../../features/commands-inbox/drafts', () => ({ resetReviewDrafts: auth.reset }));
afterEach(cleanup);

describe('shared game settings', () => {
  it('changes sound and music independently and forwards game options', () => {
    const onChange = vi.fn();
    const onGameOptionsChange = vi.fn();
    const onBindingsChange = vi.fn();
    render(
      <MemoryRouter>
        <SharedSettings
          settings={{ mute: false, volume: 0.8, musicVolume: 0.6, textScale: 1, reduceMotion: false }}
          onChange={onChange}
          actions={{ jump: 'button' }}
          bindings={{ Space: 'jump' }}
          reservedKeys={['KeyR']}
          onBindingsChange={onBindingsChange}
          options={[
            { id: 'hints', label: 'Hints', kind: 'toggle', default: true },
            {
              id: 'mode',
              label: 'Mode',
              kind: 'choice',
              default: 'a',
              choices: [
                { value: 'a', label: 'A' },
                { value: 'b', label: 'B' },
              ],
            },
            { id: 'level', label: 'Level', kind: 'number', default: 1, min: 1, max: 10, step: 1 },
          ]}
          gameOptions={{ hints: true }}
          onGameOptionsChange={onGameOptionsChange}
        />
      </MemoryRouter>,
    );

    fireEvent.change(screen.getByRole('slider', { name: 'Music volume' }), { target: { value: '0.25' } });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ volume: 0.8, musicVolume: 0.25 }));
    fireEvent.click(screen.getByText('Controls'));
    fireEvent.click(screen.getByRole('button', { name: 'jump: Space' }));
    fireEvent.keyDown(screen.getByRole('button', { name: 'jump: press a key' }), { key: 'Tab', code: 'Tab' });
    expect(onBindingsChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'jump: Space' }));
    fireEvent.keyDown(screen.getByRole('button', { name: 'jump: press a key' }), { key: 'Escape', code: 'Escape' });
    expect(onBindingsChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'jump: Space' }));
    fireEvent.keyDown(screen.getByRole('button', { name: 'jump: press a key' }), { code: 'KeyR' });
    expect(onBindingsChange).not.toHaveBeenCalled();
    fireEvent.keyDown(screen.getByRole('button', { name: 'jump: press a key' }), { code: 'F5' });
    expect(onBindingsChange).not.toHaveBeenCalled();
    fireEvent.keyDown(screen.getByRole('button', { name: 'jump: press a key' }), { code: 'KeyJ' });
    expect(onBindingsChange).toHaveBeenCalledWith({ KeyJ: 'jump' });
    fireEvent.click(screen.getByText('Game options'));
    fireEvent.click(screen.getByLabelText('Hints'));
    expect(onGameOptionsChange).toHaveBeenCalledWith({ hints: false });
    fireEvent.change(screen.getByLabelText('Mode'), { target: { value: 'b' } });
    expect(onGameOptionsChange).toHaveBeenLastCalledWith({ hints: true, mode: 'b' });
    fireEvent.change(screen.getByLabelText('Level'), { target: { value: '15' } });
    expect(onGameOptionsChange).toHaveBeenLastCalledWith({ hints: true, level: 10 });
    fireEvent.change(screen.getByLabelText('Level'), { target: { value: '1.5' } });
    expect(onGameOptionsChange).toHaveBeenLastCalledWith({ hints: true, level: 2 });
  });

  it('disables sign out while pending and allows retry after failure', async () => {
    let reject!: (reason: Error) => void;
    auth.signOut
      .mockReset()
      .mockImplementationOnce(
        () =>
          new Promise((_resolve, fail) => {
            reject = fail;
          }),
      )
      .mockResolvedValueOnce(undefined);
    auth.reset.mockReset();
    render(
      <MemoryRouter>
        <SharedSettings
          settings={{ mute: false, volume: 1, textScale: 1, reduceMotion: false }}
          onChange={vi.fn()}
          actions={{}}
          options={[]}
          gameOptions={{}}
          onGameOptionsChange={vi.fn()}
        />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByText('Account'));
    const button = screen.getByRole('button', { name: 'Sign out' });
    fireEvent.click(button);
    expect(button).toBeDisabled();
    reject(new Error('offline'));
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not sign out');
    expect(button).toBeEnabled();
    expect(auth.reset).not.toHaveBeenCalled();
    fireEvent.click(button);
    await vi.waitFor(() => expect(auth.reset).toHaveBeenCalledOnce());
  });
});

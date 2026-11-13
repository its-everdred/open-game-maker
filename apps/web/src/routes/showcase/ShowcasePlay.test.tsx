import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GameMenuProvider } from '../../app/GameMenu';
import { ShowcasePlay } from './ShowcasePlay';

afterEach(cleanup);

describe('showcase play', () => {
  it('opens the staged prototype demo with the selected title and mode', () => {
    render(
      <MemoryRouter initialEntries={['/g/showcase/restorebound?mode=play']}>
        <GameMenuProvider>
          <Routes>
            <Route path="/g/showcase/:id" element={<ShowcasePlay />} />
          </Routes>
        </GameMenuProvider>
      </MemoryRouter>,
    );
    const frame = screen.getByTitle('RestoreBound') as HTMLIFrameElement;
    expect(frame).toHaveAttribute('src', '/proto/demo/index.html?shell=&models=json&editor=&title=RestoreBound&play=');
    const demoDocument = document.implementation.createHTMLDocument('demo');
    Object.defineProperty(frame, 'contentDocument', { value: demoDocument });
    fireEvent.load(frame);
    expect(demoDocument.head.textContent).toContain("grid-template-areas: 'stage' 'rail' 'tray'");
  });

  it('applies the latest mode when the editor becomes ready after a mode change', () => {
    vi.useFakeTimers();
    function SwitchMode() {
      const navigate = useNavigate();
      return <button onClick={() => navigate('?mode=edit')}>Switch</button>;
    }
    render(
      <MemoryRouter initialEntries={['/g/showcase/restorebound?mode=play']}>
        <GameMenuProvider>
          <Routes>
            <Route
              path="/g/showcase/:id"
              element={
                <>
                  <SwitchMode />
                  <ShowcasePlay />
                </>
              }
            />
          </Routes>
        </GameMenuProvider>
      </MemoryRouter>,
    );
    const frame = screen.getByTitle('RestoreBound') as HTMLIFrameElement;
    const document = window.document.implementation.createHTMLDocument('demo');
    document.body.innerHTML = '<button id="play"></button>';
    Object.defineProperty(frame, 'contentDocument', { value: document });
    const post = vi.spyOn(frame.contentWindow!, 'postMessage');
    fireEvent.load(frame);
    fireEvent.click(screen.getByText('Switch'));
    const play = document.querySelector('button')!;
    play.onclick = () => {};
    act(() => vi.advanceTimersByTime(100));
    expect(post).toHaveBeenLastCalledWith({ ogm: 'edit' }, window.location.origin);
    cleanup();
    vi.useRealTimers();
  });
});

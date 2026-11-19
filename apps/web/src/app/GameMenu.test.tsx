import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { GameMenuProvider, useGameMenu } from './GameMenu';

it('keeps the game menu open while a save load is locked', () => {
  function Controls() {
    const menu = useGameMenu();
    return (
      <>
        <output>{menu.open ? 'open' : 'closed'}</output>
        <button onClick={() => menu.setOpen(true)}>Open</button>
        <button onClick={() => menu.setCloseLocked(true)}>Lock</button>
        <button onClick={() => menu.setOpen(false)}>Outside</button>
        <button onClick={() => menu.setOpen((open) => !open)}>Toggle</button>
        <button onClick={() => menu.setCloseLocked(false)}>Unlock</button>
      </>
    );
  }
  render(
    <GameMenuProvider>
      <Controls />
    </GameMenuProvider>,
  );
  fireEvent.click(screen.getByText('Open'));
  fireEvent.click(screen.getByText('Lock'));
  fireEvent.click(screen.getByText('Outside'));
  fireEvent.click(screen.getByText('Toggle'));
  expect(screen.getByText('open')).toBeTruthy();
  fireEvent.click(screen.getByText('Unlock'));
  fireEvent.click(screen.getByText('Toggle'));
  expect(screen.getByText('closed')).toBeTruthy();
});

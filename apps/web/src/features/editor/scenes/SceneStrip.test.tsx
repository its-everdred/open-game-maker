import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { MemoryRouter, useLocation } from 'react-router';

import { loadScenes, newScene } from './scene-source';
import { SceneStrip } from './SceneStrip';

afterEach(cleanup);

let search = '';
function Probe() {
  search = useLocation().search;
  return null;
}

async function renderStrip(entry: string, gameId = 'dusk-helm') {
  render(
    <MemoryRouter initialEntries={[entry]}>
      <SceneStrip gameId={gameId} />
      <Probe />
    </MemoryRouter>,
  );
  await act(async () => {});
}

describe('scene source', () => {
  it('shows sample scenes only on a review link, so a live editor never lists made-up scenes', async () => {
    expect(await loadScenes('dusk-helm', null)).toEqual([]);
    expect(await loadScenes('blobs', 'fixture')).toEqual([]);
    const scenes = await loadScenes('dusk-helm', 'fixture');
    expect(scenes.map((scene) => [scene.title, scene.scenario])).toEqual([
      ['Graveyard landmark', 'graveyard-landmark'],
      ['Lush fields', 'lush-fields'],
      ['Goblin cave', 'goblin-cave'],
      ['Miniboss arena', 'miniboss-arena'],
    ]);
  });

  it('makes a new scene the creator owns, without reusing an id', () => {
    expect(newScene([{ id: 'scene-2', title: 'Scene 2', rev: 1, author: 'agent:9' }])).toEqual({
      id: 'scene-3',
      title: 'Scene 3',
      rev: 0,
      author: 'kevin',
    });
  });
});

describe('SceneStrip', () => {
  it('stays out of the edit page when the game has no scenes to list', async () => {
    await renderStrip('/g/dusk-helm?mode=edit');
    expect(screen.queryByRole('group', { name: 'Scenes' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Scenes' })).not.toBeInTheDocument();
  });

  it('says who changed each scene last and marks the one the game is showing', async () => {
    await renderStrip('/g/dusk-helm?mode=edit&scenes=fixture&scenario=lush-fields');
    expect(screen.getByRole('button', { name: 'Graveyard landmark, changed by you' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    expect(screen.getByRole('button', { name: 'Lush fields, changed by an agent' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByRole('button', { name: 'Goblin cave, an agent is changing it' })).toBeInTheDocument();
  });

  it('opens a tapped scene in the game', async () => {
    await renderStrip('/g/dusk-helm?mode=edit&scenes=fixture');
    fireEvent.click(screen.getByRole('button', { name: 'Goblin cave, an agent is changing it' }));
    const params = new URLSearchParams(search);
    expect(params.get('scene')).toBe('goblin-cave');
    expect(params.get('scenario')).toBe('goblin-cave');
    expect(params.get('mode')).toBe('edit');
    expect(screen.getByRole('button', { name: 'Goblin cave, an agent is changing it' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('adds a new scene of yours and opens it', async () => {
    await renderStrip('/g/dusk-helm?mode=edit&scenes=fixture&scenario=lush-fields');
    fireEvent.click(screen.getByRole('button', { name: 'New scene' }));
    expect(screen.getByRole('button', { name: 'Scene 5, changed by you' })).toHaveAttribute('aria-pressed', 'true');
    const params = new URLSearchParams(search);
    expect(params.get('scene')).toBe('scene-5');
    expect(params.has('scenario')).toBe(false);
  });

  it('hides and shows the chips', async () => {
    await renderStrip('/g/dusk-helm?mode=edit&scenes=fixture');
    const toggle = screen.getByRole('button', { name: 'Scenes' });
    const strip = screen.getByRole('group', { name: 'Scenes' });
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    expect(strip).toHaveClass('is-hidden');
    expect(strip).toHaveAttribute('inert');
    fireEvent.click(toggle);
    expect(strip).not.toHaveClass('is-hidden');
  });
});

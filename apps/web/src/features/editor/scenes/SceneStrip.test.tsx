import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, useLocation } from 'react-router';

const getEditorScenes = vi.hoisted(() => vi.fn());
vi.mock('../api', () => ({ getEditorScenes }));

import { canCreateScene, loadScenes, newScene, sceneEditorPath } from './scene-source';
import { SceneStrip } from './SceneStrip';

afterEach(cleanup);
beforeEach(() => {
  getEditorScenes.mockReset();
  getEditorScenes.mockRejectedValue(new Error('scenery_source_unavailable'));
});

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
  it("lists the game's scene documents with who wrote each head", async () => {
    getEditorScenes.mockResolvedValue({
      scenes: [
        {
          id: 'goblin-cave',
          rev: 4,
          author: 'agent:1212',
          updatedAt: '2026-11-21T00:00:00.000Z',
          ticket: '1208',
          agents: { '1208': 1, '1212': 4 },
        },
        { id: 'graveyard', rev: 2, author: 'kevin', updatedAt: '2026-11-20T00:00:00.000Z', agents: {} },
      ],
    });
    expect(await loadScenes('dusk-helm', null)).toEqual([
      { id: 'goblin-cave', title: 'Goblin cave', rev: 4, author: 'agent:1212', ticket: '1208' },
      { id: 'graveyard', title: 'Graveyard', rev: 2, author: 'kevin', ticket: undefined },
    ]);
    expect(getEditorScenes).toHaveBeenCalledWith('dusk-helm');
  });

  it("lists nothing when the game's scenes cannot be read, so the strip stays out of the way", async () => {
    expect(await loadScenes('dusk-helm', null)).toEqual([]);
  });

  it('shows sample scenes only on a review link, so a live editor never lists made-up scenes', async () => {
    expect(await loadScenes('blobs', 'fixture')).toEqual([]);
    const scenes = await loadScenes('dusk-helm', 'fixture');
    expect(scenes.map((scene) => [scene.title, scene.scenario])).toEqual([
      ['Graveyard landmark', 'graveyard-landmark'],
      ['Lush fields', 'lush-fields'],
      ['Goblin cave', 'goblin-cave'],
      ['Miniboss arena', 'miniboss-arena'],
    ]);
  });

  it('links straight to one scene in the editor, at the revision an agent pushed', () => {
    expect(sceneEditorPath('dusk-helm', 'goblin-cave', 3)).toBe('/g/dusk-helm?mode=edit&scene=goblin-cave&rev=3');
    expect(sceneEditorPath('dusk helm', 'goblin-cave')).toBe('/g/dusk%20helm?mode=edit&scene=goblin-cave');
  });

  it('keeps + off until the editor can write a scene, so a new chip never vanishes on reload', () => {
    expect(canCreateScene()).toBe(false);
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

  it('shows real scenes without a review link and marks the opened one', async () => {
    getEditorScenes.mockResolvedValue({
      scenes: [
        { id: 'graveyard', rev: 2, author: 'kevin', updatedAt: '2026-11-20T00:00:00.000Z', agents: {} },
        {
          id: 'goblin-cave',
          rev: 4,
          author: 'agent:1212',
          updatedAt: '2026-11-21T00:00:00.000Z',
          ticket: '1208',
          agents: { '1208': 1, '1212': 4 },
        },
      ],
    });
    await renderStrip('/g/dusk-helm?mode=edit&scene=graveyard&rev=2');
    expect(screen.getByRole('button', { name: 'Graveyard, changed by you, revision 2' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    /* An agent's scene names the ticket that started it, so Kevin can tell whose prototype it was. */
    expect(
      screen.getByRole('button', { name: 'Goblin cave, changed by an agent, revision 4, from ticket 1208' }),
    ).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: 'New scene' })).toBeDisabled();
  });

  it('says who changed each scene last and marks the one the game is showing', async () => {
    await renderStrip('/g/dusk-helm?mode=edit&scenes=fixture&scenario=lush-fields');
    expect(screen.getByRole('button', { name: 'Graveyard landmark, changed by you, revision 7' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    expect(screen.getByRole('button', { name: 'Lush fields, changed by an agent, revision 3' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(
      screen.getByRole('button', { name: 'Goblin cave, an agent is changing it, revision 5' }),
    ).toBeInTheDocument();
  });

  it('opens a tapped scene in the game', async () => {
    await renderStrip('/g/dusk-helm?mode=edit&scenes=fixture');
    fireEvent.click(screen.getByRole('button', { name: 'Goblin cave, an agent is changing it, revision 5' }));
    const params = new URLSearchParams(search);
    expect(params.get('scene')).toBe('goblin-cave');
    expect(params.get('scenario')).toBe('goblin-cave');
    expect(params.get('mode')).toBe('edit');
    expect(screen.getByRole('button', { name: 'Goblin cave, an agent is changing it, revision 5' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('keeps + off while the scenes are samples, since the game cannot show a blank scene yet', async () => {
    await renderStrip('/g/dusk-helm?mode=edit&scenes=fixture&scenario=lush-fields');
    expect(screen.getByRole('button', { name: 'New scene' })).toBeDisabled();
  });

  it('keeps the chips out of the edit bar group styling', async () => {
    await renderStrip('/g/dusk-helm?mode=edit&scenes=fixture');
    expect(screen.getByRole('group', { name: 'Scenes' }).parentElement).toHaveClass('scene-strip-layer');
  });

  it('starts with the chips hidden behind the map button, as Kevin picked', async () => {
    await renderStrip('/g/dusk-helm?mode=edit&scenes=fixture');
    const toggle = screen.getByRole('button', { name: 'Scenes' });
    const strip = screen.getByRole('group', { name: 'Scenes' });
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    expect(strip).toHaveClass('is-hidden');
    expect(strip).toHaveAttribute('inert');
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
    expect(strip).not.toHaveClass('is-hidden');
    expect(strip).not.toHaveAttribute('inert');
    fireEvent.click(toggle);
    expect(strip).toHaveClass('is-hidden');
  });
});

/* Kevin, #1281: the editor starts any moment of the game, so the build's declared scenarios are chips too. */
describe('declared scenarios', () => {
  it('lists the running build’s scenarios and starts the game in the one tapped', async () => {
    render(
      <MemoryRouter initialEntries={['/g/blobs?mode=edit']}>
        <SceneStrip gameId="blobs" scenarios={['endless/wave-3', 'goo-chain']} />
        <Probe />
      </MemoryRouter>,
    );
    await act(async () => {});
    fireEvent.click(screen.getByRole('button', { name: 'Endless wave 3, changed by an agent' }));
    expect(new URLSearchParams(search).get('scenario')).toBe('endless/wave-3');
    expect(screen.getByRole('button', { name: 'Endless wave 3, changed by an agent' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByRole('button', { name: 'Goo chain, changed by an agent' })).toBeVisible();
  });

  it('keeps a build’s scenarios while it reloads, and drops them for another build', async () => {
    const strip = (build: string, scenarios?: string[]) => (
      <MemoryRouter initialEntries={['/g/blobs?mode=edit']}>
        <SceneStrip gameId="blobs" build={build} scenarios={scenarios} />
      </MemoryRouter>
    );
    const { rerender } = render(strip('b1', ['goo-chain']));
    await act(async () => {});
    rerender(strip('b1'));
    expect(screen.getByRole('button', { name: 'Goo chain, changed by an agent' })).toBeVisible();
    rerender(strip('b2'));
    expect(screen.queryByRole('button', { name: 'Goo chain, changed by an agent' })).toBeNull();
  });
});

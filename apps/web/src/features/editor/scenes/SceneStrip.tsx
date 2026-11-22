import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';

import { Icon } from '../../../components/Icon';
import { isAgent, loadScenes, newScene, type SceneCard } from './scene-source';
import './scene-strip.css';

/** The edit page's scene chips (Kevin's pick B on #1191): every scene of the game, who changed it last, and a +. */
export function SceneStrip({ gameId }: { gameId: string }) {
  const [searchParams, setSearchParams] = useSearchParams();
  /** `fixture` shows the sample scenes. */
  const source = searchParams.get('scenes');
  /** The open scene; without one, the game's running scenario picks the card until the game loads scene documents. */
  const scene = searchParams.get('scene');
  const scenario = searchParams.get('scenario');
  const onOpen = (card: SceneCard) => {
    const next = new URLSearchParams(searchParams);
    next.set('scene', card.id);
    if (card.scenario === undefined) next.delete('scenario');
    else next.set('scenario', card.scenario);
    setSearchParams(next, { replace: true });
  };
  const [scenes, setScenes] = useState<SceneCard[]>([]);
  const [shown, setShown] = useState(true);
  useEffect(() => {
    let current = true;
    void loadScenes(gameId, source).then((loaded) => current && setScenes(loaded));
    return () => {
      current = false;
    };
  }, [gameId, source]);
  if (scenes.length === 0) return null;
  const open = scenes.find((card) =>
    scene !== null ? card.id === scene : scenario !== null && card.scenario === scenario,
  );
  return (
    <>
      <button
        className="scene-strip-toggle"
        type="button"
        aria-label="Scenes"
        aria-pressed={shown}
        onClick={() => setShown((value) => !value)}
      >
        <Icon name="map" />
      </button>
      <div className={shown ? 'scene-strip' : 'scene-strip is-hidden'} inert={!shown} aria-label="Scenes" role="group">
        <button
          className="scene-strip-add"
          type="button"
          aria-label="New scene"
          onClick={() => {
            const card = newScene(scenes);
            setScenes([...scenes, card]);
            onOpen(card);
          }}
        >
          <Icon name="plus" />
        </button>
        {scenes.map((card) => {
          const agent = isAgent(card.author);
          return (
            <button
              key={card.id}
              className="scene-chip"
              type="button"
              aria-pressed={card === open}
              aria-label={`${card.title}, ${card.live ? 'an agent is changing it' : agent ? 'changed by an agent' : 'changed by you'}`}
              ref={(node) => {
                if (node && card === open) node.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
              }}
              onClick={() => onOpen(card)}
            >
              <span className="scene-chip-picture">
                {card.thumbnail ? (
                  <img src={card.thumbnail} alt="" />
                ) : (
                  <span className="scene-chip-letter">{card.title.charAt(0)}</span>
                )}
                <span className={`scene-chip-who${agent ? ' is-agent' : ''}${card.live ? ' is-live' : ''}`}>
                  <Icon name={agent ? 'agent' : 'person'} />
                </span>
              </span>
              <span className="scene-chip-name">{card.title}</span>
            </button>
          );
        })}
      </div>
    </>
  );
}

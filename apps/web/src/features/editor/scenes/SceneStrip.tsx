import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';

import { Icon } from '../../../components/Icon';
import { canCreateScene, isAgent, loadScenes, newScene, scenarioCards, type SceneCard } from './scene-source';
import './scene-strip.css';

/**
 * The edit page's scene chips (Kevin's pick B on #1191): every scene of the game, who changed it last, and a +. The
 * running build's declared scenarios follow, so the editor can start any of them (#1281).
 */
export function SceneStrip({
  gameId,
  build,
  scenarios,
}: {
  gameId: string;
  /** The running build; its scenarios are only offered while it runs. */
  build?: string;
  scenarios?: readonly string[];
}) {
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
  const [loaded, setScenes] = useState<SceneCard[]>([]);
  /* The list outlives the frame: picking a scenario remounts the game, which reports its scenarios again once ready.
     It belongs to one build, so another build's chips never start a scenario this one lacks. */
  const [declared, setDeclared] = useState<{ build?: string; names: readonly string[] }>({ names: [] });
  useEffect(() => {
    if (scenarios?.length) setDeclared({ build, names: scenarios });
  }, [build, scenarios]);
  const scenes = [...loaded, ...scenarioCards(declared.build === build ? declared.names : [], loaded)];
  /** The chips start hidden behind the map button (Kevin, #1191). */
  const [shown, setShown] = useState(false);
  const strip = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let current = true;
    void loadScenes(gameId, source).then((loaded) => current && setScenes(loaded));
    return () => {
      current = false;
    };
  }, [gameId, source]);
  const open = scenes.find((card) =>
    scene !== null ? card.id === scene : scenario !== null && card.scenario === scenario,
  );
  useEffect(() => {
    strip.current
      ?.querySelector('[aria-pressed="true"]')
      ?.scrollIntoView?.({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
  }, [open?.id]);
  if (scenes.length === 0) return null;
  return (
    <div className="scene-strip-layer">
      <button
        className="scene-strip-toggle"
        type="button"
        aria-label="Scenes"
        aria-pressed={shown}
        onClick={() => setShown((value) => !value)}
      >
        <Icon name="map" />
      </button>
      <div
        ref={strip}
        className={shown ? 'scene-strip' : 'scene-strip is-hidden'}
        inert={!shown}
        aria-label="Scenes"
        role="group"
      >
        <button
          className="scene-strip-add"
          type="button"
          aria-label="New scene"
          disabled={!canCreateScene()}
          onClick={() => {
            const card = newScene(scenes);
            setScenes([...loaded, card]);
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
              aria-label={chipLabel(card, agent)}
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
    </div>
  );
}

/** Who changed the scene, its revision and the ticket that started it. */
function chipLabel(card: SceneCard, agent: boolean): string {
  const who = card.live ? 'an agent is changing it' : agent ? 'changed by an agent' : 'changed by you';
  return [card.title, who, card.rev > 0 && `revision ${card.rev}`, card.ticket && `from ticket ${card.ticket}`]
    .filter(Boolean)
    .join(', ');
}

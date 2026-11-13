import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { useNavigate, useSearchParams } from 'react-router';

import { registerTestApi } from '../../app/testHook';
import { ScopeChat } from '../../features/scope-chat';
import { AudioStyleStep } from './AudioStyleStep';
import { styleChoices, useAudioStyles, useCatalog } from './catalog';
import { OptionTile } from './OptionTile';
import { OtherTile } from './OtherTile';
import { StyleStep } from './StyleStep';
import {
  STEP_ORDER,
  STATIC_STEPS,
  choiceLabels,
  scopeChoicesFrom,
  viewsFor,
  type ChoiceKey,
  type NewGameChoices,
  type Option,
  type StepChoice,
  type StepDefinition,
  type StepKey,
} from './options';
import { useCreateGame } from './useCreateGame';
import './new.css';
import './new-prototype.css';

const VIEW_LABELS: Record<string, string> = {
  iso: 'Isometric',
  topdown: 'Top-down',
  side: 'Side view',
  follow: 'Follow',
  fps: 'First person',
  orbit: 'Orbit',
  fixed: 'Fixed',
};

const STEP_COLORS: Record<ChoiceKey, string> = {
  genre: 'var(--orange-b)',
  vibe: 'var(--purple-b)',
  family: 'var(--blue-b)',
  sound: 'var(--red-b)',
  world: 'var(--green-b)',
  players: 'var(--aqua-b)',
  view: 'var(--yellow-b)',
};

const PROTOTYPE_STEPS: StepKey[] = ['genre', 'vibe', 'family', 'world', 'players', 'talk'];

const testState: { step: StepKey; picks: NewGameChoices; sessionId?: string } = {
  step: 'genre',
  picks: {},
};
let testApiRegistered = false;

export function NewGameScreen() {
  const navigate = useNavigate();
  const [search, setSearch] = useSearchParams();
  const [choices, setChoices] = useState<NewGameChoices>({});
  const [limitFeedback, setLimitFeedback] = useState(0);
  const [gameId, setGameId] = useState<string>();
  const [createError, setCreateError] = useState('');
  const [createAttempt, setCreateAttempt] = useState(0);
  const [creationStarted, setCreationStarted] = useState(false);
  const [allowAiGeneratedAssets, setAllowAiGeneratedAssets] = useState(true);
  const ensureGame = useCreateGame();
  const catalog = useCatalog();
  const audio = useAudioStyles();
  const families = useMemo(
    () => styleChoices(catalog.data ?? [], allowAiGeneratedAssets),
    [allowAiGeneratedAssets, catalog.data],
  );
  const audioFamilies = audio.data ?? [];
  const step = validStep(search.get('step'));
  const stepIndex = step === 'sound' ? 2 : step === 'view' ? 4 : PROTOTYPE_STEPS.indexOf(step);
  const selectedFamily = families.find(({ id }) => id === choices.family?.picks[0]);

  testState.step = step;
  testState.picks = choices;
  useEffect(() => {
    if (testApiRegistered || !window.__ogmHost) return;
    registerTestApi('new', {
      get step() {
        return testState.step;
      },
      get picks() {
        return testState.picks;
      },
      get sessionId() {
        return testState.sessionId;
      },
    });
    testApiRegistered = true;
  }, []);

  useEffect(() => {
    if (step === 'talk') setCreationStarted(true);
  }, [step]);

  useEffect(() => {
    if (!creationStarted) return;
    let current = true;
    setCreateError('');
    void ensureGame(choices, allowAiGeneratedAssets)
      .then((id) => {
        if (current) setGameId(id);
      })
      .catch(() => {
        if (current) setCreateError('The game could not be created. Try again.');
      });
    return () => {
      current = false;
    };
  }, [allowAiGeneratedAssets, choices, createAttempt, creationStarted, ensureGame]);

  useEffect(() => {
    if (!limitFeedback) return;
    const timeout = window.setTimeout(() => setLimitFeedback(0), 300);
    return () => window.clearTimeout(timeout);
  }, [limitFeedback]);

  const go = (next: StepKey) => {
    const params = new URLSearchParams(search);
    params.set('step', next);
    setSearch(params);
    setLimitFeedback(0);
  };

  const setChoice = (key: ChoiceKey, next: StepChoice) => {
    setLimitFeedback(0);
    setChoices((current) => ({ ...current, [key]: next }));
  };

  const rejectLimit = () => {
    setLimitFeedback((current) => current + 1);
    window.navigator.vibrate?.(10);
  };

  const toggle = (key: ChoiceKey, id: string, max: number) => {
    const current = choices[key] ?? { picks: [] };
    if (current.picks.includes(id)) {
      setChoice(key, { ...current, picks: current.picks.filter((pick) => pick !== id) });
      return;
    }
    if (current.picks.length + (current.other ? 1 : 0) >= max) {
      rejectLimit();
      return;
    }
    setChoice(key, { ...current, picks: max === 1 ? [id] : [...current.picks, id] });
  };

  const back = () => {
    if (stepIndex === 0) navigate('/all');
    else go(step === 'sound' ? 'family' : step === 'view' ? 'players' : PROTOTYPE_STEPS[stepIndex - 1]!);
  };

  // A Sound step with no carded audio offers no tiles; skip past it rather than show an empty screen.
  useEffect(() => {
    if (step !== 'sound' || audio.isLoading || audioFamilies.length > 0) return;
    go('world');
  }, [audio.isLoading, audioFamilies.length, go, step]);

  const current =
    step === 'talk' ? undefined : stepDefinition(step, families, selectedFamily?.views, choices.genre?.picks);
  const selected = current ? (choices[current.key] ?? { picks: [] }) : undefined;
  const count = selected ? selected.picks.length + (selected.other ? 1 : 0) : 0;

  return (
    <section className="new-game-screen">
      <header className="new-game-head">
        <div className="new-head-back">
          <button className="new-back tap-secondary" type="button" onClick={back}>
            Back
          </button>
        </div>
        <h1>{step === 'talk' ? 'Talk it through' : current?.title}</h1>
        <div className="new-dots" role="img" aria-label={`Step ${stepIndex + 1} of ${PROTOTYPE_STEPS.length}`}>
          {PROTOTYPE_STEPS.map((key, index) => (
            <i className={index < stepIndex ? 'done' : index === stepIndex ? 'now' : ''} key={key} />
          ))}
        </div>
      </header>

      <div
        className="new-game-body"
        data-step={step}
        style={{ '--new-color': STEP_COLORS[step as ChoiceKey] } as CSSProperties & { '--new-color'?: string }}
      >
        {step === 'talk' ? (
          <TalkStep
            choices={choices}
            familyViews={selectedFamily?.views}
            gameId={gameId}
            createError={createError}
            onRetry={() => setCreateAttempt((current) => current + 1)}
            onSession={(sessionId) => {
              testState.sessionId = sessionId;
            }}
          />
        ) : (
          <>
            <p className="new-ask">{current?.ask}</p>
            {current?.hint ? <p className="new-hint">{current.hint}</p> : null}
            {step === 'sound' ? (
              <AudioStyleStep
                families={audioFamilies}
                selected={selected?.picks ?? []}
                other={selected?.other}
                full={count >= (current?.max ?? 1)}
                onFull={rejectLimit}
                onOtherChange={(other) =>
                  setChoice('sound', { picks: selected?.picks ?? [], ...(other ? { other } : {}) })
                }
                onSelect={(id) => setChoice('sound', { picks: [id] })}
              />
            ) : step === 'family' && catalog.isError ? (
              <p className="new-retry" role="alert">
                Style choices are unavailable.{' '}
                <button type="button" onClick={() => void catalog.refetch()}>
                  Retry
                </button>
              </p>
            ) : step === 'family' ? (
              <StyleStep
                families={catalog.data ?? []}
                selected={selected?.picks ?? []}
                other={selected?.other}
                full={count >= (current?.max ?? 1)}
                allowAiGenerated={allowAiGeneratedAssets}
                onAllowAiGeneratedChange={(allowed) => {
                  setAllowAiGeneratedAssets(allowed);
                  if (allowed) return;
                  const allowedIds = new Set(styleChoices(catalog.data ?? [], false).map(({ id }) => id));
                  setChoices((currentChoices) => {
                    const family = currentChoices.family;
                    if (!family) return currentChoices;
                    return {
                      ...currentChoices,
                      family: { ...family, picks: family.picks.filter((id) => allowedIds.has(id)) },
                    };
                  });
                }}
                onFull={rejectLimit}
                onOtherChange={(other) =>
                  setChoice('family', { picks: selected?.picks ?? [], ...(other ? { other } : {}) })
                }
                onSelect={(id) => {
                  setChoice('family', { picks: [id] });
                }}
              />
            ) : (
              <div className="new-option-grid" role="group" aria-label={current?.ask}>
                {current?.options.map((item) => (
                  <OptionTile
                    key={item.id}
                    {...item}
                    pressed={selected?.picks.includes(item.id) ?? false}
                    limitFeedback={limitFeedback}
                    onToggle={() => toggle(current.key, item.id, current.max)}
                  />
                ))}
                {current ? (
                  <OtherTile
                    title={current.title}
                    value={selected?.other}
                    full={count >= current.max}
                    limitFeedback={limitFeedback}
                    onFull={rejectLimit}
                    onChange={(other) =>
                      setChoice(current.key, { picks: selected?.picks ?? [], ...(other ? { other } : {}) })
                    }
                  />
                ) : null}
              </div>
            )}
            {current && current.max > 1 ? <PickCapacity count={count} max={current.max} /> : null}
          </>
        )}
      </div>

      {step !== 'talk' ? (
        <footer className="new-game-foot">
          <button
            className="new-next tap-primary"
            type="button"
            onClick={() =>
              go(step === 'sound' ? 'world' : step === 'view' ? 'talk' : (PROTOTYPE_STEPS[stepIndex + 1] ?? 'talk'))
            }
          >
            {count ? 'Next' : 'Skip'}
          </button>
        </footer>
      ) : null}
    </section>
  );
}

function PickCapacity({ count, max }: { count: number; max: number }) {
  return (
    <div className="new-pick-capacity" role="img" aria-label={`${count} of ${max} picked`}>
      {Array.from({ length: max }, (_, index) => (
        <i className={index < count ? 'filled' : ''} aria-hidden="true" key={index} />
      ))}
    </div>
  );
}

function validStep(value: string | null): StepKey {
  return STEP_ORDER.includes(value as StepKey) ? (value as StepKey) : 'genre';
}

function stepDefinition(
  step: Exclude<StepKey, 'talk'>,
  families: { id: string; label: string }[],
  familyViews: string[] | undefined,
  genres: string[] | undefined,
): StepDefinition {
  if (step === 'family') {
    return {
      key: 'family',
      title: 'Art',
      ask: 'What should it look like?',
      hint: 'Pick one',
      max: 1,
      options: families,
    };
  }
  if (step === 'sound') {
    return { key: 'sound', title: 'Sound', ask: 'How should it sound?', hint: 'Pick one', max: 1, options: [] };
  }
  if (step === 'view') {
    const options: Option[] = viewsFor(familyViews ?? ['fixed'], genres ?? []).map((id) => ({
      id,
      label: VIEW_LABELS[id] ?? id,
    }));
    return { key: 'view', title: 'Point of view', ask: 'How do you see it?', hint: 'Pick one', max: 1, options };
  }
  return STATIC_STEPS[step];
}

function TalkStep({
  choices,
  familyViews,
  gameId,
  createError,
  onRetry,
  onSession,
}: {
  choices: NewGameChoices;
  familyViews?: string[];
  gameId?: string;
  createError: string;
  onRetry(): void;
  onSession(sessionId: string): void;
}) {
  const rows = (Object.keys(choices) as ChoiceKey[]).flatMap((key) => {
    const choice = choices[key];
    const labels = choiceLabels(key, choice);
    if (choice?.other) labels.push(`“${choice.other}”`);
    return labels.length > 0 ? [{ key, labels }] : [];
  });
  return (
    <>
      <p className="new-ask">Tell the builder about your game</p>
      <p className="new-hint">Talk or type. Press Finish whenever you have said enough.</p>
      <div className="new-summary">
        {rows.length > 0 ? (
          rows.map((row) => (
            <span className="new-summary-row" key={row.key}>
              <b>{row.key === 'family' ? 'Style' : row.key === 'sound' ? 'Sound' : row.key}</b>
              {row.labels.map((label) => (
                <span className="new-chip" key={label}>
                  {label}
                </span>
              ))}
            </span>
          ))
        ) : (
          <span className="new-summary-row muted">
            No picks yet. That is fine: just tell the builder about your game.
          </span>
        )}
      </div>
      {createError ? (
        <p role="alert">
          The game could not be created.{' '}
          <button type="button" onClick={onRetry}>
            Try again
          </button>
        </p>
      ) : null}
      {gameId ? (
        <ScopeChat gameId={gameId} choices={scopeChoicesFrom(choices, familyViews)} onSession={onSession} />
      ) : createError ? null : (
        <p role="status">Creating your game…</p>
      )}
    </>
  );
}

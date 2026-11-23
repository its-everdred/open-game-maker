import { useEffect, useRef, useState, type ReactNode } from 'react';

import { Icon } from '../../../components/Icon';
import type { Hd2dReport } from '../frame';
import {
  anyWeather,
  FOCUS_MODES,
  readable,
  sameDoc,
  setClouds,
  setFocusMode,
  setShafts,
  shaftWeathers,
  slidersFor,
  TABS,
  toggleShaftWeather,
  weathers,
  type Hd2dDoc,
  type Slider,
  type TabId,
} from './controls';
import './hd2d-panel.css';

/** Echoes of a drag arrive a frame or two late; this many recent sends are recognised as Kevin's own. */
const ECHOES = 24;

/**
 * Kevin's lighting tool (#1211): sun shafts, clouds, weather, light, focus and particles for the running scene. Each
 * change goes straight to the game, which re-renders through its own HD-2D, so what he sees is what plays.
 */
export function Hd2dPanel({
  report,
  apply,
  onSave,
}: {
  /** What the running scene renders, as the game last reported it. */
  report?: Hd2dReport;
  apply?: (doc: Hd2dDoc, weather?: string) => void;
  /** Keeps the tuned document; `false` when it could not be sent, so Reset still returns to the last kept look. */
  onSave?: (doc: Hd2dDoc) => boolean;
}) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<TabId>('shafts');
  const [draft, setDraft] = useState<Hd2dDoc>();
  const [weather, setWeather] = useState<string>();
  /** The document the scene started with or Kevin last saved: Reset returns to it, Save waits for a change from it. */
  const [kept, setKept] = useState<Hd2dDoc>();
  const recent = useRef<unknown[]>([]);
  /** Shafts and clouds Kevin switched off, so switching them back on restores his settings. */
  const parked = useRef<{ shafts?: Hd2dDoc['lighting']['shafts']; clouds?: Hd2dDoc['lighting']['clouds'] }>({});
  const queued = useRef<{ doc: Hd2dDoc; weather?: string } | undefined>(undefined);
  const frame = useRef<number | undefined>(undefined);

  useEffect(() => {
    const doc = report?.doc as Hd2dDoc | null | undefined;
    setWeather(report?.weather);
    if (!doc) {
      setDraft(undefined);
      setKept(undefined);
      return;
    }
    if (recent.current.some((sent) => sameDoc(sent, doc))) return;
    /* A new scene, or the game changed its own document: start over from what it renders. */
    recent.current = [];
    parked.current = {};
    setKept(doc);
    setDraft(doc);
  }, [report]);

  useEffect(
    () => () => {
      if (frame.current !== undefined) cancelAnimationFrame(frame.current);
    },
    [],
  );

  if (!draft || !apply) return null;

  /* One send per frame however fast a slider moves; the last value always goes. */
  const push = (doc: Hd2dDoc, preview = weather) => {
    setDraft(doc);
    queued.current = { doc, weather: preview };
    if (frame.current !== undefined) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = undefined;
      const next = queued.current;
      if (!next) return;
      queued.current = undefined;
      recent.current = [...recent.current.slice(1 - ECHOES), next.doc];
      apply(next.doc, next.weather);
    });
  };

  const shafts = draft.lighting.shafts;
  const clouds = draft.lighting.clouds;
  const offered = weathers(draft, weather);
  const allowed = shaftWeathers(draft);

  return (
    <div className="hd2d-layer">
      <button
        className="hd2d-toggle"
        type="button"
        aria-label="Lighting"
        aria-pressed={open}
        aria-controls="hd2d-panel"
        onClick={() => setOpen((was) => !was)}
      >
        <Icon name="sun" />
      </button>
      <section id="hd2d-panel" className="hd2d-panel" hidden={!open} aria-label="Lighting">
        <div className="hd2d-tabs">
          <div className="hd2d-tablist" role="tablist" aria-label="Lighting controls">
            {TABS.map((entry) => (
              <button
                key={entry.id}
                type="button"
                role="tab"
                aria-label={entry.label}
                aria-selected={tab === entry.id}
                onClick={() => setTab(entry.id)}
              >
                <Icon name={entry.icon} />
              </button>
            ))}
          </div>
          <button
            className="hd2d-reset"
            type="button"
            aria-label="Reset lighting"
            disabled={kept === undefined || sameDoc(kept, draft)}
            onClick={() => kept && push(kept)}
          >
            <Icon name="replay" />
          </button>
          {onSave && (
            <button
              className="hd2d-save"
              type="button"
              aria-label="Save lighting"
              disabled={kept !== undefined && sameDoc(kept, draft)}
              onClick={() => {
                if (onSave(draft)) setKept(draft);
              }}
            >
              <Icon name="check" />
            </button>
          )}
        </div>
        <div className="hd2d-body" role="tabpanel" aria-label={TABS.find((entry) => entry.id === tab)!.label}>
          {tab === 'shafts' && (
            <Switch
              label="Sun shafts"
              on={shafts !== undefined}
              onChange={(on) => {
                if (!on) parked.current.shafts = shafts;
                push(setShafts(draft, on, parked.current.shafts));
              }}
            />
          )}
          {tab === 'clouds' && (
            <Switch
              label="Cloud shadows"
              on={clouds !== undefined}
              onChange={(on) => {
                if (!on) parked.current.clouds = clouds;
                push(setClouds(draft, on, parked.current.clouds));
              }}
            />
          )}
          {tab === 'focus' && (
            <Chips label="Focus">
              {FOCUS_MODES.map((mode) => (
                <Chip
                  key={mode.id}
                  label={mode.label}
                  pressed={draft.focus.mode === mode.id}
                  onPress={() => push(setFocusMode(draft, mode.id))}
                />
              ))}
            </Chips>
          )}
          {tab === 'weather' && (
            <>
              <Chips label="Preview">
                {offered.map((name) => (
                  <Chip
                    key={name}
                    label={readable(name)}
                    pressed={weather === name}
                    onPress={() => push(draft, name)}
                  />
                ))}
              </Chips>
              {shafts && (
                <Chips label="Shafts in">
                  <Chip label="Any" pressed={allowed === undefined} onPress={() => push(anyWeather(draft))} />
                  {offered.map((name) => (
                    <Chip
                      key={name}
                      label={readable(name)}
                      pressed={allowed?.includes(name) ?? false}
                      onPress={() => push(toggleShaftWeather(draft, name, offered))}
                    />
                  ))}
                </Chips>
              )}
            </>
          )}
          {slidersFor(tab, draft).map((control) => (
            <Range key={control.id} control={control} onChange={(value) => push(control.set(draft, value))} />
          ))}
        </div>
      </section>
    </div>
  );
}

function Range({ control, onChange }: { control: Slider; onChange(value: number): void }) {
  return (
    <label className="hd2d-range">
      <span>{control.label}</span>
      <output>{control.shown}</output>
      <input
        aria-label={control.label}
        type="range"
        min={control.min}
        max={control.max}
        step={control.step}
        value={control.value}
        onChange={(event) => onChange(Number(event.currentTarget.value))}
      />
    </label>
  );
}

function Switch({ label, on, onChange }: { label: string; on: boolean; onChange(on: boolean): void }) {
  return (
    <button className="hd2d-switch" type="button" role="switch" aria-checked={on} onClick={() => onChange(!on)}>
      <span>{label}</span>
      <span className="hd2d-switch-track" aria-hidden="true" />
    </button>
  );
}

function Chips({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="hd2d-chips" role="group" aria-label={label}>
      <span className="hd2d-chips-label">{label}</span>
      {children}
    </div>
  );
}

function Chip({ label, pressed, onPress }: { label: string; pressed: boolean; onPress(): void }) {
  return (
    <button className="hd2d-chip" type="button" aria-pressed={pressed} onClick={onPress}>
      {label}
    </button>
  );
}

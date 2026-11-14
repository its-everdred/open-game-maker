import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { SpokenText } from '@gm/sdk/audio';
import { COMMANDS_DIR, checkSkill, loadCommands } from '@ogm/gm-cli';
import {
  hudModelSchema,
  type GameInstance,
  type HostApi,
  type MultiplayerHooks,
  type PlayerSettings,
  type Viewport,
} from '@ogm/contracts';
import { describe, expect, it } from 'vitest';

const SKILL = fileURLToPath(new URL('./SKILL.md', import.meta.url));

/* Type-only contracts are mirrored key by key; `satisfies` fails typecheck when a contract gains or loses a key. */
const sdkExports = {
  HudModel: hudModelSchema,
  SpokenText,
  Viewport: { w: 1, h: 1, dpr: 1, orientation: 1, safe: 1 } satisfies Record<keyof Viewport, 1>,
  PlayerSettings: {
    mute: 1,
    volume: 1,
    musicVolume: 1,
    textScale: 1,
    reduceMotion: 1,
    gameOptions: 1,
    keyboardBindings: 1,
  } satisfies Record<keyof PlayerSettings, 1>,
  MultiplayerHooks: { spawn: 1, despawn: 1, snapshot: 1, applySnapshot: 1, hud: 1 } satisfies Record<
    keyof MultiplayerHooks,
    1
  >,
  HostApi: {
    capabilities: 1,
    input: 1,
    viewport: { current: 1, onChange: 1 } satisfies Record<keyof HostApi['viewport'], 1>,
    events: 1,
    settings: { onChange: 1 } satisfies Record<keyof HostApi['settings'], 1>,
    test: 1,
  } satisfies Record<keyof HostApi, unknown>,
  GameInstance: {
    pause: 1,
    resume: 1,
    dispose: 1,
    applyDesign: 1,
    serialize: 1,
    restore: 1,
    migrate: 1,
    pick: 1,
    worldToScreen: 1,
    screenToWorld: 1,
    validatePlacement: 1,
    setSelection: 1,
    setCamera: 1,
    net: 1,
  } satisfies Record<keyof GameInstance<unknown, unknown>, 1>,
};

describe('gm-ui-hud skill', () => {
  it('stays short and keeps the platform HUD with the host', async () => {
    const text = readFileSync(SKILL, 'utf8');
    const commands = new Set((await loadCommands(COMMANDS_DIR)).keys());

    expect(text.trimEnd().split('\n').length).toBeLessThanOrEqual(80);
    expect(text).toContain('Never draw, restyle, cover, or duplicate it');
    expect(text).toContain('MultiplayerHooks.hud');
    expect(text).toContain('`safe` insets');
    expect(text).toContain('at most 25% of the screen');
    /* The host's Pause lives in its play bar, never over the game (#641), so games may use the top corners. */
    expect(text).toMatch(/Pause button sits in its play\s+bar outside the game/);
    expect(text).toContain('at least 16 CSS px');
    /* On-screen buttons must never hide what the player needs (#600); the zone covers the host overlay's footprint. */
    expect(text).toContain('must never cover important content');
    expect(text).toContain('140 × 200 CSS px');
    expect(text).toContain('qa/journeys/hud-clear.json');
    expect(text).toMatch(/title, play, paused, won, and lost/);
    expect(checkSkill(SKILL, { commands, sdkExports })).toEqual({ commands: [], sdk: [] });
  }, 30_000);
});

import { describe, expect, it } from 'vitest';

import { AUDIO_STYLES } from '@ogm/contracts/browser';

import { STEP_ORDER, STATIC_STEPS, audioDirectionFrom, scopeChoicesFrom, viewsFor } from './options';

describe('new game options', () => {
  it('retains supported step keys and pick limits', () => {
    expect(STEP_ORDER).toEqual(['genre', 'vibe', 'family', 'sound', 'world', 'players', 'view', 'talk']);
    expect(STATIC_STEPS.genre.options).toHaveLength(14);
    expect(STATIC_STEPS.genre.max).toBe(3);
    expect(STATIC_STEPS.vibe.options).toHaveLength(11);
    expect(STATIC_STEPS.world.options).toHaveLength(11);
    expect(STATIC_STEPS.players.options.map(({ id }) => id)).toEqual(['single', 'multi']);
  });

  it('filters views to both the selected family and genre defaults', () => {
    expect(viewsFor(['iso', 'follow'], ['platformer'])).toEqual(['follow']);
    expect(viewsFor(['iso', 'follow'], ['rhythm'])).toEqual(['iso', 'follow']);
  });

  it('uses a supported family view when the prototype flow does not ask for one', () => {
    expect(scopeChoicesFrom({ genre: { picks: ['platformer'] } }, ['iso', 'follow']).pov).toBe('follow');
    expect(scopeChoicesFrom({ view: { picks: ['iso'] } }, ['follow']).pov).toBe('iso');
  });

  it('serializes multi-picks and Other text into the landed scope contract', () => {
    expect(
      scopeChoicesFrom({
        genre: { picks: ['adventure', 'rpg'], other: 'delivery' },
        vibe: { picks: ['cozy'] },
        family: { picks: ['smallscaleint'] },
        world: { picks: ['sky'], other: 'rope bridges' },
        players: { picks: ['multi'] },
        view: { picks: ['iso'] },
      }),
    ).toEqual({
      genre: 'Adventure, RPG',
      vibe: 'Cozy',
      family: 'smallscaleint',
      world: 'Sky islands',
      players: 'multi',
      pov: 'iso',
      other: 'genre: delivery\nworld: rope bridges',
    });
  });

  it('turns a picked sound tile into the contract audio direction', () => {
    const style = AUDIO_STYLES[0]!;
    expect(audioDirectionFrom({ sound: { picks: [style.id] } })).toEqual({ style: style.style, mood: style.mood });
    expect(audioDirectionFrom({ sound: { picks: ['unknown'], other: 'drums made of rain' } })).toEqual({
      other: 'drums made of rain',
    });
    expect(audioDirectionFrom({})).toBeUndefined();
    expect(audioDirectionFrom({ sound: { picks: [] } })).toBeUndefined();
    expect(
      scopeChoicesFrom({
        genre: { picks: ['platformer'] },
        vibe: { picks: ['cozy'] },
        family: { picks: ['chunky-low-poly'] },
        sound: { picks: [style.id], other: 'light as air' },
        world: { picks: ['forest'] },
        players: { picks: ['single'] },
        view: { picks: ['iso'] },
      }),
    ).toMatchObject({ audio: { style: style.style, mood: style.mood, other: 'light as air' } });
  });
});

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  dropPlan,
  expectedTeam,
  parseClients,
  parseSeed,
  readStart,
  roomBody,
  startProbes,
} from './multi-client/run-options.ts';

describe('--clients', () => {
  it('defaults to the four-seat run and accepts 2-4 only', () => {
    expect(parseClients(undefined)).toBe(4);
    expect(parseClients('2')).toBe(2);
    expect(parseClients('3')).toBe(3);
    /* One client is not a multiplayer room, and the scenario has four seat identities. */
    for (const bad of ['1', '5', '2.5', 'two', '']) expect(() => parseClients(bad)).toThrow(/--clients must be/);
  });
});

describe('--seed', () => {
  it('is a uint32, so it can stand in for the link profile seed', () => {
    expect(parseSeed(undefined)).toBeUndefined();
    expect(parseSeed('0')).toBe(0);
    expect(parseSeed('4294967295')).toBe(4_294_967_295);
    for (const bad of ['-1', '4294967296', '1e3', '12a', '']) expect(() => parseSeed(bad)).toThrow(/--seed must be/);
  });
});

describe('the step-6 drop plan', () => {
  it('keeps the four-seat run as it was: seat 2 rejoins, seat 3 forfeits', () => {
    expect(dropPlan(4)).toEqual({ rejoin: 2, forfeit: 3 });
  });

  it('never drops the primary and never drops one seat twice', () => {
    for (const clients of [2, 3, 4]) {
      const plan = dropPlan(clients);
      expect(plan.rejoin).toBeGreaterThan(0);
      expect(plan.rejoin).toBeLessThan(clients);
      if (plan.forfeit !== undefined) {
        expect(plan.forfeit).toBeGreaterThan(0);
        expect(plan.forfeit).toBeLessThan(clients);
        expect(plan.forfeit).not.toBe(plan.rejoin);
      }
    }
  });

  it('skips the forfeit in a two-seat room, where it would end the match', () => {
    expect(dropPlan(2)).toEqual({ rejoin: 1 });
    expect(dropPlan(3)).toEqual({ rejoin: 2, forfeit: 1 });
  });
});

describe('--start', () => {
  const dirs: string[] = [];
  const game = (starts: unknown): string => {
    const dir = mkdtempSync(join(tmpdir(), 'gm-starts-'));
    dirs.push(dir);
    if (starts !== undefined) {
      mkdirSync(join(dir, 'qa'));
      writeFileSync(join(dir, 'qa', 'starts.json'), JSON.stringify(starts));
    }
    return dir;
  };
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  it("reads a named start from the game's qa/starts.json", () => {
    const dir = game({ '2v2': { teams: 'alternate' }, duel: {} });
    expect(readStart(dir, '2v2')).toEqual({ teams: 'alternate' });
    expect(readStart(dir, 'duel')).toEqual({});
  });

  it('names what is missing instead of running the default room', () => {
    expect(() => readStart(game(undefined), '2v2')).toThrow(/no qa\/starts.json/);
    expect(() => readStart(game({ duel: {} }), '2v2')).toThrow(/2v2 is not in .*it names duel/);
  });

  it('refuses options the run cannot check, and the authority mode the manifest owns', () => {
    expect(() => readStart(game({ x: { teams: 'three' } }), 'x')).toThrow(/invalid \(x\.teams: .*only "teams"/);
    expect(() => readStart(game({ x: { mode: 'host' } }), 'x')).toThrow(/invalid/);
    /* Spectators and pause policy are room options too, but no step proves the room applied them. */
    expect(() => readStart(game({ x: { spectators: 'on' } }), 'x')).toThrow(/invalid/);
  });

  it('names the file when it is not JSON, and never resolves a name from the object prototype', () => {
    const dir = game({ duel: {} });
    writeFileSync(join(dir, 'qa', 'starts.json'), '{ duel: }');
    expect(() => readStart(dir, 'duel')).toThrow(/qa\/starts.json is not valid JSON/);
    expect(() => readStart(game({ duel: {} }), 'constructor')).toThrow(/constructor is not in/);
  });

  it("passes the start's options to the room without letting them replace the run's own", () => {
    const base = { gameId: 'g', ownerId: 'seat-0', maxPlayers: 4, protocol: 2, mode: 'per-seat' };
    expect(roomBody(base, { teams: 'alternate' })).toEqual({ ...base, teams: 'alternate' });
    /* A start can never override the run's own room fields, even if a caller built one by hand. */
    expect(roomBody(base, { mode: 'host', maxPlayers: 8 } as never)).toEqual(base);
    expect(roomBody(base, undefined)).toEqual(base);
  });

  it('records the start in the report probes', () => {
    expect(startProbes('2v2', { teams: 'alternate' })).toEqual({ start: '2v2', 'start.teams': 'alternate' });
    expect(startProbes('duel', {})).toEqual({ start: 'duel' });
  });

  it('expects the team layout the room assigns, so an ignored start fails the run', () => {
    expect([0, 1, 2, 3].map((seat) => expectedTeam(seat, 'alternate'))).toEqual([0, 1, 0, 1]);
    expect([0, 1, 2, 3].map((seat) => expectedTeam(seat, 'none'))).toEqual([0, 0, 0, 0]);
    expect(expectedTeam(3, undefined)).toBe(0);
  });
});

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { dropPlan, parseClients, parseSeed, readStart, roomBody, startProbes } from './multi-client/run-options.ts';

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
    expect(dropPlan(3).forfeit).toBeDefined();
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

  it('refuses options the room does not take, and the authority mode the manifest owns', () => {
    expect(() => readStart(game({ x: { teams: 'three' } }), 'x')).toThrow(/invalid/);
    expect(() => readStart(game({ x: { mode: 'host' } }), 'x')).toThrow(/invalid/);
  });

  it("passes the start's options to the room without letting them replace the run's own", () => {
    const base = { gameId: 'g', ownerId: 'seat-0', maxPlayers: 4, protocol: 2, mode: 'per-seat' };
    expect(roomBody(base, { teams: 'alternate', spectators: 'on' })).toEqual({
      ...base,
      teams: 'alternate',
      spectators: 'on',
    });
    expect(roomBody(base, undefined)).toEqual(base);
  });

  it('records the start in the report probes', () => {
    expect(startProbes('2v2', { teams: 'alternate', pauseOnDisconnect: false })).toEqual({
      start: '2v2',
      'start.teams': 'alternate',
      'start.pauseOnDisconnect': false,
    });
  });
});

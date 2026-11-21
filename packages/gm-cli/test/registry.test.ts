import { mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { describe, expect, it } from 'vitest';

import { COMMANDS_DIR, loadCommands } from '../src/cli.js';
import { commandHelp } from '../src/help.js';
import { gm, tempDir } from './helpers.js';

const ping = (name: string) => `export const command = {
  name: '${name}',
  summary: 'reply pong',
  flags: {},
  async run(ctx, args) { ctx.out('pong ' + args.join(' ')); return 0; },
};
`;

describe('command registry', () => {
  it('runs a command that exists only as a dropped-in file in a namespace directory', async () => {
    const dir = tempDir();
    mkdirSync(join(dir, 'zzz'));
    writeFileSync(join(dir, 'zzz', 'ping.js'), ping('zzz ping'));
    expect(await gm(['zzz', 'ping', 'a'], { commandsDir: dir })).toEqual({ code: 0, out: ['pong a'], err: [] });
    expect((await gm(['help'], { commandsDir: dir })).out.join('\n')).toContain('zzz ping  reply pong');
  });

  it('refuses to start when two files register the same name, naming both', async () => {
    const dir = tempDir();
    mkdirSync(join(dir, 'zzz'));
    writeFileSync(join(dir, 'zzz', 'a.js'), ping('zzz ping'));
    writeFileSync(join(dir, 'zzz', 'b.js'), ping('zzz ping'));
    await expect(loadCommands(dir)).rejects.toThrow(/duplicate command "zzz ping" in .*a\.js and .*b\.js/);
  });

  it('registers every dropped-in command, each with help of at most 15 lines', async () => {
    const registry = await loadCommands(COMMANDS_DIR);
    const commandFiles = readdirSync(COMMANDS_DIR, { withFileTypes: true })
      .filter((entry) => statSync(join(COMMANDS_DIR, entry.name)).isDirectory())
      .sort()
      .flatMap(({ name: namespace }) => {
        const namespaceDir = join(COMMANDS_DIR, namespace);
        return readdirSync(namespaceDir)
          .filter((name) => /\.(?:js|ts)$/.test(name) && !name.endsWith('.d.ts') && !/\.test\.(?:js|ts)$/.test(name))
          .map((name) => join(namespaceDir, name));
      })
      .map(async (file) => {
        const module = (await import(pathToFileURL(file).href)) as { command?: { name?: string } };
        return module.command?.name;
      });
    const expectedNames = (await Promise.all(commandFiles)).filter((name): name is string => name !== undefined).sort();
    expect([...registry.keys()].sort()).toEqual(expectedNames);
    for (const command of registry.values()) expect(commandHelp(command).length).toBeLessThanOrEqual(15);
    const help = await gm(['help', 'assets', 'search']);
    expect(help.out[0]).toBe('usage: gm assets search <words...> [filters]');
  }, 10_000);

  it('exits 2 with one cause line and a suggested command on unknown commands and flags', async () => {
    expect(await gm(['nope'])).toEqual({ code: 2, out: [], err: ['unknown command "nope". Try: gm help'] });
    const bad = await gm(['assets', 'search', 'orc', '--colour']);
    expect(bad.code).toBe(2);
    expect(bad.err).toHaveLength(1);
    expect(bad.err[0]).toMatch(/--colour.*\. Try: gm help assets search$/);
  });
});

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { JobBundle, type EnergyView } from '@ogm/contracts';

import { CommandError, EXIT, type GmCommand } from '../../command.js';
import { printJson } from '../../context.js';
import { workspaceRoot } from '../../outbox.js';

function readEnergy(cwd: string): EnergyView {
  const file = join(workspaceRoot(cwd), '.gm', 'context', 'bundle.json');
  let raw: string;
  try {
    raw = readFileSync(file, 'utf8');
  } catch {
    throw new CommandError('no .gm/context/bundle.json: treat Energy as unknown');
  }
  const parsed = JobBundle.safeParse(JSON.parse(raw));
  if (!parsed.success) throw new CommandError('.gm/context/bundle.json is not a valid job bundle');
  if (!parsed.data.energy) throw new CommandError('this job bundle carries no Energy: treat Energy as unknown');
  return parsed.data.energy;
}

const percent = (value: number | null) => (value === null ? 'unknown' : `${value}% used`);

export const command: GmCommand = {
  name: 'energy',
  summary: "show the instance's Energy and the creator's preference for this job",
  example: 'energy --json',
  flags: {},
  async run(ctx) {
    const energy = readEnergy(ctx.cwd);
    if (ctx.json) {
      printJson(ctx, energy);
      return EXIT.ok;
    }
    ctx.out(`energy ${energy.level}, preference ${energy.preference}`);
    for (const { window, usedPercent, resetsAt } of energy.windows) {
      ctx.out(`${window}  ${percent(usedPercent)}  resets ${resetsAt}`);
    }
    for (const { service, usedPercent } of energy.services) ctx.out(`${service}  ${percent(usedPercent)}`);
    // Provider readings: a stale one is unknown, with the time it was last measured.
    for (const { label, usedPercent, resetsAt, basis, observedAt, stale } of energy.sources) {
      const reset = resetsAt === null ? '' : `  resets ${resetsAt}`;
      const age = stale && observedAt !== null ? `  stale since ${observedAt}` : '';
      ctx.out(`${label}  ${percent(usedPercent)}${reset}  ${basis}${age}`);
    }
    return EXIT.ok;
  },
};

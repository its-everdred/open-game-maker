import { existsSync } from 'node:fs';
import { join, relative } from 'node:path';

import { EXIT, UsageError, type GmCommand, type GmContext } from '../../command.js';
import { indexCards, matchCards, type CardEngine, type PatternCard } from '../../skills/cards.js';
import { locateSkillPack } from '../../skills/pack.js';

function cardRoots(ctx: GmContext): string[] {
  if (ctx.skillsDir) return [locateSkillPack(ctx.cwd, ctx.skillsDir)];
  const installed = join(ctx.cwd, '.claude', 'skills');
  if (existsSync(join(ctx.cwd, 'skills.lock'))) return [installed];
  return [locateSkillPack(ctx.cwd, null)];
}

function distance(left: string, right: string): number {
  const row = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    let diagonal = row[0]!;
    row[0] = leftIndex;
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const above = row[rightIndex]!;
      row[rightIndex] = Math.min(
        row[rightIndex]! + 1,
        row[rightIndex - 1]! + 1,
        diagonal + (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1),
      );
      diagonal = above;
    }
  }
  return row[right.length]!;
}

function closest(cards: readonly PatternCard[], query: string): string[] {
  const normalized = query.toLowerCase();
  return cards
    .map((card) => ({ card, distance: distance(card.topic, normalized) }))
    .sort((left, right) => left.distance - right.distance)
    .slice(0, 3)
    .map(({ card }) => card.topic);
}

function engineFlag(value: unknown): CardEngine | undefined {
  if (value === undefined) return undefined;
  if (value === 'phaser' || value === 'three') return value;
  throw new UsageError(`unknown engine "${String(value)}"`, 'gm help docs pattern');
}

function printList(ctx: GmContext, cards: readonly PatternCard[]): void {
  if (ctx.json) {
    for (const card of cards) {
      ctx.out(
        JSON.stringify({ topic: card.topic, engine: card.engine, aliases: card.aliases, ...(card.set ? { set: card.set } : {}) }),
      );
    }
    return;
  }
  for (const card of cards) {
    ctx.out(`${card.topic}  ${card.engine}  ${card.aliases.join(',')}  ${card.set ?? '-'}`);
  }
}

async function runPattern(ctx: GmContext, args: string[], flags: Record<string, unknown>): Promise<number> {
  const roots = cardRoots(ctx);
  const cards = indexCards(roots);
  if (cards.length === 0) throw new UsageError('no pattern cards installed', 'run gm skills sync');
  const engine = engineFlag(flags.engine);

  if (flags.list === true) {
    if (args.length > 0) throw new UsageError('--list does not take a topic', 'gm docs pattern --list');
    printList(ctx, cards.filter((card) => !engine || card.engine === 'both' || card.engine === engine));
    return EXIT.ok;
  }
  if (args.length !== 1) throw new UsageError('pattern topic is required', 'gm docs pattern --list');
  const max = flags.max as number;
  if (max < 1 || max > 3) throw new UsageError('--max must be between 1 and 3', 'gm help docs pattern');
  const matches = matchCards(cards, args[0]!, engine).slice(0, max);
  if (matches.length === 0) {
    const suggestions = closest(
      cards.filter((card) => !engine || card.engine === 'both' || card.engine === engine),
      args[0]!,
    ).join(', ');
    throw new UsageError(
      `no pattern card matches "${args[0]}"${suggestions ? `; closest: ${suggestions}` : ''}`,
      'gm docs pattern --list',
    );
  }
  for (const card of matches) {
    if (ctx.json) {
      ctx.out(JSON.stringify({ ...card, file: relative(roots[0]!, card.file) }));
    } else {
      ctx.out(`---- ${relative(roots[0]!, card.file)}${card.set ? ` [set ${card.set}]` : ''}\n${card.text.trimEnd()}`);
    }
  }
  return EXIT.ok;
}

export const command: GmCommand = {
  name: 'docs pattern',
  summary: 'print themeless mechanic pattern cards from installed skills',
  usage: '<topic> [--engine phaser|three] [--max 1..3] | --list',
  example: 'docs pattern jump --engine phaser --max 1',
  flags: {
    engine: { type: 'string', help: 'keep cards for phaser or three (both always match)' },
    max: { type: 'number', default: 3, help: 'print at most 1-3 matching cards' },
    list: { type: 'boolean', default: false, help: 'list installed card topics' },
  },
  run: runPattern,
};

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
  appendFileSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isReviewable, selectCards, renderPage } from './build.ts';
import { filesDelta } from './bundle.ts';
import type { Card } from './cards.ts';
import { commandMedia, encodeMedia, hashFile, MediaStager } from './media.ts';
import { phaseFor, updatePhase } from './phase.ts';
import { readPicks, relayPicks, validatePick, type Pick } from './relay.ts';
import { collectCommands, collectReviewTickets, feedCards, type Source } from './sources.ts';

interface Config {
  sources: Source[];
  mediaRoots: string[];
  output: string;
  state: string;
  artifactUrl: string;
  decide: string;
  message: string;
  decisionsLogs?: string[];
  feeds?: Record<string, string>;
  initialPublished?: string;
  initialPage?: string;
  initialRelayed?: string;
  ffmpeg?: string;
  legacyMedia?: string;
  playLinks?: string;
}

function readJson<T>(path: string, fallback: T): T {
  return existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as T) : fallback;
}

function writeState(path: string, value: unknown): void {
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, JSON.stringify(value, null, 2), { mode: 0o600 });
  renameSync(temporary, path);
}

function previousCards(config: Config): Card[] {
  const path = join(config.state, 'cards.json');
  if (existsSync(path)) return readJson<Card[]>(path, []);
  if (!config.initialPage) return [];
  const page = readFileSync(config.initialPage, 'utf8');
  const data = page.match(/<script\s+type="application\/json"\s+id="data">([\s\S]*?)<\/script>/);
  if (!data) throw new Error('Initial page has no review-card data');
  return JSON.parse(data[1]!) as Card[];
}

function run(program: string, args: string[], cwd: string): string {
  return execFileSync(program, args, { cwd, encoding: 'utf8', timeout: 120_000, maxBuffer: 32 * 1024 * 1024 });
}

function pathsFromLogs(paths: string[]): Map<string, string> {
  const result = new Map<string, string>();
  for (const path of paths) {
    if (!existsSync(path)) throw new Error(`Missing decision log: ${path}`);
    for (const match of readFileSync(path, 'utf8').matchAll(
      /"attachment_id":"(med_[0-9a-f]+)"[^{}]*?"locator":\{"kind":"path","value":"([^"\\]*(?:\\.[^"\\]*)*)"/g,
    )) {
      result.set(match[1]!, JSON.parse(`"${match[2]}"`) as string);
    }
  }
  return result;
}

function build(config: Config): void {
  mkdirSync(config.output, { recursive: true });
  mkdirSync(config.state, { recursive: true, mode: 0o700 });
  const stager = new MediaStager(
    config.output,
    config.mediaRoots,
    (source, output, kind) => encodeMedia(source, output, kind, config.ffmpeg),
    config.legacyMedia,
  );
  const paths = pathsFromLogs(config.decisionsLogs ?? []);
  const media = (items: unknown[]) => commandMedia(items, paths, stager);
  const textMedia = (text: string) => {
    const local = [
      ...text.matchAll(/(?<![\w/:])(?:file:)?(\/[\w./@%+-]+\.(?:png|jpe?g|webp|gif|mp4|webm|mp3|wav|ogg|m4a))/gi),
    ].flatMap((match) => {
      const item = stager.stage(match[1]!);
      return item ? [item] : [];
    });
    const remote = [
      ...text.matchAll(/https:\/\/[^\s)<>]+\.(png|jpe?g|webp|gif|mp4|webm|mp3|wav|ogg|m4a)(?:\?[^\s)<>]*)?/gi),
    ].map((match) => ({
      src: match[0],
      kind: /^(mp4|webm)$/i.test(match[1]!)
        ? ('video' as const)
        : /^(mp3|wav|ogg|m4a)$/i.test(match[1]!)
          ? ('audio' as const)
          : ('img' as const),
    }));
    const markdownImages = [...text.matchAll(/!\[[^\]]*\]\((https:\/\/[^\s)]+)(?:\s+"[^"]*")?\)/g)].map((match) => ({
      kind: 'img' as const,
      src: match[1]!,
    }));
    return [...local, ...remote, ...markdownImages];
  };
  const open = config.sources.flatMap((source) => {
    const commands = collectCommands(source, run, media);
    const mediaPaths = (card: Card): Set<string> => {
      const paths = new Set<string>();
      const visit = (value: unknown): void => {
        if (value && typeof value === 'object') {
          if ('src' in value && typeof value.src === 'string') paths.add(value.src);
          Object.values(value).forEach(visit);
        }
      };
      visit(card);
      return paths;
    };
    return [
      ...commands,
      ...collectReviewTickets(source, run, textMedia).filter(
        (card) =>
          !commands.some((command) => {
            const existing = mediaPaths(command);
            return command.ticket === card.ticket && card.shared.every((item) => existing.has(item.src));
          }),
      ),
    ];
  });
  for (const [name, path] of Object.entries(config.feeds ?? {})) {
    if (!existsSync(path)) throw new Error(`Missing feed: ${path}`);
    open.push(...feedCards(name, readFileSync(path, 'utf8'), (item) => stager.stage(item)));
  }
  if (config.playLinks && !existsSync(config.playLinks)) throw new Error('Missing play-links file');
  const playLinks = config.playLinks ? readJson<Record<string, string>>(config.playLinks, {}) : {};
  for (const card of open) {
    if (!playLinks[card.key]) continue;
    const url = new URL(playLinks[card.key]!);
    if (url.protocol !== 'https:') throw new Error(`Invalid play link for ${card.key}`);
    card.play = url.href;
  }
  const labelsByTicket = new Map<string, string[]>();
  for (const card of open.filter(isReviewable)) {
    if (!card.ticket) continue;
    const source = config.sources.find((item) => item.key === card.repo && (item.id ?? '') === (card.source ?? ''));
    if (!source) throw new Error(`Unknown card repository: ${card.repo}`);
    const key = `${card.repo}#${card.ticket}`;
    if (!labelsByTicket.has(key)) {
      const result = JSON.parse(
        run(
          source.gh ?? 'gh',
          ['issue', 'view', String(card.ticket), '--repo', source.repository, '--json', 'labels'],
          source.checkout,
        ),
      ) as { labels: { name: string }[] };
      labelsByTicket.set(
        key,
        result.labels.map((label) => label.name),
      );
    }
    const phase = phaseFor(labelsByTicket.get(key)!);
    if (phase) card.phase = phase;
  }
  const picks = readJson<Record<string, number>>(join(config.state, 'picks-at.json'), {});
  const previous = previousCards(config);
  const baselines = readJson<Record<string, { at: number; card: Card }>>(join(config.state, 'baselines.json'), {});
  const selected = selectCards(open, previous, picks, Date.now(), baselines);
  const cards = selected.filter(isReviewable);
  const skipped = selected.filter((card) => !isReviewable(card));
  if (skipped.length) console.error(`Skipped ${skipped.length} cards without media or a review link`);
  cards.sort((a, b) => (b.top ?? 0) - (a.top ?? 0) || b.at.localeCompare(a.at) || a.key.localeCompare(b.key));
  const template = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../src/page.html'), 'utf8');
  const page = join(config.output, 'index.html');
  writeFileSync(page, renderPage(template, cards));
  const used = new Set<string>();
  const gather = (value: unknown): void => {
    if (typeof value === 'string' && /^m\/[A-Za-z0-9._-]+$/.test(value)) used.add(value);
    else if (Array.isArray(value)) value.forEach(gather);
    else if (value && typeof value === 'object') Object.values(value).forEach(gather);
  };
  gather(cards);
  const current = Object.fromEntries([...used].map((path) => [path, hashFile(join(config.output, path))]));
  const publishedPath = join(config.state, 'published.json');
  let published: Record<string, string>;
  if (existsSync(publishedPath)) published = readJson(publishedPath, {});
  else {
    if (!config.initialPublished) throw new Error('Provide an initial published-file inventory before the first build');
    const initial = JSON.parse(readFileSync(config.initialPublished, 'utf8')) as string[] | Record<string, string>;
    published = Array.isArray(initial) ? Object.fromEntries(initial.map((path) => [path, ''])) : initial;
  }
  const files = filesDelta(current, published, 'index.html' in published ? 512 : 511);
  const bundle = { url: config.artifactUrl, file_path: page, root: config.output, files };
  writeFileSync(join(config.output, 'bundle.json'), JSON.stringify(bundle, null, 2));
  const pageHash = createHash('sha256').update(readFileSync(page)).digest('hex');
  writeState(join(config.state, 'pending.json'), { current, files, cards, pageHash, published });
  console.log(`Built ${cards.length} cards; ${Object.keys(files).length} file changes`);
}

async function relay(config: Config, path: string): Promise<void> {
  mkdirSync(config.state, { recursive: true, mode: 0o700 });
  const picks = readPicks(JSON.parse(readFileSync(path, 'utf8')) as unknown);
  const ledger = join(config.state, 'relayed.txt');
  const decisionLedger = join(config.state, 'decided.txt');
  const answerLedger = join(config.state, 'answered.txt');
  const delivered = new Set(
    existsSync(ledger)
      ? readFileSync(ledger, 'utf8').split(/\s+/).filter(Boolean)
      : config.initialRelayed
        ? readFileSync(config.initialRelayed, 'utf8').split(/\s+/).filter(Boolean)
        : [],
  );
  const decided = new Set(
    existsSync(decisionLedger) ? readFileSync(decisionLedger, 'utf8').split(/\s+/).filter(Boolean) : [],
  );
  const answered = new Set(
    existsSync(answerLedger) ? readFileSync(answerLedger, 'utf8').split(/\s+/).filter(Boolean) : [],
  );
  const times = readJson<Record<string, number>>(join(config.state, 'picks-at.json'), {});
  const baselines = readJson<Record<string, { at: number; card: Card }>>(join(config.state, 'baselines.json'), {});
  const previous = previousCards(config);
  const queuePath = join(config.state, 'relay-pending.json');
  const pending = readJson<Record<string, { pick: Pick; card: Card }>>(queuePath, {});
  if (!existsSync(ledger) && config.initialRelayed)
    writeFileSync(ledger, [...delivered].join('\n') + '\n', { mode: 0o600 });
  for (const [marker, entry] of Object.entries(pending)) {
    if (delivered.has(marker) || delivered.has(entry.pick.key)) delete pending[marker];
  }
  for (const marker of delivered) {
    const match = /^([A-Za-z0-9_-]+)(?:@(\d+))?$/.exec(marker);
    if (match && times[match[1]!] === undefined) times[match[1]!] = Number(match[2] ?? 0);
    else if (match && match[2]) times[match[1]!] = Math.max(times[match[1]!]!, Number(match[2]));
  }
  let skipped = 0;
  let invalid = 0;
  for (const pick of picks) {
    if (
      !/^[A-Za-z0-9_-]+$/.test(pick.key) ||
      !Number.isFinite(pick.at) ||
      !pick.repo ||
      !Number.isInteger(pick.ticket) ||
      pick.ticket < 0
    ) {
      invalid++;
      continue;
    }
    const marker = `${pick.key}@${pick.at}`;
    const card = pending[marker]?.card ?? previous.find((item) => item.key === pick.key);
    if (delivered.has(marker) || delivered.has(pick.key)) skipped++;
    else {
      try {
        validatePick(pick, card);
        pending[marker] ??= { pick, card: card! };
      } catch {
        invalid++;
        continue;
      }
    }
    if (pick.at > (times[pick.key] ?? 0)) {
      if (card) baselines[pick.key] = { at: pick.at, card };
      else delete baselines[pick.key];
      times[pick.key] = pick.at;
    }
  }
  writeState(queuePath, pending);
  writeState(join(config.state, 'baselines.json'), baselines);
  writeState(join(config.state, 'picks-at.json'), times);
  const result = await relayPicks(
    Object.values(pending).map((entry) => entry.pick),
    delivered,
    async (pick) => {
      const words = [pick.label, pick.note].filter(Boolean).join('. ');
      if (pick.ticket === 0) run(config.message, [JSON.stringify(pick)], process.cwd());
      else {
        const published = pending[`${pick.key}@${pick.at}`]!.card;
        const source = config.sources.find(
          (item) => item.key === pick.repo && (item.id ?? '') === (published.source ?? ''),
        );
        if (!source) throw new Error(`Unknown pick repository: ${pick.repo}`);
        const marker = `${pick.key}@${pick.at}`;
        if (!decided.has(marker)) {
          updatePhase(pick, source, run);
          run(
            config.decide,
            [source.decideRepo, String(pick.ticket), `Review-page pick, ${pick.key}: ${words}`],
            source.checkout,
          );
          appendFileSync(decisionLedger, `${marker}\n`, { mode: 0o600 });
          decided.add(marker);
        }
        if (pick.decision && !answered.has(marker)) {
          if (!/^dec_[0-9a-f]+$/.test(pick.decision)) throw new Error('Invalid decision identifier');
          const response = JSON.parse(run(source.aiur, ['commands', pick.decision, '--json'], source.checkout)) as {
            data?: { selected?: { version?: number } };
          };
          const version = response.data?.selected?.version;
          if (!Number.isInteger(version)) throw new Error(`Cannot determine version of ${pick.decision}`);
          const choice = pick.choice;
          if (typeof choice === 'string' && !['none', 'note', 'advance'].includes(choice)) {
            run(
              source.aiur,
              [
                'operator-relay-answer',
                pick.decision,
                '--expected-version',
                String(version),
                '--option',
                choice,
                '--quote',
                pick.label ?? '',
                '--relayed-by',
                'review-page',
                '--idempotency-key',
                `review-page-${pick.decision}-${pick.at}`,
              ],
              source.checkout,
            );
          } else {
            run(
              source.aiur,
              [
                'executor-moot',
                pick.decision,
                '--expected-version',
                String(version),
                '--reason-class',
                'resolved_elsewhere',
              ],
              source.checkout,
            );
          }
          appendFileSync(answerLedger, `${marker}\n`, { mode: 0o600 });
          answered.add(marker);
        }
      }
    },
    async (marker) => {
      appendFileSync(ledger, `${marker}\n`, { mode: 0o600 });
      delete pending[marker];
      writeState(queuePath, pending);
    },
  );
  console.log(
    `Relayed ${result.sent}; already relayed ${skipped + result.skipped}; failed ${invalid + result.failed.length}`,
  );
  if (result.failed.length) console.error(`Pending picks: ${result.failed.join(', ')}`);
  if (invalid || result.failed.length) process.exitCode = 1;
}

function record(config: Config, version: string): void {
  const pending = readJson<{
    current: Record<string, string>;
    files: Record<string, string | null>;
    cards: Card[];
    pageHash: string;
    published: Record<string, string>;
  } | null>(join(config.state, 'pending.json'), null);
  if (!pending || !version) throw new Error('A pending build and published version are required');
  const digest = hashFile;
  if (digest(join(config.output, 'index.html')) !== pending.pageHash) throw new Error('Page changed after build');
  for (const [path, hash] of Object.entries(pending.current)) {
    if (digest(join(config.output, path)) !== hash) throw new Error(`Media changed after build: ${path}`);
  }
  const published = pending.published;
  for (const [path, value] of Object.entries(pending.files)) {
    if (value === null) delete published[path];
    else published[path] = pending.current[path]!;
  }
  writeState(join(config.state, 'published.json'), published);
  writeState(join(config.state, 'cards.json'), pending.cards);
  writeFileSync(join(config.state, 'version.txt'), `${version}\n`);
}

const [operation, configPath, argument] = process.argv.slice(2);
if (!configPath || !['build', 'relay', 'record'].includes(operation ?? '')) {
  throw new Error('Usage: review-page <build|relay|record> <config.json> [picks.json|version]');
}
const config = JSON.parse(readFileSync(resolve(configPath), 'utf8')) as Config;
mkdirSync(config.state, { recursive: true, mode: 0o700 });
const lock = join(config.state, 'pipeline.lock');
const lockFile = openSync(lock, 'wx');
try {
  if (operation === 'build') build(config);
  else if (operation === 'relay' && argument) await relay(config, argument);
  else if (operation === 'record' && argument) record(config, argument);
  else throw new Error(`${operation} requires an argument`);
} finally {
  closeSync(lockFile);
  unlinkSync(lock);
}

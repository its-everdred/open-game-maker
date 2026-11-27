import type { Card } from './cards.ts';

export interface Pick {
  key: string;
  at: number;
  repo: string;
  ticket: number;
  decision?: string;
  choice?: string | Record<string, string>;
  advance?: string;
  withdrawn?: string;
  source?: string;
  label?: string;
  note?: string;
  notes?: Record<string, string>;
}

export function isComplete(pick: Pick, card: Card): boolean {
  if (pick.advance || pick.withdrawn) return true;
  if (!pick.choice) return false;
  if (card.mode === 'matrix') {
    const cells = card.rows?.flatMap((row) => row.cells.filter((cell) => !cell.orig)) ?? [];
    return (
      cells.length > 0 &&
      cells.every(
        (cell) => (typeof pick.choice === 'object' && !!pick.choice[cell.id]) || !!pick.notes?.[cell.id]?.trim(),
      )
    );
  }
  if (card.mode === 'multi') {
    if (
      typeof pick.choice !== 'object' ||
      !card.groups?.every((group) => pick.choice && typeof pick.choice === 'object' && pick.choice[group.id])
    )
      return false;
    return (
      !Object.values(pick.choice).some((choice) => /^(changes|revise|work|needs)/i.test(choice)) || !!pick.note?.trim()
    );
  }
  return typeof pick.choice === 'string' && (!/^(changes|revise|work|needs)/i.test(pick.choice) || !!pick.note?.trim());
}

/** Only a card actually published by this pipeline may route a pick. */
export function validatePick(pick: Pick, card: Card | undefined): void {
  if (
    !card ||
    pick.repo !== card.repo ||
    pick.ticket !== card.ticket ||
    (pick.decision ?? '') !== card.decision ||
    (pick.source !== undefined && pick.source !== card.source)
  ) {
    throw new Error(`Pick ${pick.key} does not match a published card`);
  }
  if (
    !pick.choice ||
    (typeof pick.choice !== 'string' && (typeof pick.choice !== 'object' || Array.isArray(pick.choice)))
  ) {
    throw new Error(`Pick ${pick.key} has no valid choice`);
  }
  if (pick.advance && pick.advance !== card.phase?.next) throw new Error(`Pick ${pick.key} has an invalid phase`);
  if (pick.withdrawn && pick.withdrawn !== card.phase?.next && pick.withdrawn !== card.phase?.at)
    throw new Error(`Pick ${pick.key} has an invalid withdrawal`);
  if (
    typeof pick.choice === 'string' &&
    !['none', 'note', 'advance'].includes(pick.choice) &&
    !card.options.some((option) => option.id === pick.choice)
  ) {
    throw new Error(`Pick ${pick.key} has an invalid choice`);
  }
  if (pick.choice && typeof pick.choice === 'object') {
    for (const [id, choice] of Object.entries(pick.choice)) {
      const group = card.groups?.find((item) => item.id === id);
      const cell = card.rows?.flatMap((row) => row.cells).find((item) => item.id === id && !item.orig);
      if (!group?.options.some((option) => option.id === choice) && !(cell && ['like', 'dislike'].includes(choice))) {
        throw new Error(`Pick ${pick.key} has an invalid group choice`);
      }
    }
  }
}

/** Accept ArtifactData document records or a key-to-document map. */
export function readPicks(input: unknown): Pick[] {
  if (input && typeof input === 'object' && !Array.isArray(input)) {
    const envelope = input as { documents?: unknown; picks?: unknown; key?: string; at?: number };
    if (envelope.key && typeof envelope.at === 'number') return [input as Pick];
    if (envelope.documents && typeof envelope.documents === 'object') input = envelope.documents;
    else if (envelope.picks && typeof envelope.picks === 'object') input = envelope.picks;
  }
  const entries: [string, unknown][] = Array.isArray(input)
    ? input.map((value: unknown) => {
        const record = value && typeof value === 'object' ? (value as { path?: string; id?: string }) : {};
        return [record.path ?? record.id ?? '', value];
      })
    : input && typeof input === 'object'
      ? Object.entries(input)
      : [];
  if (!entries.length && (!input || typeof input !== 'object')) {
    throw new Error('Expected an array of pick documents or a key-to-document map');
  }
  return entries.map(([path, value]) => {
    if (!value || typeof value !== 'object') return { key: '', at: Number.NaN, repo: '', ticket: -1 };
    const wrapped = value as { data?: unknown; key?: string };
    const data = (wrapped.data ?? value) as Omit<Pick, 'key'> & { key?: string };
    const key = data.key ?? wrapped.key ?? path.replace(/^picks\//, '');
    return { ...data, key };
  });
}

/** Relay in order, recording each successful delivery before the next one. */
export async function relayPicks(
  picks: Pick[],
  delivered: Set<string>,
  send: (pick: Pick) => Promise<void>,
  record: (marker: string) => Promise<void>,
): Promise<{ sent: number; skipped: number; failed: string[] }> {
  let sent = 0;
  let skipped = 0;
  const failed: string[] = [];
  const blockedKeys = new Set<string>();
  for (const pick of [...picks].sort((a, b) => a.at - b.at || a.key.localeCompare(b.key))) {
    if (
      !/^[A-Za-z0-9_-]+$/.test(pick.key) ||
      !Number.isFinite(pick.at) ||
      !pick.repo ||
      !Number.isInteger(pick.ticket) ||
      pick.ticket < 0
    ) {
      throw new Error('Invalid pick: key, time, repository and ticket are required');
    }
    const marker = `${pick.key}@${pick.at}`;
    if (blockedKeys.has(pick.key)) continue;
    if (delivered.has(marker) || delivered.has(pick.key)) {
      skipped++;
      continue;
    }
    try {
      await send(pick);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException)?.code;
      const reason =
        code === 'ENOENT' ? 'executable missing' : code === 'ETIMEDOUT' ? 'delivery timed out' : 'delivery failed';
      console.error(`Pick ${pick.key}: ${reason}`);
      failed.push(pick.key);
      blockedKeys.add(pick.key);
      continue;
    }
    await record(marker);
    delivered.add(marker);
    sent++;
  }
  return { sent, skipped, failed };
}

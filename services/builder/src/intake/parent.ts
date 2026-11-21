import { createHash } from 'node:crypto';

import { ScopeChoices } from '@ogm/contracts';
import { audioDirectionText, hasAudioDirection } from '@ogm/contracts';
import { schema, type Db } from '@ogm/db';
import { and, desc, eq, inArray, lte } from 'drizzle-orm';

// A New Game request's parent issue: the one issue the New Game flow files when the creator finishes the scope chat.
// It carries only a privacy-safe summary and an opaque reference; the conversation, transcripts, pastes, attachments
// and design spec stay in the app's private storage behind the internal API. The parent never carries a dispatch
// label, so no worker claims it: the Executor reads it and creates the Build Order with gm-new-game-plan.
export const PARENT_LABEL = 'request:new-game';
export const PARENT_TICKET_KEY = 'new-game';

// The creation choices are short labels; the brief is one paraphrased paragraph. Anything longer is cut, and an
// address-shaped value is redacted, because nothing raw reaches GitHub.
const CHOICE_MAX = 120;
const BRIEF_MAX = 400;
const EMAIL = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;

type JobRow = typeof schema.jobs.$inferSelect;
type GameRow = typeof schema.games.$inferSelect;

export type ParentIssue = {
  title: string;
  body: string;
  sig: string;
  labels: string[];
  // The opaque reference an authorised agent resolves through the internal API; it grants nothing without a token.
  reference: string;
  choices: ScopeChoices | null;
  brief: string;
};

/**
 * The parent issue for a job, or null when the job is not a New Game request. Only the New Game flow's `new_game`
 * job reaches the parent path: an editor's chat request is a `feature` job and keeps filing one ordinary ticket.
 */
export function parentIssueFor(
  db: Db,
  job: Pick<JobRow, 'id' | 'gameId' | 'kind' | 'createdAt' | 'plan'>,
  game: Pick<GameRow, 'id' | 'title' | 'slug'>,
): ParentIssue | null {
  if (job.kind !== 'new_game') return null;
  const plan = json(job.plan);
  const title = truncate(scrub(text(plan.title)), 120);
  if (title === '') return null;
  const choices = latestAgreedChoices(db, job);
  const brief = truncate(scrub(text(plan.summary)), BRIEF_MAX);
  const reference = job.id;
  const unsigned = [
    choicesSection(choices),
    `Brief: ${brief === '' ? 'none recorded' : brief}`,
    [
      '## Request',
      `- Game: ${game.id}`,
      `- Slug: ${game.slug ?? 'unknown'}`,
      `- Private context reference: ${reference}`,
    ].join('\n'),
    'The scope conversation, voice transcripts, pastes, attachments and the agreed design spec are not in this issue. An authorised agent reads them from the internal API with a scoped token.',
  ]
    .filter((section) => section !== '')
    .join('\n\n');
  const sig = createHash('sha256').update(unsigned).digest('hex');
  return {
    title,
    body: `${unsigned}\n\n<!-- gm-job:${job.id} gm-ticket:${PARENT_TICKET_KEY} gm-sig:${sig} -->`,
    sig,
    labels: [PARENT_LABEL, `feature:gm-${job.id}`],
    reference,
    choices,
    brief,
  };
}

function choicesSection(choices: ScopeChoices | null): string {
  if (choices === null) return '';
  const lines = [
    `- Genre: ${plain(choices.genre)}`,
    `- Vibe: ${plain(choices.vibe)}`,
    `- Family: ${plain(choices.family)}`,
    `- World: ${plain(choices.world)}`,
    `- Players: ${choices.players}`,
    `- Point of view: ${plain(choices.pov)}`,
    ...(hasAudioDirection(choices.audio) ? [`- Audio direction: ${plain(audioDirectionText(choices.audio))}`] : []),
    ...(choices.other === undefined ? [] : [`- Other: ${plain(choices.other)}`]),
  ];
  return ['## Creation choices', ...lines].join('\n');
}

// The scope session the New Game flow finished: the game's latest agreed session before the job was admitted, matched
// on the agreed title when one matches. Null when the session cannot be identified, so the parent still files.
function latestAgreedChoices(db: Db, job: Pick<JobRow, 'gameId' | 'createdAt' | 'plan'>): ScopeChoices | null {
  const title = text(json(job.plan).title);
  const rows = db
    .select({
      choices: schema.scopeSessions.choices,
      scope: schema.scopeSessions.scope,
      createdAt: schema.scopeSessions.createdAt,
    })
    .from(schema.scopeSessions)
    .where(
      and(
        eq(schema.scopeSessions.gameId, job.gameId),
        eq(schema.scopeSessions.status, 'agreed'),
        lte(schema.scopeSessions.createdAt, job.createdAt),
      ),
    )
    .orderBy(desc(schema.scopeSessions.createdAt))
    .all();
  const drafts = db
    .select({
      choices: schema.gameDrafts.choices,
      scope: schema.gameDrafts.scope,
      createdAt: schema.gameDrafts.createdAt,
    })
    .from(schema.gameDrafts)
    .where(
      and(
        eq(schema.gameDrafts.gameId, job.gameId),
        inArray(schema.gameDrafts.status, ['agreed', 'promoted']),
        lte(schema.gameDrafts.createdAt, job.createdAt),
      ),
    )
    .orderBy(desc(schema.gameDrafts.createdAt))
    .all();
  const candidates = [...rows, ...drafts].sort((left, right) =>
    left.createdAt > right.createdAt ? -1 : left.createdAt < right.createdAt ? 1 : 0,
  );
  const chosen = candidates.find((row) => row.scope !== null && text(json(row.scope).title) === title) ?? candidates[0];
  if (!chosen) return null;
  const parsed = ScopeChoices.safeParse(json(chosen.choices));
  return parsed.success ? parsed.data : null;
}

// A row's JSON column, read as an object: a hand-edited or half-written column degrades the summary, never throws.
function json(value: unknown): Record<string, unknown> {
  if (typeof value !== 'string') return {};
  try {
    const parsed: unknown = JSON.parse(value);
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
}

function plain(value: string): string {
  return truncate(scrub(text(value)), CHOICE_MAX);
}

function scrub(value: string): string {
  return value.replace(EMAIL, '[redacted]');
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}

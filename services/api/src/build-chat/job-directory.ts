import type { JobKind, JobState } from '@ogm/contracts';
import { schema, type Db } from '@ogm/db';
import { and, asc, eq, inArray, isNotNull } from 'drizzle-orm';

import type { ChatJob, ChatJobDirectory } from '../app/registry.js';

const ACTIVE_CHAT_STATES: JobState[] = ['filed', 'running', 'paused_budget'];

type ChatJobRow = {
  jobId: string;
  gameId: string;
  familyId: string;
  ownerId: string;
  kind: JobKind;
  state: JobState;
  daemonSlug: string | null;
  issueNumber: number | null;
};

function toChatJob(row: ChatJobRow): ChatJob {
  return {
    jobId: row.jobId,
    gameId: row.gameId,
    familyId: row.familyId,
    ownerId: row.ownerId,
    kind: row.kind,
    state: row.state,
    aiur:
      row.daemonSlug === null || row.issueNumber === null
        ? null
        : { daemonSlug: row.daemonSlug, ticket: String(row.issueNumber) },
  };
}

export function createChatJobDirectory(db: Db): ChatJobDirectory {
  // The daemon a job talks to is its game's daemon: `game_daemons.slug` is the game's slug, so the join goes through
  // the game rather than through the repository two games can share.
  const selection = {
    jobId: schema.jobs.id,
    gameId: schema.jobs.gameId,
    familyId: schema.jobs.familyId,
    ownerId: schema.jobs.creatorId,
    kind: schema.jobs.kind,
    state: schema.jobs.state,
    daemonSlug: schema.gameDaemons.slug,
    issueNumber: schema.jobs.aiurIssueNumber,
  };

  return {
    async get(jobId) {
      const row = db
        .select(selection)
        .from(schema.jobs)
        .leftJoin(schema.games, eq(schema.games.id, schema.jobs.gameId))
        .leftJoin(schema.gameDaemons, eq(schema.gameDaemons.slug, schema.games.slug))
        .where(eq(schema.jobs.id, jobId))
        .get();
      if (row) return toChatJob(row);
      const draft = db
        .select()
        .from(schema.gameDrafts)
        .where(eq(schema.gameDrafts.id, jobId.replace(/^draft:/u, '')))
        .get();
      if (!draft || !draft.ticketRepo || draft.ticketNumber === null || draft.status === 'abandoned') return null;
      return {
        jobId,
        gameId: draft.id,
        familyId: draft.familyId,
        ownerId: draft.creatorId,
        kind: 'scope',
        state: 'running',
        aiur: { daemonSlug: 'core', ticket: String(draft.ticketNumber) },
      };
    },
    async active() {
      const regular = db
        .select(selection)
        .from(schema.jobs)
        .innerJoin(schema.games, eq(schema.games.id, schema.jobs.gameId))
        .innerJoin(schema.gameDaemons, eq(schema.gameDaemons.slug, schema.games.slug))
        .where(and(inArray(schema.jobs.state, ACTIVE_CHAT_STATES), isNotNull(schema.jobs.aiurIssueNumber)))
        .orderBy(asc(schema.jobs.createdAt), asc(schema.jobs.id))
        .all()
        .map(toChatJob);
      const drafts = db
        .select()
        .from(schema.gameDrafts)
        .where(and(inArray(schema.gameDrafts.status, ['open', 'agreed']), isNotNull(schema.gameDrafts.ticketNumber)))
        .orderBy(asc(schema.gameDrafts.createdAt), asc(schema.gameDrafts.id))
        .all()
        .flatMap((draft): ChatJob[] =>
          draft.ticketNumber === null
            ? []
            : [
                {
                  jobId: `draft:${draft.id}`,
                  gameId: draft.id,
                  familyId: draft.familyId,
                  ownerId: draft.creatorId,
                  kind: 'scope',
                  state: 'running',
                  aiur: { daemonSlug: 'core', ticket: String(draft.ticketNumber) },
                },
              ],
        );
      return [...regular, ...drafts];
    },
  };
}

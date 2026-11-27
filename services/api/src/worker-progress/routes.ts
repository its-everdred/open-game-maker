import { Hono } from 'hono';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { schema } from '@ogm/db';
import { listGameCommands } from '../commands/list.js';
import { toGameCommand } from '../commands/aiur.js';
import { isForCreator } from '../job-commands/correlate.js';
import {
  readReviewEpisode,
  reconcileReviewEpisode,
  reconcilePendingCommands,
  reconcilePendingPreviews,
  retainReviewTickets,
  reviewAnswerPending,
} from '../review-rounds/answer-guard.js';
import { listEditorPreviews, listPreviewHistory, listPreviews } from '../previews/store.js';
import type { ApiBindings } from '../app/types.js';
import { HttpError } from '../app/errors.js';
import { authorizedGame } from '../games/authorize.js';
import { requirePrincipal } from '../app/principal.js';
import { listWorkers } from './list.js';
import { logIncomplete, sourceError } from './incomplete-log.js';
import { recentCompletions } from './completions.js';
import { belongsToGame, ticketScope } from './scope.js';
import { isQaGame } from '../qa/state.js';
import { qaCompleted, qaWorkers } from '../qa/tickets.js';
import { AiurHttpError } from '@ogm/aiur-client';
import type { BlobHash } from '@ogm/blob-store';
import { reviewMediaUrl } from '../blobs/review-url.js';
import { ownsTicket, ticketDetailView } from './detail.js';
import { getChatRow, insertChatRow, listSince, markMirror } from '../build-chat/store.js';

const ticketChatKey = (gameId: string, repo: { owner: string; name: string }, ticket: string) =>
  `ticket:${gameId}:${repo.owner.toLowerCase()}/${repo.name.toLowerCase()}:${ticket}`;
function orderConversation<T extends { at?: string }>(messages: T[]): Omit<T, 'at'>[] {
  return messages
    .sort((a, b) => (Date.parse(a.at ?? '') || 0) - (Date.parse(b.at ?? '') || 0))
    .map(({ at: _at, ...message }) => message);
}

export const prefix = '/api/v1';
const routes = new Hono<ApiBindings>().get('/games/:gameId/workers', async (c) => {
  const game = authorizedGame(c, 'game.edit');
  const deps = c.get('deps');
  const history = game.slug ? recentCompletions(deps.db, game.slug) : { cursor: 0, completed: [] };
  // The QA game (#859) has no repository and no workers.
  if (isQaGame(deps.db, game.id))
    return c.json({ workers: qaWorkers(deps), daemonUnavailable: false, trackerStale: false, ...history });
  const repo = game.githubOwner && game.githubRepo ? { owner: game.githubOwner, name: game.githubRepo } : undefined;
  const activeJob = deps.db
    .select({ id: schema.jobs.id })
    .from(schema.jobs)
    .where(and(eq(schema.jobs.gameId, game.id), inArray(schema.jobs.state, ['admitted', 'filed', 'running'])))
    .get();
  // A game without a linked repository has no daemon or tracker tickets yet.
  if (!game.githubOwner && !game.githubRepo) {
    logIncomplete(deps.log, game.id, activeJob ? { repo: 'unlinked' } : {});
    return c.json({ workers: [], daemonUnavailable: Boolean(activeJob), trackerStale: false, ...history });
  }
  if (!repo || !game.slug || !deps.registry.trackerTickets) {
    logIncomplete(deps.log, game.id, { repo: 'ticket_scope_unavailable' });
    throw new HttpError(503, 'ticket_scope_unavailable');
  }
  const scope = ticketScope(deps.db, game.id, game.slug, `${repo.owner}/${repo.name}`);
  // Fail closed if the tracker is unavailable: a shared daemon may contain another game's tickets.
  const snapshot = await deps.registry.trackerTickets(repo, 'open').catch((error: unknown) => {
    logIncomplete(deps.log, game.id, { tracker: sourceError(error) });
    throw error;
  });
  const tickets = snapshot.tickets.filter((ticket) => belongsToGame(ticket, scope));
  if (!snapshot.stale)
    retainReviewTickets(
      deps.db,
      game.id,
      new Set(
        tickets
          .filter((ticket) =>
            ticket.labels.some(
              (label) =>
                label === 'agent:human-review' || [...scope.slugs].some((slug) => label === `${slug}:human-review`),
            ),
          )
          .map((ticket) => ticket.ticket),
      ),
    );
  const allowed = new Map((snapshot.stale ? [] : tickets).map((ticket) => [ticket.ticket, ticket]));
  const observed = new Set(snapshot.tickets.map((ticket) => ticket.ticket));
  let daemonUnavailable = false;
  let daemonError: string | undefined;
  const workers = await deps
    .aiurClientForGame(game.id)
    .then((client) => listWorkers(client))
    .catch((error: unknown) => {
      daemonError = sourceError(error);
      daemonUnavailable = !(
        error instanceof HttpError &&
        error.code === 'daemon_not_found' &&
        !snapshot.stale &&
        tickets.length === 0 &&
        !activeJob
      );
      return [];
    });
  const lookupIds = new Set([
    ...(snapshot.stale ? tickets.map((ticket) => ticket.ticket) : []),
    ...workers.filter((worker) => !observed.has(worker.ticket)).map((worker) => worker.ticket),
  ]);
  let lookupUnavailable = false;
  if (deps.registry.trackerTicket) {
    const results = await Promise.allSettled(
      [...lookupIds].map((ticket) => deps.registry.trackerTicket!(repo, ticket)),
    );
    for (const result of results) {
      if (result.status === 'rejected') {
        lookupUnavailable = true;
        continue;
      }
      if (result.value && belongsToGame(result.value, scope)) allowed.set(result.value.ticket, result.value);
    }
  } else if (lookupIds.size) lookupUnavailable = true;
  // The creator only sees fewer builds; the log names the source that failed.
  logIncomplete(deps.log, game.id, {
    ...(daemonUnavailable ? { daemon: daemonError } : {}),
    ...(lookupUnavailable ? { lookup: lookupIds.size } : {}),
    ...(snapshot.stale ? { tracker: 'stale' } : {}),
  });
  const byTicket = new Map(
    workers
      .filter((worker) => allowed.has(worker.ticket))
      .map((worker) => [worker.ticket, { ...worker, title: allowed.get(worker.ticket)?.title ?? worker.title }]),
  );
  for (const item of allowed.values()) {
    const states = item.labels
      .filter((label) => label.startsWith('agent:') || [...scope.slugs].some((slug) => label.startsWith(`${slug}:`)))
      .map((label) => label.replace(/^[^:]+:/, ''))
      .filter((state) => ['human-review', 'ci-wait', 'merging'].includes(state));
    if (states.length !== 1) continue;
    const prior = byTicket.get(item.ticket);
    if (prior?.running && prior.percent !== 100) {
      byTicket.set(item.ticket, { ...prior, state: 'in-progress' });
      continue;
    }
    if (prior?.startedAt && item.updatedAt && Date.parse(prior.startedAt) > Date.parse(item.updatedAt)) continue;
    byTicket.set(item.ticket, {
      ...prior,
      ticket: item.ticket,
      title: item.title,
      state: states[0],
      percent: null,
      etaSeconds: null,
      source: 'unknown',
    });
  }
  return c.json({
    workers: [...byTicket.values()],
    daemonUnavailable: daemonUnavailable || lookupUnavailable,
    trackerStale: snapshot.stale,
    ...history,
  });
});

routes.post('/games/:gameId/tickets/:ticket/missing-review', async (c) => {
  const game = authorizedGame(c, 'game.edit');
  if (requirePrincipal(c, ['user']).userId !== game.ownerId) throw new HttpError(403, 'forbidden');
  const deps = c.get('deps');
  const repo = game.githubOwner && game.githubRepo ? { owner: game.githubOwner, name: game.githubRepo } : undefined;
  if (!repo || !game.slug || !deps.registry.trackerTickets) throw new HttpError(503, 'ticket_scope_unavailable');
  const scope = ticketScope(deps.db, game.id, game.slug, `${repo.owner}/${repo.name}`);
  const snapshot = await deps.registry.trackerTickets(repo, 'open');
  if (snapshot.stale) throw new HttpError(503, 'ticket_scope_unavailable');
  const ticket = snapshot.tickets.find((item) => item.ticket === c.req.param('ticket') && belongsToGame(item, scope));
  if (
    !ticket ||
    !ticket.labels.some(
      (label) => label === 'agent:human-review' || [...scope.slugs].some((slug) => label === `${slug}:human-review`),
    )
  )
    throw new HttpError(404, 'review_ticket_not_found');
  const episode = await readReviewEpisode(deps.registry.reviewEpisode, repo, ticket.ticket, [
    'agent:human-review',
    ...[...scope.slugs].map((slug) => `${slug}:human-review`),
  ]);
  if (episode === undefined) throw new HttpError(503, 'review_episode_unavailable');
  if (episode === null) throw new HttpError(404, 'review_ticket_not_found');
  const client = await deps.aiurClientForGame(game.id);
  await reconcilePendingCommands(deps.db, game.id, ticket.ticket, episode, client, deps.log);
  const previews = [...(await listEditorPreviews(deps, game.id)), ...(await listPreviewHistory(deps, game.id))];
  reconcilePendingPreviews(
    deps.db,
    game.id,
    ticket.ticket,
    episode,
    new Set(
      previews
        .filter((preview) => preview.ticket === ticket.ticket && preview.answered)
        .map((preview) => preview.buildId),
    ),
  );
  await reconcileReviewEpisode(deps.db, game.id, ticket.ticket, episode);
  if (reviewAnswerPending(deps.db, game.id, ticket.ticket)) throw new HttpError(409, 'review_answer_pending');
  const round = deps.db
    .select({ id: schema.reviewRounds.id })
    .from(schema.reviewRounds)
    .where(
      and(
        eq(schema.reviewRounds.gameId, game.id),
        eq(schema.reviewRounds.ticket, ticket.ticket),
        isNull(schema.reviewRounds.verdict),
      ),
    )
    .get();
  // Do not report a missing review when the daemon cannot confirm its decision feed.
  const decisions = await client.decisions({}, AbortSignal.timeout(5000));
  if (
    round ||
    decisions.some(
      (decision) =>
        decision.ticket.identifier === ticket.ticket &&
        isForCreator(decision) &&
        toGameCommand(decision) !== null &&
        ['open', 'deferred', 'pending'].includes(decision.decision_status) &&
        !decision.answer &&
        !decision.active_answer,
    ) ||
    (await listGameCommands(deps, game)).some((command) => command.ticket === ticket.ticket) ||
    (await listPreviews(deps, game.id)).some((preview) => preview.ticket === ticket.ticket)
  )
    throw new HttpError(409, 'review_present');
  const receipt = await client.message(
    ticket.ticket,
    'This ticket needs a creator review, but no review media was posted. Please post a review with media.',
    `review-target:${ticket.ticket}:${episode.split('@')[0]}`,
    AbortSignal.timeout(15000),
  );
  if (receipt.warning) throw new HttpError(502, 'message_unconfirmed');
  return c.json({ status: 'asked' });
});

routes.get('/games/:gameId/tickets/completed', async (c) => {
  const game = authorizedGame(c, 'game.edit');
  const deps = c.get('deps');
  if (isQaGame(deps.db, game.id)) return c.json({ tickets: qaCompleted(deps), stale: false });
  const repo = game.githubOwner && game.githubRepo ? { owner: game.githubOwner, name: game.githubRepo } : undefined;
  if (!repo) return c.json({ tickets: [], stale: false });
  if (!game.slug || !deps.registry.trackerTickets) throw new HttpError(503, 'ticket_history_unavailable');
  const scope = ticketScope(deps.db, game.id, game.slug, `${repo.owner}/${repo.name}`);
  const snapshot = await deps.registry.trackerTickets(repo, 'closed');
  const tickets = snapshot.tickets
    .filter(
      (ticket) =>
        ticket.closedAt && (!snapshot.stale || scope.owned.has(ticket.ticket)) && belongsToGame(ticket, scope),
    )
    .map((ticket) => ({
      ticket: ticket.ticket,
      title: ticket.title,
      closedAt: ticket.closedAt,
      outcome: ticket.outcome,
      url: ticket.url,
      jobId: scope.owned.get(ticket.ticket) ?? null,
    }))
    .sort((a, b) => b.closedAt!.localeCompare(a.closedAt!));
  return c.json({ tickets, stale: snapshot.stale });
});
routes.get('/games/:gameId/tickets/:ticket/conversation', async (c) => {
  const game = authorizedGame(c, 'game.edit');
  const deps = c.get('deps');
  const ticketId = c.req.param('ticket');
  const repo = game.githubOwner && game.githubRepo ? { owner: game.githubOwner, name: game.githubRepo } : undefined;
  if (!repo || !game.slug || !deps.registry.trackerTickets || !deps.registry.ticketConversation)
    throw new HttpError(503, 'ticket_conversation_unavailable');
  const scope = ticketScope(deps.db, game.id, game.slug, `${repo.owner}/${repo.name}`);
  const owned = await ownsTicket(deps, repo, scope, ticketId).catch(() => {
    throw new HttpError(503, 'ticket_scope_unavailable');
  });
  if (!owned) throw new HttpError(404, 'ticket_not_found');
  const comments = await deps.registry.ticketConversation(repo, ticketId, [...scope.slugs], scope.owned.has(ticketId));
  const sent = listSince(deps.sqlite, ticketChatKey(game.id, repo, ticketId), 0, 10000).flatMap((row) =>
    row.text
      ? [{ text: row.text, at: row.at, ...(row.mirrorState === 'pending' ? { pending: true, id: row.id } : {}) }]
      : [],
  );
  try {
    const client = await deps.aiurClientForGame(game.id);
    const [progress, transcript] = await Promise.allSettled([
      client.progress(ticketId, 20),
      client.ticketTranscript(ticketId),
    ]);
    const updates = (progress.status === 'fulfilled' ? progress.value.events : []).flatMap((event) => {
      const text = [event.label, event.summary].find(
        (value): value is string => typeof value === 'string' && !!value.trim(),
      );
      return text ? [{ text, ...(typeof event.at === 'string' ? { at: event.at } : {}) }] : [];
    });
    const replies = (transcript.status === 'fulfilled' ? [...transcript.value.events].reverse() : [])
      .filter((event) => event.role === 'assistant' && event.body.trim())
      .map((event) => ({ text: event.body, ...(event.timestamp ? { at: event.timestamp } : {}) }));
    return c.json({
      messages: orderConversation([...comments, ...sent, ...updates, ...replies]),
      workerUnavailable: progress.status === 'rejected' || transcript.status === 'rejected',
    });
  } catch {
    return c.json({ messages: orderConversation([...comments, ...sent]), workerUnavailable: true });
  }
});
routes.post('/games/:gameId/tickets/:ticket/conversation', async (c) => {
  const game = authorizedGame(c, 'game.edit');
  if (requirePrincipal(c, ['user']).userId !== game.ownerId) throw new HttpError(403, 'forbidden');
  const deps = c.get('deps');
  const ticket = c.req.param('ticket');
  const repo = game.githubOwner && game.githubRepo ? { owner: game.githubOwner, name: game.githubRepo } : undefined;
  if (!repo || !game.slug || !deps.registry.trackerTickets || !deps.registry.ticketConversation)
    throw new HttpError(503, 'ticket_scope_unavailable');
  const scope = ticketScope(deps.db, game.id, game.slug, `${repo.owner}/${repo.name}`);
  const owned = await ownsTicket(deps, repo, scope, ticket).catch(() => {
    throw new HttpError(503, 'ticket_scope_unavailable');
  });
  if (!owned) throw new HttpError(404, 'ticket_not_found');
  await deps.registry.ticketConversation(repo, ticket, [...scope.slugs], scope.owned.has(ticket));
  const body: unknown = await c.req.json().catch(() => null);
  if (
    !body ||
    typeof body !== 'object' ||
    !('text' in body) ||
    typeof body.text !== 'string' ||
    !body.text.trim() ||
    body.text.length > 10000 ||
    !('id' in body) ||
    typeof body.id !== 'string' ||
    !/^[a-zA-Z0-9-]{1,100}$/.test(body.id)
  )
    throw new HttpError(400, 'invalid_message');
  const jobId = ticketChatKey(game.id, repo, ticket);
  const existing = getChatRow(deps.sqlite, body.id);
  if (existing && (existing.jobId !== jobId || existing.text !== body.text))
    throw new HttpError(409, 'message_id_conflict');
  if (existing?.mirrorState === 'sent') return c.json({ status: 'sent' });
  if (!existing)
    insertChatRow(deps.sqlite, {
      id: body.id,
      jobId,
      actor: 'creator',
      kind: 'text',
      text: body.text,
      mirrorState: 'pending',
    });
  const client = await deps.aiurClientForGame(game.id);
  const receipt = await client.message(ticket, body.text, body.id, AbortSignal.timeout(15000));
  if (receipt.warning) throw new HttpError(502, 'message_unconfirmed');
  markMirror(deps.sqlite, body.id, 'sent');
  return c.json({ status: 'sent' });
});
routes.get('/games/:gameId/tickets/:ticket/detail', async (c) => {
  const game = authorizedGame(c, 'game.edit');
  const deps = c.get('deps');
  const ticket = c.req.param('ticket');
  if (!/^[\w-]{1,64}$/u.test(ticket)) throw new HttpError(404, 'ticket_not_found');
  if (!isQaGame(deps.db, game.id)) {
    const repo = game.githubOwner && game.githubRepo ? { owner: game.githubOwner, name: game.githubRepo } : undefined;
    if (!repo || !game.slug || !deps.registry.trackerTickets) throw new HttpError(503, 'ticket_scope_unavailable');
    const scope = ticketScope(deps.db, game.id, game.slug, `${repo.owner}/${repo.name}`);
    const owned = await ownsTicket(deps, repo, scope, ticket).catch(() => {
      throw new HttpError(503, 'ticket_scope_unavailable');
    });
    if (!owned) throw new HttpError(404, 'ticket_not_found');
  }
  const client = await deps.aiurClientForGame(game.id);
  const read = await client.ticketDetail(ticket, AbortSignal.timeout(10_000)).catch((error: unknown) => {
    if (error instanceof AiurHttpError && error.status === 404) throw new HttpError(404, 'ticket_not_found');
    throw new HttpError(503, 'ticket_detail_unavailable');
  });
  // Through the app origin like review media: a phone on the public app cannot load the blob host's own address (#875).
  const sign = (hash: BlobHash) => reviewMediaUrl(deps.blobStore, deps.config.appOrigin, hash);
  return c.json(await ticketDetailView(deps, client, ticket, sign, read));
});
export default routes;

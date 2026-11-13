import type { Context } from 'hono';

import type { AiurClient } from '@ogm/aiur-client';
import type { JobKind, JobState, Principal } from '@ogm/contracts';

import type { ApiBindings } from './types.js';

export type Resolver = (c: Context<ApiBindings>) => Promise<Principal | null>;
export type GameInfo = { familyId: string; ownerId: string; visibility: string };
export type GameResolver = (gameId: string) => Promise<GameInfo | null>;
// The job filed as issue `identifier` in game repo `repo`, with what its after_create bundle needs (OGM-036).
export type TicketJob = {
  jobId: string;
  gameId: string;
  repo: string;
  kind: JobKind;
  game: { title: string; family: string; pov: string; genre: string; multiplayer: boolean };
  diagnostics?: { reportId: string; bundleKey: string };
};
export type TicketJobResolver = (repo: string, identifier: string) => Promise<TicketJob | null>;
export type RepoProvisioner = {
  // A game is a folder in the instance repository: `path` is `games/<slug>` and the repository is the instance's.
  provision(game: {
    id: string;
    title: string;
    slug: string;
    visibility: 'public' | 'private';
  }): Promise<{ owner: string; repo: string; url: string; path: string }>;
};
// The GitHub account an App installation belongs to. A login is only answered for proof of ownership.
export type GitHubInstallationLookup = {
  // The login of the installation the creator who authorized `code` controls; null when GitHub does not report it.
  loginFor(installationId: string, code: string): Promise<string | null>;
  // The login of an installation already stored for a creator; null when the App is no longer installed on it.
  revalidate(installationId: string): Promise<string | null>;
};
export type MailSender = {
  send(message: { to: string; subject: string; text: string }): Promise<void>;
};
// What the build chat needs about a job (OGM-013 owns the jobs table and registers the directory).
// `aiur` is null until the job is filed as an issue on a game daemon.
export type ChatJob = {
  jobId: string;
  gameId: string;
  familyId: string;
  ownerId: string;
  kind: JobKind;
  state: JobState;
  aiur: { daemonSlug: string; ticket: string } | null;
};
export interface ChatJobDirectory {
  get(jobId: string): Promise<ChatJob | null>;
  // Jobs in `filed`, `running` or `paused_budget` with a ticket: the ones the progress poller reads.
  active(): Promise<ChatJob[]>;
}
export type AiurClientResolver = (
  daemonSlug: string,
) =>
  | Pick<AiurClient, 'message' | 'progress' | 'decisions' | 'decision' | 'decide'>
  | null
  | Promise<Pick<AiurClient, 'message' | 'progress' | 'decisions' | 'decision' | 'decide'> | null>;
export type UserDirectory = {
  emailForUser(userId: string): Promise<string | null>;
  userIdForEmail(email: string): Promise<string | null>;
};
export interface IssueStateWriter {
  setStateLabel(repo: string, issue: number, state: 'cancelled', prefix?: string): Promise<void>;
}

// Seams filled by contexts from `setup(deps)`: auth adds session, user-directory and mail
// providers; accounts/games add repository provisioning and game lookup; jobs adds the ticket/chat directories;
// the daemon directory adds per-daemon aiur clients.
export interface Registry {
  principalResolvers: Resolver[];
  gameResolver: GameResolver | null;
  repoProvisioner: RepoProvisioner | null;
  githubInstallations: GitHubInstallationLookup | null;
  mailSender: MailSender | null;
  userDirectory: UserDirectory | null;
  ticketJobResolver: TicketJobResolver | null;
  chatJobs: ChatJobDirectory | null;
  aiurClientFor: AiurClientResolver | null;
  workerWorkpad: ((ticket: string, repo?: { owner: string; name: string }) => Promise<string>) | null;
  workerTitle: ((ticket: string, repo?: { owner: string; name: string }) => Promise<string>) | null;
  issueStateWriter: IssueStateWriter | null;
}

export function createRegistry(): Registry {
  return {
    principalResolvers: [],
    gameResolver: null,
    repoProvisioner: null,
    githubInstallations: null,
    mailSender: null,
    userDirectory: null,
    ticketJobResolver: null,
    chatJobs: null,
    aiurClientFor: null,
    workerWorkpad: null,
    workerTitle: null,
    issueStateWriter: null,
  };
}

// `null` until a game resolver is registered; callers answer 403 `game_unresolved`.
export async function resolveGame(registry: Registry, gameId: string): Promise<GameInfo | null> {
  return registry.gameResolver ? registry.gameResolver(gameId) : null;
}

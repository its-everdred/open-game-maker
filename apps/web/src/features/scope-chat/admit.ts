import type { AgreedScope, AllowanceExceeded, CreateJobAccepted, CreateJobRequest, JobPlan } from '@ogm/contracts';

import { api, ApiError } from '../../lib/api/client';

export type AdmissionInput = {
  gameId: string;
  sessionId: string;
  scope: AgreedScope;
  attempt: number;
  start: 'now' | 'at_reset';
};

export type SupportedOffer = Extract<AllowanceExceeded['offers'][number], 'queue' | 'ask_admin'>;

export type AdmissionResult =
  | { kind: 'accepted'; jobId: string; reused?: boolean; samePlan?: boolean }
  | ({ kind: 'refused' } & Omit<AllowanceExceeded, 'offers'> & { offers: SupportedOffer[] });

type AdmissionDeps = {
  request<T>(path: string, init: RequestInit & { json?: unknown }): Promise<T>;
  navigate(path: string): void;
};

export async function admitNewGame(
  input: AdmissionInput,
  deps: AdmissionDeps = { request: api, navigate: (path) => window.location.assign(path) },
): Promise<AdmissionResult> {
  const plan: JobPlan = {
    title: input.scope.title,
    summary: input.scope.summary,
    scope: input.scope.scope,
    tickets: input.scope.tickets.map(({ key, skills, dependsOn, acceptanceCriteria }) => ({
      key,
      skills,
      dependsOn,
      acceptanceCriteria,
    })),
  };
  const result = await admitJob(
    {
      gameId: input.gameId,
      branchId: 'main',
      kind: 'new_game',
      complexity: input.scope.complexity,
      plan,
      start: input.start,
      idempotencyKey: `scope:${input.sessionId}:${input.attempt}`,
    },
    deps.request,
  );
  if (result.kind === 'accepted') deps.navigate(`/games?spotlight=${encodeURIComponent(input.gameId)}`);
  return result;
}

export async function admitJob(
  request: CreateJobRequest,
  send: AdmissionDeps['request'] = api,
): Promise<AdmissionResult> {
  try {
    const accepted = await send<CreateJobAccepted>('/jobs', { method: 'POST', json: request });
    return {
      kind: 'accepted',
      jobId: accepted.jobId,
      ...(accepted.reused ? { reused: true, samePlan: accepted.samePlan } : {}),
    };
  } catch (error) {
    const refusal = admissionRefusal(error);
    if (!refusal) throw error;
    return refusal;
  }
}

export function admissionRefusal(error: unknown): Extract<AdmissionResult, { kind: 'refused' }> | null {
  const response = error as Partial<ApiError> | null;
  if (response?.status !== 402 || !response.body || typeof response.body !== 'object') return null;
  const body = response.body as AllowanceExceeded;
  const offers = body.offers.filter(isSupportedOffer);
  return { kind: 'refused', ...body, offers: offers.length > 0 ? offers : ['ask_admin'] };
}

function isSupportedOffer(offer: AllowanceExceeded['offers'][number]): offer is SupportedOffer {
  return offer === 'queue' || offer === 'ask_admin';
}

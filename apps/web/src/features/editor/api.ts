import type {
  ActivityEvent,
  DesignDoc,
  EditorCommand,
  IngestResponse,
  Job,
  Patch,
  ReapplyReport,
  Release,
  SaveData,
  SaveRevision,
  SaveSlot,
  Transaction,
} from '@ogm/contracts/browser';
import type { Scenery } from '@ogm/contracts/scenery';
import { SaveRevisionSchema, savesListPath, savesPath, type SaveListQuery } from '@ogm/contracts/browser';
import { PatchTooLargeError, validatePatches } from '@ogm/design-log/browser';

import { api, ApiError, apiFetch, sse } from '../../lib/api/client';
import { createStableId } from './transactions';

export type GameMetadata = {
  id: string;
  familyId: string;
  ownerId: string;
  title: string;
  visibility: 'listed' | 'private';
  repoVisibility: 'public' | 'private';
  allowAiGeneratedAssets: boolean;
};

export type DesignSnapshot = { rev: number; buildId: string; doc: DesignDoc };
export const NO_BUILD_ID = 'build_00000000000000000000000000';
export type ScenerySource = { scene: Scenery; assets: { id: string; path: string; url: string }[] };
export type Lease = { token: number; expiresAt: string };
export type TransactionBody = {
  baseRev: number;
  leaseToken: number;
  kind: 'manual';
  label: string;
  baseBuildId: string;
  commands: EditorCommand[];
  patches: Patch[];
  inverse: Patch[];
  sessionId: string;
};

export type TransactionPostResult =
  | { ok: true; rev: number }
  | { ok: false; kind: 'conflict'; headRev: number }
  | { ok: false; kind: 'lease-lost'; holder: string }
  | { ok: false; kind: 'retryable'; message: string }
  | { ok: false; kind: 'invalid'; reason: 'patch_too_large' | 'invalid_patches' }
  | { ok: false; kind: 'failure'; status: number; message: string };

export type LeaseResult =
  | { ok: true; lease: Lease }
  | { ok: false; kind: 'lease-lost'; holder: string }
  | { ok: false; kind: 'retryable'; message: string }
  | { ok: false; kind: 'failure'; status: number; message: string };

export type OptionalCapability<T> = { available: true; value: T } | { available: false };
export type PublishedCapability =
  | { available: false }
  | { available: true; modified: false; etag?: string }
  | { available: true; modified: true; etag?: string; value: Release };

export function getGame(gameId: string): Promise<GameMetadata> {
  return api(`/games/${segment(gameId)}`);
}

export function postAnalyticsEvent(event: ActivityEvent): Promise<IngestResponse> {
  return api('/analytics/events', { method: 'POST', json: { events: [event] } });
}

export async function getDesignSnapshot(gameId: string, branch: string): Promise<DesignSnapshot> {
  const snapshot = await api<{ rev: number; buildId: string | null; doc: DesignDoc }>(
    branchPath(gameId, branch, '/design'),
  );
  return { ...snapshot, buildId: snapshot.buildId ?? NO_BUILD_ID };
}

export function getScenerySource(gameId: string): Promise<ScenerySource> {
  return api(`/games/${segment(gameId)}/scenery/source`);
}

export async function acquireLease(gameId: string, branch: string, sessionId: string): Promise<LeaseResult> {
  return leaseCall(branchPath(gameId, branch, '/lease'), { method: 'POST', json: { sessionId } });
}

export async function heartbeatLease(
  gameId: string,
  branch: string,
  sessionId: string,
  token: number,
): Promise<LeaseResult> {
  return leaseCall(branchPath(gameId, branch, '/lease/heartbeat'), {
    method: 'POST',
    json: { sessionId, token },
  });
}

export async function releaseLease(
  gameId: string,
  branch: string,
  sessionId: string,
  token: number,
): Promise<LeaseResult> {
  return leaseCall(branchPath(gameId, branch, '/lease'), {
    method: 'DELETE',
    json: { sessionId, token },
  });
}

export async function postTransaction(
  gameId: string,
  branch: string,
  body: TransactionBody,
): Promise<TransactionPostResult> {
  try {
    for (const candidate of [body.patches, body.inverse]) {
      const validation = validatePatches(candidate);
      if (!validation.ok) return { ok: false, kind: 'invalid', reason: 'invalid_patches' };
    }
  } catch (error) {
    if (error instanceof PatchTooLargeError) return { ok: false, kind: 'invalid', reason: 'patch_too_large' };
    throw error;
  }

  try {
    return await api<{ rev: number }>(branchPath(gameId, branch, '/transactions'), {
      method: 'POST',
      json: body,
    }).then(({ rev }) => ({ ok: true as const, rev }));
  } catch (error) {
    if (error instanceof ApiError && error.status === 409) {
      return { ok: false, kind: 'conflict', headRev: numberField(error.body, 'headRev') };
    }
    if (error instanceof ApiError && error.status === 423) {
      return { ok: false, kind: 'lease-lost', holder: stringField(error.body, 'holder', 'other-session') };
    }
    if (error instanceof ApiError) {
      return { ok: false, kind: 'failure', status: error.status, message: error.message };
    }
    return { ok: false, kind: 'retryable', message: error instanceof Error ? error.message : 'network error' };
  }
}

export function openTransactionStream(gameId: string, branch: string, after: number): EventSource {
  return sse(`${branchPath(gameId, branch, '/transactions')}?after=${encodeURIComponent(String(after))}`);
}

export function listJobs(gameId: string): Promise<{ jobs: Job[] }> {
  return api(`/jobs?gameId=${encodeURIComponent(gameId)}`);
}

export function getOptionalSaves(
  gameId: string,
  query?: SaveListQuery,
): Promise<OptionalCapability<{ slots: SaveSlot[] }>> {
  return optionalApi(query === undefined ? savesPath(gameId) : savesListPath(gameId, query));
}

/** The branch (`main` or a branch id) and build the player is running; the API records both on each save. */
export type SaveContext = { branch: string; buildId: string };

/** The browser has already gunzipped the body: the API serves the bytes with `content-encoding: gzip`. */
export async function getSave(gameId: string, slotId: SaveSlot['slotId']): Promise<SaveData<unknown>> {
  const response = await apiFetch(savesPath(gameId, slotId));
  if (!response.ok) throw new ApiError(response.status, undefined);
  return JSON.parse(await response.text()) as SaveData<unknown>;
}

/** Takes this device's play lease, then writes one gzipped revision; `headRevision` 0 creates the slot. */
export async function putSave(
  gameId: string,
  slotId: SaveSlot['slotId'],
  payload: SaveData<unknown>,
  headRevision: number | undefined,
  context: SaveContext,
): Promise<{ revision: number }> {
  const deviceId = saveDeviceId();
  await api(`${savesPath(gameId)}/lease`, { method: 'POST', json: { deviceId, tabId } });
  return api(savesPath(gameId, slotId), {
    method: 'PUT',
    headers: {
      'content-type': 'application/octet-stream',
      'content-encoding': 'gzip',
      'if-match': String(headRevision ?? 0),
      'idempotency-key': `${deviceId}:${randomSequence()}`,
      'x-save-schema': String(payload.saveSchemaVersion),
      'x-save-branch': context.branch,
      'x-save-build': context.buildId,
      'x-save-reason': saveReason(payload),
    },
    body: await gzipJson({ saveSchemaVersion: payload.saveSchemaVersion, data: payload.data }),
  });
}

/** The SDK adds why it saved (`pause`, `interval`...) to each save.write; the bridge passes it through untyped. */
function saveReason(payload: SaveData<unknown>): SaveRevision['reason'] {
  const parsed = SaveRevisionSchema.shape.reason.safeParse((payload as { reason?: unknown }).reason);
  return parsed.success ? parsed.data : 'checkpoint';
}

function gzipJson(value: unknown): Promise<ArrayBuffer> {
  const stream = new Response(JSON.stringify(value)).body!.pipeThrough(new CompressionStream('gzip'));
  return new Response(stream).arrayBuffer();
}

const DEVICE_KEY = 'ogm:saves:device';
const tabId = createStableId('tab_');
let memoryDeviceId: string | undefined;

/** One id per browser, shared by its tabs; without storage it lasts for this page. */
function saveDeviceId(): string {
  try {
    const stored = localStorage.getItem(DEVICE_KEY);
    if (stored !== null) return stored;
    const deviceId = createStableId('device_');
    localStorage.setItem(DEVICE_KEY, deviceId);
    return deviceId;
  } catch {
    memoryDeviceId ??= createStableId('device_');
    return memoryDeviceId;
  }
}

/**
 * The API replays a write whose device and sequence it has seen, so tabs sharing a device must never pick the same
 * sequence: a random 53-bit one keeps them apart without a shared counter.
 */
function randomSequence(): number {
  const [high, low] = globalThis.crypto.getRandomValues(new Uint32Array(2));
  return (high! & 0x1fffff) * 2 ** 32 + low!;
}

export async function getOptionalPublished(gameId: string, etag?: string): Promise<PublishedCapability> {
  const response = await apiFetch(`/games/${segment(gameId)}/published`, {
    headers: etag === undefined ? undefined : { 'if-none-match': etag },
  });
  const nextEtag = response.headers.get('etag') ?? undefined;
  if (response.status === 304) return { available: true, modified: false, etag: nextEtag ?? etag };
  if (response.status === 404) return { available: false };
  if (!response.ok) throw new ApiError(response.status, undefined);
  return { available: true, modified: true, etag: nextEtag, value: (await response.json()) as Release };
}

export function getOptionalReapply(
  gameId: string,
  branch: string,
  fromBuildId: string,
  toBuildId: string,
): Promise<OptionalCapability<ReapplyReport>> {
  const query = new URLSearchParams({ from: fromBuildId, to: toBuildId });
  return optionalApi(`${branchPath(gameId, branch, '/reapply')}?${query}`);
}

export function submitReapply(
  gameId: string,
  branch: string,
  choices: Record<string, unknown>,
): Promise<OptionalCapability<{ accepted: true }>> {
  return optionalApi(branchPath(gameId, branch, '/reapply'), { method: 'POST', json: { choices } });
}

export function parseTransactionEvent(event: MessageEvent<string>): Transaction {
  return JSON.parse(event.data) as Transaction;
}

async function leaseCall(path: string, init: RequestInit & { json: unknown }): Promise<LeaseResult> {
  try {
    const lease = await api<Lease>(path, init);
    return { ok: true, lease };
  } catch (error) {
    if (error instanceof ApiError && error.status === 423) {
      return { ok: false, kind: 'lease-lost', holder: stringField(error.body, 'holder', 'other-session') };
    }
    if (error instanceof ApiError) {
      return { ok: false, kind: 'failure', status: error.status, message: error.message };
    }
    return { ok: false, kind: 'retryable', message: error instanceof Error ? error.message : 'network error' };
  }
}

async function optionalApi<T>(path: string, init?: RequestInit & { json?: unknown }): Promise<OptionalCapability<T>> {
  try {
    return { available: true, value: await api<T>(path, init) };
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return { available: false };
    throw error;
  }
}

function branchPath(gameId: string, branch: string, suffix: string): string {
  return `/games/${segment(gameId)}/branches/${segment(branch)}${suffix}`;
}

function segment(value: string): string {
  return encodeURIComponent(value);
}

function numberField(body: unknown, field: string): number {
  const value = record(body)?.[field];
  return typeof value === 'number' ? value : 0;
}

function stringField(body: unknown, field: string, fallback: string): string {
  const value = record(body)?.[field];
  return typeof value === 'string' ? value : fallback;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

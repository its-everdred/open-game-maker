import { DecisionInventory } from '@ogm/contracts';

import type { GitHubRequest } from './qa-new-game-folder-github.js';

type ObjectValue = Record<string, unknown>;

function object(value: unknown): ObjectValue {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new Error('invalid New Game decision inventory response');
  return value as ObjectValue;
}

/** Apply the creator-facing acceptance gate to a parsed inventory, without printing its contents. */
export function decisionInventoryFailure(value: unknown): string | null {
  const parsed = DecisionInventory.safeParse(value);
  if (!parsed.success) return 'New Game decision inventory does not match its schema';
  const inventory = parsed.data;
  if (inventory.length < 15) return 'New Game decision inventory has fewer than 15 decisions';
  if (new Set(inventory.map((decision) => decision.area.trim().toLowerCase())).size < 5)
    return 'New Game decision inventory covers fewer than five areas';
  const engineeringChoice = /\b(?:engineering|technical|technology|implementation|software architecture|tooling)\b/iu;
  const engineeringQuestion =
    /\b(?:which|what)\s+(?:game\s+)?(?:engine|framework|library|programming language|database schema|data structure|api endpoint)\b|\b(?:choose|pick|select|use)\s+(?:a\s+)?(?:game\s+)?(?:engine|framework|library|programming language)\b|\b(?:typescript|javascript|dependency)\b/iu;
  if (
    inventory.some(
      (decision) =>
        engineeringChoice.test(decision.area) ||
        engineeringQuestion.test(decision.question) ||
        decision.options.some((option) => engineeringQuestion.test(option.label)),
    )
  )
    return 'New Game decision inventory contains an engineering-level choice';
  const mediaReady = inventory.filter((decision) => decision.options.every((option) => option.media));
  if (mediaReady.length < 5) return 'New Game decision inventory has fewer than five media-backed decisions';
  if (mediaReady.filter((decision) => decision.status === 'asked').length < 5)
    return 'New Game has not raised five media-backed decisions as creator Commands';
  return null;
}

/** Read the inventory from the game branch created by the New Game flow. */
export async function readNewGameDecisionInventory(repo: string, slug: string, request: GitHubRequest): Promise<void> {
  if (!/^[A-Za-z0-9][\w.-]*\/[A-Za-z0-9][\w.-]*$/u.test(repo) || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(slug))
    throw new Error('invalid New Game decision inventory target');
  const path = `/repos/${repo}/contents/docs/${slug}/decisions.json?ref=${encodeURIComponent(`game/${slug}`)}`;
  const response = object(await request('GET', path));
  if (response.encoding !== 'base64' || typeof response.content !== 'string' || !response.content.trim())
    throw new Error('New Game decision inventory is missing from its game branch');
  let inventory: unknown;
  try {
    inventory = JSON.parse(Buffer.from(response.content, 'base64').toString('utf8')) as unknown;
  } catch {
    throw new Error('New Game decision inventory is not valid JSON');
  }
  const failure = decisionInventoryFailure(inventory);
  if (failure) throw new Error(failure);
}

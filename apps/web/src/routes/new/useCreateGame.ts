import { useCallback, useRef } from 'react';

import { api, ApiError } from '../../lib/api/client';
import { getRepoVisibilityDefault } from '../../lib/api/auth';
import { choiceLabels, type NewGameChoices } from './options';

type GameResponse = { id: string };

export function useCreateGame() {
  const game = useRef<{
    id?: string;
    provisioningId?: string;
    promise?: Promise<string>;
    desiredAllowAiGeneratedAssets?: boolean;
    syncedAllowAiGeneratedAssets?: boolean;
    desiredTitle?: string;
    syncedTitle?: string;
    recoveringTitle?: boolean;
  }>({});
  return useCallback((choices: NewGameChoices, allowAiGeneratedAssets: boolean) => {
    const state = game.current;
    const titleParts = [choiceLabels('vibe', choices.vibe).at(0), choiceLabels('genre', choices.genre).at(0)].filter(
      (part): part is string => Boolean(part),
    );
    state.desiredTitle = titleParts.join(' ') || 'New game';
    state.desiredAllowAiGeneratedAssets = allowAiGeneratedAssets;
    if (state.promise === undefined) {
      if (state.provisioningId === undefined) {
        state.syncedAllowAiGeneratedAssets = allowAiGeneratedAssets;
        state.syncedTitle = state.desiredTitle;
      }
      const path =
        state.provisioningId === undefined ? '/games' : `/games/${encodeURIComponent(state.provisioningId)}/provision`;
      state.promise = api<GameResponse>(path, {
        method: 'POST',
        ...(state.provisioningId === undefined
          ? {
              json: {
                title: state.desiredTitle,
                repoVisibility: getRepoVisibilityDefault(),
                allowAiGeneratedAssets,
              },
            }
          : {}),
      }).then(({ id }) => {
        state.id = id;
        state.provisioningId = undefined;
        return id;
      });
    }

    const synced = state.promise.then(async (id) => {
      while (state.recoveringTitle && state.syncedTitle !== state.desiredTitle) {
        const next = state.desiredTitle!;
        await api<GameResponse>(`/games/${encodeURIComponent(id)}`, {
          method: 'PATCH',
          json: { title: next, preserveSlug: true },
        });
        state.syncedTitle = next;
      }
      while (state.syncedAllowAiGeneratedAssets !== state.desiredAllowAiGeneratedAssets) {
        const next = state.desiredAllowAiGeneratedAssets!;
        await api<GameResponse>(`/games/${encodeURIComponent(id)}`, {
          method: 'PATCH',
          json: { allowAiGeneratedAssets: next },
        });
        state.syncedAllowAiGeneratedAssets = next;
      }
      return id;
    });
    state.promise = synced.catch((error: unknown) => {
      if (state.id === undefined) {
        if (
          error instanceof ApiError &&
          error.status === 502 &&
          typeof error.body === 'object' &&
          error.body !== null &&
          'error' in error.body &&
          error.body.error === 'repo_provisioning_failed' &&
          'details' in error.body &&
          typeof error.body.details === 'object' &&
          error.body.details !== null &&
          'gameId' in error.body.details &&
          typeof error.body.details.gameId === 'string'
        ) {
          state.provisioningId = error.body.details.gameId;
          state.recoveringTitle = true;
        }
        state.promise = undefined;
        if (state.provisioningId === undefined) state.syncedAllowAiGeneratedAssets = undefined;
      } else {
        // The game already exists; a retry must PATCH it rather than create a duplicate.
        state.promise = Promise.resolve(state.id);
      }
      throw error;
    });
    return state.promise;
  }, []);
}

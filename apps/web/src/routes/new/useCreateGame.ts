import { useCallback, useRef } from 'react';

import { api } from '../../lib/api/client';
import { getRepoVisibilityDefault } from '../../lib/api/auth';
import { choiceLabels, type NewGameChoices } from './options';

type GameResponse = { id: string };

export function useCreateGame() {
  const game = useRef<{
    id?: string;
    promise?: Promise<string>;
    desiredAllowAiGeneratedAssets?: boolean;
    syncedAllowAiGeneratedAssets?: boolean;
  }>({});
  return useCallback((choices: NewGameChoices, allowAiGeneratedAssets: boolean) => {
    const state = game.current;
    state.desiredAllowAiGeneratedAssets = allowAiGeneratedAssets;
    if (state.promise === undefined) {
      const titleParts = [choiceLabels('vibe', choices.vibe).at(0), choiceLabels('genre', choices.genre).at(0)].filter(
        (part): part is string => Boolean(part),
      );
      state.syncedAllowAiGeneratedAssets = allowAiGeneratedAssets;
      state.promise = api<GameResponse>('/games', {
        method: 'POST',
        json: {
          title: titleParts.join(' ') || 'New game',
          repoVisibility: getRepoVisibilityDefault(),
          allowAiGeneratedAssets,
        },
      }).then(({ id }) => {
        state.id = id;
        return id;
      });
    }

    const synced = state.promise.then(async (id) => {
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
        state.promise = undefined;
        state.syncedAllowAiGeneratedAssets = undefined;
      } else {
        // The game already exists; a retry must PATCH it rather than create a duplicate.
        state.promise = Promise.resolve(state.id);
      }
      throw error;
    });
    return state.promise;
  }, []);
}

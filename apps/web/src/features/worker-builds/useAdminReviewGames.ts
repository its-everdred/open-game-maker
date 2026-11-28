import { useQuery } from '@tanstack/react-query';
import { api, ApiError } from '../../lib/api/client';
import { useSession } from '../../lib/api/session';

export function useAdminReviewGames(creatorId: string | undefined, admin: boolean) {
  const { data: session } = useSession();
  const query = useQuery({
    queryKey: ['admin-review-games', creatorId, session?.session?.id],
    enabled: Boolean(creatorId && session?.user.id === creatorId) && admin,
    queryFn: async () => {
      try {
        return await api<{ games: { id: string; title: string; ownerId: string; slug: string | null }[] }>(
          '/me/review-games',
        );
      } catch (error) {
        if (error instanceof ApiError && error.status === 403) return null;
        throw error;
      }
    },
    refetchInterval: 15_000,
    refetchOnMount: 'always',
    retry: false,
  });
  return {
    ...query,
    data:
      admin && creatorId && session?.user.id === creatorId && query.isFetchedAfterMount && !query.isError
        ? query.data
        : null,
  };
}

import { useQuery } from '@tanstack/react-query';

import { Icon } from '../../components/Icon';
import { getEditorScenes } from '../editor/api';
import { sceneEditorPath, sceneTitle } from '../editor/scenes/scene-source';
import './ticket-scenes.css';

/**
 * The scenes a ticket's agent pushed (#1212), each opening the map maker at the latest revision that agent wrote. A
 * push lands in the shared scene store at once, so a read every 30 s shows it within a minute.
 */
export function TicketScenes({ gameId, ticket }: { gameId: string; ticket: string }) {
  const scenes = useQuery({
    queryKey: ['editor-scenes', gameId],
    queryFn: () => getEditorScenes(gameId),
    refetchInterval: 30_000,
    retry: false,
  });
  const pushed = (scenes.data?.scenes ?? []).filter((scene) => scene.agents?.[ticket] !== undefined);
  if (pushed.length === 0) return null;
  return (
    <nav className="ticket-scenes" aria-label="Scenes">
      {pushed.map((scene) => (
        <a
          key={scene.id}
          href={sceneEditorPath(gameId, scene.id, scene.agents[ticket])}
          aria-label={`Edit ${sceneTitle(scene.id)}`}
        >
          <Icon name="map" />
          <span>{sceneTitle(scene.id)}</span>
        </a>
      ))}
    </nav>
  );
}

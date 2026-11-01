import { useEffect, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router';

import type { ScreenRoute } from '../../app/screen';
import { storeRoomGrant, type RoomPin } from '../../features/rooms/grant';
import { api, ApiError } from '../../lib/api/client';
import { useSession } from '../../lib/api/session';
import './join.css';

type JoinResponse = { roomId: string; grant: string; pin: RoomPin; roomsUrl: string };

function errorCode(error: ApiError): string | undefined {
  if (typeof error.body !== 'object' || error.body === null || !('error' in error.body)) return undefined;
  const code = (error.body as { error?: unknown }).error;
  return typeof code === 'string' ? code : undefined;
}

function joinError(error: unknown): string {
  if (!(error instanceof ApiError)) return 'Could not join right now';
  const code = errorCode(error);
  if (error.status === 410 && code === 'room_ended') return 'Room ended';
  if (error.status === 410) return 'Link expired or already used';
  if (error.status === 403) return 'Not allowed';
  return 'Could not join right now';
}

export function JoinScreen() {
  const session = useSession();
  const { inviteToken } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const [failure, setFailure] = useState<string | null>(null);
  const signedIn = session !== null;

  useEffect(() => {
    const next = `${location.pathname}${location.search}`;
    if (!signedIn) {
      navigate('/age', { replace: true, state: { next } });
      return;
    }
    if (!inviteToken) {
      setFailure('Link expired or already used');
      return;
    }

    let active = true;
    void api<JoinResponse>(`/join/${encodeURIComponent(inviteToken)}`)
      .then((joined) => {
        if (!active) return;
        storeRoomGrant(joined);
        navigate(`/g/${encodeURIComponent(joined.pin.gameId)}?room=${encodeURIComponent(joined.roomId)}`, {
          replace: true,
        });
      })
      .catch((error: unknown) => {
        if (!active) return;
        if (error instanceof ApiError && error.status === 403 && errorCode(error) === 'age_required') {
          navigate('/age', { replace: true, state: { next } });
          return;
        }
        setFailure(joinError(error));
      });
    return () => {
      active = false;
    };
  }, [inviteToken, location.pathname, location.search, navigate, signedIn]);

  return (
    <main className="join-screen">
      <section className="join-card" aria-live="polite">
        <h1>Join room</h1>
        {failure ? <p role="alert">{failure}</p> : <p role="status">Joining room…</p>}
      </section>
    </main>
  );
}

export const route: ScreenRoute = {
  path: '/join/:inviteToken',
  element: <JoinScreen />,
  chrome: 'bare',
  auth: 'none',
};

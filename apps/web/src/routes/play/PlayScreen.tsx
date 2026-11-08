import { Link, Navigate, useLocation, useParams } from 'react-router';

import { usePlayLink, playLinkDenial, playTarget, type PlayLinkDenial } from './api';
import '../games/games.css';

// A shared `/play/<ref>` link. A signed-out visitor is sent to sign-in first and comes back here, so a share works for
// someone opening it cold (#513).
export function PlayScreen() {
  const { ref = '' } = useParams();
  const location = useLocation();
  const link = usePlayLink(ref);

  if (link.data) return <Navigate replace to={playTarget(ref, link.data, location.search)} />;
  if (link.isError) return <PlayLinkMessage denial={playLinkDenial(link.error)} />;
  return null;
}

const COPY: Record<PlayLinkDenial, string> = {
  denied: 'You don’t have access to this game.',
  missing: 'This link doesn’t point at a game.',
  unavailable: 'Couldn’t open that game. Try again.',
};

export function PlayLinkMessage({ denial }: { denial: PlayLinkDenial }) {
  return (
    <div className="games-screen">
      <p className="games-status" role="status">
        {COPY[denial]} <Link to="/all">Your games</Link>
      </p>
    </div>
  );
}

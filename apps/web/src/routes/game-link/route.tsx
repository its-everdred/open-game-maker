import { Navigate, Outlet, useLocation, useParams } from 'react-router';

import type { ScreenRoute } from '../../app/screen';
import { PlayLinkMessage } from '../play/PlayScreen';
import { playLinkDenial, playTarget, usePlayLink } from '../play/api';
import { ShortReviewScreen } from '../review/ReviewScreen';

// A game's short links on its hosted instance (#591): `/<slug>` opens the game's page in the library, `/<slug>/play`
// plays it and `/<slug>/review/<n>` opens one of its reviews
// (`/<slug>/review` lists them all). App screens never lose their address to a slug: the
// router ranks a screen's own path above `/:slug`, and the API never hands a game a reserved slug.
function GameLink({ to }: { to: 'page' | 'play' }) {
  const { slug = '' } = useParams();
  const location = useLocation();
  const link = usePlayLink(slug);

  if (link.isError) return <PlayLinkMessage denial={playLinkDenial(link.error)} />;
  if (!link.data) return null;
  const game = link.data;
  if (to === 'play') return <Navigate replace to={playTarget(game.id, game, location.search)} />;
  return <Navigate replace to={`/all?spotlight=${encodeURIComponent(game.id)}`} />;
}

export const route: ScreenRoute = {
  path: '/:slug',
  element: <Outlet />,
  chrome: 'app',
  auth: 'required',
  children: [
    { path: '', element: <GameLink to="page" /> },
    { path: 'play', element: <GameLink to="play" /> },
    { path: 'review', element: <ShortReviewScreen /> },
    { path: 'review/:number', element: <ShortReviewScreen /> },
  ],
};

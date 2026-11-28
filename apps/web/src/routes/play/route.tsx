import type { ScreenRoute } from '../../app/screen';
import { PlayScreen } from './PlayScreen';

// The shareable address of a game. It resolves the slug (or a slug the game has outgrown, or the id) and then opens the
// game itself (#513).
export const route: ScreenRoute = {
  path: '/play/:ref',
  element: <PlayScreen />,
  chrome: 'app',
  auth: 'none',
};

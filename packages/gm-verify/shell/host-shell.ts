/**
 * `gm run`'s host frame: the play screen's chrome around a local build, mounted through `@gm/host` as the app mounts a
 * game, so the touch overlay, viewport tracking and bridge are the app's own. The styles are the app's own stylesheets,
 * bundled in at build time; the markup copies `PlayEditBar`, `PlatformHud`'s Pause and the studio menu button from
 * apps/web, so keep it in step with them.
 */
import { createGameFrame } from '@gm/host';

import '../../../apps/web/src/tokens.css';
import '../../../apps/web/src/app/chrome.css';
import '../../../apps/web/src/routes/game/game.css';
import '../../../apps/web/src/routes/game/game-prototype.css';

const query = new URLSearchParams(location.search);
const title = document.querySelector<HTMLElement>('.play-title');
if (title) title.textContent = query.get('title') ?? '';

createGameFrame({
  container: document.querySelector<HTMLElement>('#game')!,
  gamesOrigin: query.get('games')!,
  gameId: 'local',
  buildId: 'local',
  build: 'test',
  params: { capture: '1', tier: query.get('tier') ?? 'mobile' },
  mode: 'play',
  playerIndex: 0,
  capabilities: [],
  role: () => 'owner',
});

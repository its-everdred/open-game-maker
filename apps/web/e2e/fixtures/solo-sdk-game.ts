import { boot } from '@gm/sdk/core';

import { createCounterGame } from '../../../../packages/sdk/src/test/fixtures/counter-game';

/* A solo SDK game whose saved state moves with its clock: one count per simulation step. */
const fixture = createCounterGame();
const runtime = await boot(fixture.module, {
  hostOrigin: new URL(document.referrer || new URLSearchParams(location.search).get('e2eHost') || '').origin,
  build: 'test',
});
runtime.onStep(() => {
  const save = runtime.instance.serialize();
  save.data.counter += 1;
  runtime.instance.restore(save);
});
Object.assign(window, { __pauseFixture: runtime });

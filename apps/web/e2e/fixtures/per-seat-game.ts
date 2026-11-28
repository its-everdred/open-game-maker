import { boot } from '@gm/sdk/core';

import { createCounterGame } from '../../../../packages/sdk/src/test/fixtures/counter-game';

const fixture = createCounterGame();
fixture.module.manifest.net = { authority: 'per-seat', maxSeats: 2 };
const mount = fixture.module.mount;
fixture.module.mount = async (...args) => {
  const instance = await mount(...args);
  return {
    ...instance,
    net: {
      ...instance.net,
      capture: () => ({ tick: 0, state: {} }),
      restore: () => undefined,
      digest: () => [0],
    },
  };
};

const runtime = await boot(fixture.module, {
  hostOrigin: new URL(document.referrer || new URLSearchParams(location.search).get('e2eHost') || '').origin,
  build: 'test',
});
Object.assign(window, { __pauseFixture: runtime });

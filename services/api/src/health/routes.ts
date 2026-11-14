import { Hono } from 'hono';

import { healthResponse } from '@ogm/health';

import type { ApiBindings } from '../app/types.js';
import { commandHealthDetails } from '../job-commands/health.js';
import { reconcileStale } from '../review-rounds/heartbeat.js';

export const prefix = '/';

export default new Hono<ApiBindings>().get('/healthz', (c) => {
  const { version, startedAtMs } = c.get('deps');
  return c.json(
    healthResponse({
      service: 'api',
      version,
      startedAtMs,
      details: {
        command_decisions: commandHealthDetails(c.get('deps')),
        review_rounds: {
          ok: !reconcileStale(c.get('deps').db, Date.now(), c.get('deps').config.commandPollMs ?? 5000),
        },
      },
    }),
  );
});

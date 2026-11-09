import { Hono } from 'hono';

import { healthResponse } from '@ogm/health';

import type { ApiBindings } from '../app/types.js';
import { commandHealthDetails } from '../job-commands/health.js';

export const prefix = '/';

export default new Hono<ApiBindings>().get('/healthz', (c) => {
  const { version, startedAtMs } = c.get('deps');
  return c.json(
    healthResponse({
      service: 'api',
      version,
      startedAtMs,
      details: { command_decisions: commandHealthDetails(c.get('deps')) },
    }),
  );
});

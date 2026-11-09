import { ticketAction } from '../../build-control.js';

export const command = ticketAction({
  verb: 'requeue',
  summary: 'queue a build ticket for dispatch again (aiur --todo)',
  aiurArgs: (n) => ['--todo', String(n)],
});

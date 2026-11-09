import { ticketAction } from '../../build-control.js';

export const command = ticketAction({
  verb: 'park',
  summary: "free a paused build ticket's agent slot until it is resumed (aiur park)",
  aiurArgs: (n) => ['park', String(n)],
});

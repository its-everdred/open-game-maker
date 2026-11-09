import { pauseOrResume } from '../../build-control.js';

export const command = pauseOrResume(
  'resume',
  "resume a build ticket's agent, or every ticket of one game (aiur resume)",
);

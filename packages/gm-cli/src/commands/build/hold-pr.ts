import { UsageError, type GmCommand } from '../../command.js';

/* aiur has no interface yet to take a ticket out of ci-wait without closing its PR, and GM never writes aiur
 * lifecycle labels itself (#662), so this refuses until aiur serves one. */
export const command: GmCommand = {
  name: 'build hold-pr',
  summary: 'take a build ticket out of ci-wait without closing its PR (refused until aiur has an interface)',
  usage: '<ticket>',
  example: 'build hold-pr 212',
  flags: {},
  async run() {
    throw new UsageError(
      'aiur has no interface to take a ticket out of ci-wait yet, and gm never writes aiur lifecycle labels',
      'gm build state <ticket>',
    );
  },
};

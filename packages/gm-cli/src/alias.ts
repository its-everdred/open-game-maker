import type { GmCommand } from './command.js';

/** An old command name that keeps working, left out of `gm help`, and says the new name on stderr. */
export function renamed(oldName: string, target: GmCommand): GmCommand {
  return {
    ...target,
    name: oldName,
    hidden: true,
    run(ctx, args, flags) {
      ctx.err(`gm ${oldName} is now gm ${target.name}`);
      return target.run(ctx, args, flags);
    },
  };
}

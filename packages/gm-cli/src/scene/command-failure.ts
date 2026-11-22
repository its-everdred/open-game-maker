import { ZodError } from 'zod';
import { CommandError, UsageError } from '../command.js';

/** Report a scene command's input and evidence failures as messages instead of stack traces. */
export async function reportSceneFailures<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof UsageError || error instanceof CommandError) throw error;
    if (error instanceof ZodError)
      throw new CommandError(
        `invalid input: ${error.issues.map((issue) => `${issue.path.join('.') || 'root'} ${issue.message}`).join('; ')}`,
      );
    if (error instanceof SyntaxError) throw new CommandError(`invalid JSON: ${error.message}`);
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'EEXIST')
      throw new CommandError(`${(error as NodeJS.ErrnoException).path} already exists; pass a new output path`);
    if (error instanceof Error) throw new CommandError(error.message);
    throw error;
  }
}

import { randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { link, mkdir, readFile, readdir, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createInterface } from 'node:readline';

/** A durable fence and per-operation markers prevent QA cleanup racing an outstanding create. */
export class QaCreateFence {
  constructor(private readonly dataDirectory: string) {}

  private paths(gameId: string) {
    if (!/^[A-Za-z0-9_-]{1,128}$/u.test(gameId)) throw new Error('invalid game ID');
    const root = join(this.dataDirectory, 'commit', 'create-fences');
    return { root, fence: join(root, `${gameId}.fence`), active: join(root, `${gameId}.active`) };
  }

  private async exists(path: string): Promise<boolean> {
    try {
      await readFile(path);
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
      throw error;
    }
  }

  async begin(gameId: string): Promise<(() => Promise<void>) | null> {
    const paths = this.paths(gameId);
    await mkdir(paths.active, { recursive: true, mode: 0o700 });
    if (await this.exists(paths.fence)) return null;
    const marker = join(paths.active, randomUUID());
    await writeFile(marker, '', { flag: 'wx', mode: 0o600 });
    if (await this.exists(paths.fence)) {
      await unlink(marker);
      return null;
    }
    return async () => {
      await unlink(marker);
    };
  }

  async acquire(gameId: string, owner: string): Promise<boolean> {
    if (!/^[a-z0-9-]{1,40}$/u.test(owner)) throw new Error('invalid fence owner');
    const paths = this.paths(gameId);
    await mkdir(paths.active, { recursive: true, mode: 0o700 });
    const temporary = join(paths.root, `${gameId}.${randomUUID()}.tmp`);
    await writeFile(temporary, owner, { flag: 'wx', mode: 0o600 });
    try {
      await link(temporary, paths.fence);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      if ((await readFile(paths.fence, 'utf8')) !== owner)
        throw new Error('fence belongs to another owner', { cause: error });
    } finally {
      await unlink(temporary);
    }
    return (await readdir(paths.active)).length === 0;
  }

  async release(gameId: string, owner: string): Promise<void> {
    const paths = this.paths(gameId);
    let held: string;
    try {
      held = await readFile(paths.fence, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw error;
    }
    if (held !== owner) throw new Error('fence owner does not match');
    await unlink(paths.fence);
  }

  async hasTerminalAudit(gameId: string): Promise<boolean> {
    this.paths(gameId);
    const lines = createInterface({
      input: createReadStream(join(this.dataDirectory, 'commit', 'audit.jsonl')),
      crlfDelay: Infinity,
    });
    let terminal = false;
    for await (const line of lines) {
      const entry = JSON.parse(line) as { gameId?: unknown; op?: unknown; result?: unknown };
      if (entry.gameId === gameId && entry.op === 'create_game')
        terminal = entry.result === 'allowed' || entry.result === 'refused' || entry.result === 'error';
    }
    return terminal;
  }
}

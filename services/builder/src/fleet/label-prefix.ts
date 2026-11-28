import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parse } from 'yaml';

/** Read the dispatch prefix from the daemon's own configuration. */
export async function readDaemonLabelPrefix(checkout: string): Promise<string | null> {
  try {
    const config = parse(await readFile(join(checkout, '.aiur/config'), 'utf8')) as {
      tracker?: { github?: { label_prefix?: unknown } };
    } | null;
    const prefix = config?.tracker?.github?.label_prefix;
    return typeof prefix === 'string' && prefix.length > 0 ? prefix : null;
  } catch {
    return null;
  }
}

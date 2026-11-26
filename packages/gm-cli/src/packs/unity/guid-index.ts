import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

/** Index Unity sidecars in a source tree. Refuse ambiguity and links rather than guessing. */
export async function indexUnityGuids(root: string): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  async function visit(directory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`Unity source contains a symbolic link: ${path}`);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile() && entry.name.toLowerCase().endsWith('.meta')) {
        const data = await readFile(path, 'utf8');
        const matches = [...data.matchAll(/^guid:\s*([a-f0-9]{32})\s*$/gim)];
        if (matches.length !== 1) throw new Error(`invalid Unity GUID sidecar: ${path}`);
        const guid = matches[0]![1]!.toLowerCase();
        if (result.has(guid)) throw new Error(`duplicate Unity GUID ${guid}`);
        result.set(guid, path.slice(0, -5));
      }
    }
  }
  await visit(root);
  return result;
}

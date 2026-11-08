import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';

import type { LockEntry } from '@ogm/contracts';

/**
 * What a game's shipped code refers to: asset ids written as string literals in `src/` and `index.html`. The asset
 * list (`assets.lock.json`) is the record of what ships, so a literal id missing from it is a build error, and a list
 * entry nothing refers to is unused.
 */
export type References = {
  /** Literal asset id → the first file that names it. */
  ids: Map<string, string>;
  /** Ids the code builds at runtime (`t3:${game}/voice/${line}`): they can match entries but never fail a build. */
  patterns: Array<{ pattern: RegExp; file: string }>;
  /** Scanned source text, for entries referred to by their repo path instead of their id. */
  texts: string[];
};

const SOURCE = /\.(?:[cm]?[jt]sx?|json|html|css|vue|svelte)$/;
const TEST = /\.(?:test|spec)\.[^.]+$/;
const LITERAL = /(['"`])(t[123]:[A-Za-z0-9][A-Za-z0-9_-]*\/[A-Za-z0-9/._-]+?(?:@[A-Za-z0-9._-]+)?)\1/g;
const TEMPLATE = /`(t[123]:[^`]*?\$\{[^`]*)`/g;

async function sourceFiles(cwd: string): Promise<string[]> {
  const files = existsSync(join(cwd, 'index.html')) ? ['index.html'] : [];
  const root = join(cwd, 'src');
  if (!existsSync(root)) return files;
  for (const entry of await readdir(root, { recursive: true, withFileTypes: true })) {
    const path = relative(cwd, join(entry.parentPath, entry.name)).replaceAll(sep, '/');
    if (!entry.isFile() || !SOURCE.test(entry.name) || TEST.test(entry.name)) continue;
    if (path.split('/').some((part) => part === 'node_modules' || part === '__tests__')) continue;
    files.push(path);
  }
  return files.sort();
}

/**
 * The text with comments removed, so an id named only in a comment is neither a reference nor a build error. Strings
 * are kept whole; a template literal's `${}` is read as part of the string.
 */
function withoutComments(text: string, file: string): string {
  if (file.endsWith('.json')) return text;
  const html = file.endsWith('.html') || file.endsWith('.vue') || file.endsWith('.svelte');
  let out = '';
  let quote: string | null = null;
  for (let at = 0; at < text.length; at += 1) {
    const char = text[at]!;
    if (quote !== null) {
      out += char;
      if (char === '\\') out += text[++at] ?? '';
      else if (char === quote || (char === '\n' && quote !== '`')) quote = null;
      continue;
    }
    const close = html && text.startsWith('<!--', at) ? '-->' : text.startsWith('/*', at) ? '*/' : null;
    if (close !== null) {
      const end = text.indexOf(close, at + 2);
      at = end === -1 ? text.length : end + close.length - 1;
      continue;
    }
    if (text.startsWith('//', at) && !html && text[at - 1] !== ':') {
      const end = text.indexOf('\n', at);
      at = end === -1 ? text.length : end - 1;
      continue;
    }
    if (char === "'" || char === '"' || char === '`') quote = char;
    out += char;
  }
  return out;
}

function templatePattern(template: string): RegExp {
  const parts = template.split(/\$\{[^}]*\}/).map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return new RegExp(`^${parts.join('.+')}$`);
}

export async function scanReferences(cwd: string): Promise<References> {
  const references: References = { ids: new Map(), patterns: [], texts: [] };
  for (const file of await sourceFiles(cwd)) {
    const text = withoutComments(await readFile(join(cwd, file), 'utf8'), file);
    references.texts.push(text);
    for (const match of text.matchAll(LITERAL)) {
      if (!references.ids.has(match[2]!)) references.ids.set(match[2]!, file);
    }
    for (const match of text.matchAll(TEMPLATE)) {
      references.patterns.push({ pattern: templatePattern(match[1]!), file });
    }
  }
  return references;
}

export function isReferenced(entry: Pick<LockEntry, 'id' | 'path'>, references: References): boolean {
  return (
    references.ids.has(entry.id) ||
    references.patterns.some(({ pattern }) => pattern.test(entry.id)) ||
    references.texts.some((text) => text.includes(entry.path))
  );
}

/** Literal ids the code names that the list does not hold, each with the file that names it. */
export function unlisted(listed: Iterable<string>, references: References): Array<{ id: string; file: string }> {
  const held = new Set(listed);
  return [...references.ids].filter(([id]) => !held.has(id)).map(([id, file]) => ({ id, file }));
}

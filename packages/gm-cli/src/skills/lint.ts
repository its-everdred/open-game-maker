import { readFileSync } from 'node:fs';

export type SkillReferenceCatalog = {
  commands: ReadonlySet<string>;
  sdkExports: Record<string, unknown>;
};

export type SkillReferenceMisses = {
  commands: string[];
  sdk: string[];
};

type InlineSpan = { value: string; index: number; end: number };

const NAMESPACED_COMMANDS = new Set([
  'assets',
  'build',
  'capture',
  'packs',
  'maps',
  'docs',
  'command',
  'chat',
  'options',
  'scope',
  'skills',
  'check',
  'verify',
  'qa',
  'look',
]);

function inlineSpans(markdown: string): InlineSpan[] {
  return [...markdown.matchAll(/(?<!`)`([^`\r\n]+)`(?!`)/g)].map((match) => ({
    value: match[1].trim(),
    index: match.index,
    end: match.index + match[0].length,
  }));
}

function inlineCode(markdown: string): string[] {
  return inlineSpans(markdown).map(({ value }) => value);
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

/** Return the registered command names named by inline `gm ...` invocations. */
export function extractCommands(markdown: string): string[] {
  return unique(
    inlineCode(markdown).flatMap((value) => {
      if (!/^gm\s+\S/.test(value)) return [];
      const words = value.split(/\s+/);
      const hasSubcommand =
        (NAMESPACED_COMMANDS.has(words[1]) && words[2] !== undefined && !words[2].startsWith('-')) ||
        (words[1] === 'py' && words[2] === 'setup');
      const length = hasSubcommand ? 3 : 2;
      return [words.slice(0, length).join(' ')];
    }),
  );
}

/** Return catalog paths from inline SDK and contract references. */
export function extractSdkNames(markdown: string): string[] {
  const spans = inlineSpans(markdown);
  return unique(
    spans.flatMap((span, index) => {
      const explicit = span.value.match(/^sdk\.([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)(?:\(.*\))?$/)?.[1];
      if (explicit) return [explicit];

      const contract = span.value.match(/^([A-Z][A-Za-z0-9_$]*(?:\.[A-Za-z_$][\w$]*)*)(?:\(.*\))?$/)?.[1];
      if (contract) return [contract];

      const call = span.value.match(/^([a-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\(.*\)$/)?.[1];
      if (!call) return [];
      const packageSpan = spans
        .slice(0, index)
        .reverse()
        .find(({ value, end }) => /^@gm\/sdk(?:\/[A-Za-z0-9_-]+)?$/.test(value) && span.index - end <= 160);
      const subpath = packageSpan?.value.match(/^@gm\/sdk\/([A-Za-z0-9_-]+)$/)?.[1];
      return packageSpan ? [`${subpath ? `${subpath}.` : ''}${call}`] : [];
    }),
  );
}

function commandExists(reference: string, commands: ReadonlySet<string>): boolean {
  return commands.has(reference.slice('gm '.length));
}

function sdkExportExists(path: string, exports: Record<string, unknown>): boolean {
  let current: unknown = exports;
  for (const part of path.split('.')) {
    if (
      (typeof current !== 'object' && typeof current !== 'function') ||
      current === null ||
      !Object.hasOwn(current, part)
    )
      return false;
    current = (current as Record<string, unknown>)[part];
  }
  return true;
}

/** Check one skill's written command and SDK references against live registries. */
export function checkSkill(path: string, catalog: SkillReferenceCatalog): SkillReferenceMisses {
  const markdown = readFileSync(path, 'utf8');
  return {
    commands: extractCommands(markdown).filter((reference) => !commandExists(reference, catalog.commands)),
    sdk: extractSdkNames(markdown).filter((name) => !sdkExportExists(name, catalog.sdkExports)),
  };
}

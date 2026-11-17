import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { isAbsolute, join, relative, sep } from 'node:path';

import ts from 'typescript';

import type { GateCheck, GateResult } from './index.js';
import { scanRepo } from './no-wall-clock.js';
import { scanImageStretch } from './image-stretch.js';

export type L0CheckId = 'typecheck' | 'no-wall-clock-in-sim' | 'hook-present' | 'image-stretch';
export type RunL0Options = { checks?: L0CheckId[] };

const require = createRequire(import.meta.url);

function slash(path: string): string {
  return path.split(sep).join('/');
}

function sourceFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules') files.push(...sourceFiles(path));
    } else if (entry.isFile() && /\.(?:mts|cts|tsx?)$/.test(entry.name) && !/\.(?:spec|test)\.[^.]+$/.test(entry.name))
      files.push(path);
  }
  return files;
}

function typecheck(root: string): GateCheck[] {
  const config = join(root, 'tsconfig.json');
  if (!existsSync(config)) return [{ id: 'typecheck', ok: false, detail: 'unavailable: tsconfig.json' }];

  let tsc: string;
  try {
    tsc = createRequire(join(root, 'package.json')).resolve('typescript/bin/tsc');
  } catch {
    try {
      tsc = require.resolve('typescript/bin/tsc');
    } catch {
      return [{ id: 'typecheck', ok: false, detail: 'unavailable: tsc' }];
    }
  }
  const result = spawnSync(process.execPath, [tsc, '--noEmit', '--pretty', 'false', '-p', config], {
    cwd: root,
    encoding: 'utf8',
    timeout: 5 * 60_000,
  });
  if (result.error) return [{ id: 'typecheck', ok: false, detail: `unavailable: ${result.error.message}` }];
  if (result.status === 0) return [{ id: 'typecheck', ok: true }];

  const diagnostics = `${result.stdout}\n${result.stderr}`
    .split(/\r?\n/)
    .flatMap((line): GateCheck[] => {
      const match = /^(.*)\((\d+),(\d+)\): error TS\d+: (.*)$/.exec(line.trim());
      if (!match) return [];
      const absolute = isAbsolute(match[1]!) ? match[1]! : join(root, match[1]!);
      return [
        {
          id: 'typecheck',
          ok: false,
          detail: match[4]!,
          file: slash(relative(root, absolute)),
          line: Number(match[2]),
        },
      ];
    })
    .slice(0, 20);
  if (diagnostics.length > 0) return diagnostics;
  return [{ id: 'typecheck', ok: false, detail: `${result.stderr || result.stdout}`.trim() || 'tsc failed' }];
}

export function checkHookPresence(root: string): GateCheck {
  let files: string[];
  try {
    files = sourceFiles(join(root, 'src')).sort();
  } catch {
    return { id: 'hook-present', ok: false, detail: 'unavailable: src directory' };
  }
  let moduleFile: string | undefined;
  let moduleLine = 1;
  let wired = false;
  for (const path of files) {
    const text = readFileSync(path, 'utf8');
    const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
    const bootNames = new Set<string>();
    for (const statement of source.statements) {
      if (
        !ts.isImportDeclaration(statement) ||
        statement.moduleSpecifier.getText(source).slice(1, -1) !== '@gm/sdk/core'
      )
        continue;
      const bindings = statement.importClause?.namedBindings;
      if (!bindings || !ts.isNamedImports(bindings)) continue;
      for (const element of bindings.elements) {
        if ((element.propertyName ?? element.name).text === 'boot') bootNames.add(element.name.text);
      }
    }
    const visit = (node: ts.Node): void => {
      if (
        moduleFile === undefined &&
        ts.isTypeReferenceNode(node) &&
        ts.isIdentifier(node.typeName) &&
        node.typeName.text === 'GameModule'
      ) {
        const position = source.getLineAndCharacterOfPosition(node.getStart(source));
        moduleFile = path;
        moduleLine = position.line + 1;
      }
      if (ts.isCallExpression(node)) {
        const sdkBoot = ts.isIdentifier(node.expression) && bootNames.has(node.expression.text);
        const directRegistration =
          ts.isPropertyAccessExpression(node.expression) &&
          node.expression.name.text === 'register' &&
          ts.isPropertyAccessExpression(node.expression.expression) &&
          node.expression.expression.name.text === 'test' &&
          ts.isIdentifier(node.expression.expression.expression) &&
          node.expression.expression.expression.text === 'host';
        wired ||= sdkBoot || directRegistration;
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  if (moduleFile && wired) return { id: 'hook-present', ok: true };
  return {
    id: 'hook-present',
    ok: false,
    detail: moduleFile ? 'GameModule is not wired through SDK boot or host.test.register' : 'no GameModule found',
    ...(moduleFile ? { file: slash(relative(root, moduleFile)), line: moduleLine } : {}),
  };
}

export function runL0(root: string, options: RunL0Options = {}): GateResult {
  const started = performance.now();
  const selected = new Set<L0CheckId>(
    options.checks ?? ['typecheck', 'no-wall-clock-in-sim', 'hook-present', 'image-stretch'],
  );
  const checks: GateCheck[] = [];
  if (selected.has('typecheck')) checks.push(...typecheck(root));
  if (selected.has('no-wall-clock-in-sim')) {
    if (!existsSync(join(root, 'src')))
      checks.push({ id: 'no-wall-clock-in-sim', ok: false, detail: 'unavailable: src directory' });
    else {
      try {
        const findings = scanRepo(root);
        if (findings.length === 0) checks.push({ id: 'no-wall-clock-in-sim', ok: true });
        else
          checks.push(
            ...findings.map(({ file, line, what }) => ({
              id: 'no-wall-clock-in-sim' as const,
              ok: false,
              detail: `${what} in simulation (use sdk rng)`,
              file,
              line,
            })),
          );
      } catch {
        checks.push({ id: 'no-wall-clock-in-sim', ok: false, detail: 'unavailable: src directory' });
      }
    }
  }
  if (selected.has('hook-present')) checks.push(checkHookPresence(root));
  if (selected.has('image-stretch')) {
    try {
      const findings = scanImageStretch(root);
      checks.push(...(findings.length ? findings : [{ id: 'image-stretch' as const, ok: true }]));
    } catch (error) {
      checks.push({
        id: 'image-stretch',
        ok: false,
        detail: `unable to scan images: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  }
  return {
    gate: 'L0',
    ok: checks.every((check) => check.ok),
    durationMs: Math.round(performance.now() - started),
    checks,
  };
}

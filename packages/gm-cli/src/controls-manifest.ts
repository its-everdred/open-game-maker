import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import ts from 'typescript';

export function findControlsGame(cwd: string): string | undefined {
  let current = resolve(cwd);
  for (;;) {
    if (
      ['gm.manifest.json', 'src/manifest.ts', 'src/game.ts', '.gm/game.json'].some((name) =>
        existsSync(join(current, name)),
      )
    )
      return current;
    const parent = dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}

/** Read control inputs without executing a game's manifest module. Dynamic expressions fail closed. */
export function readControlInputs(game: string): unknown {
  const json = join(game, 'gm.manifest.json');
  let jsonInputs: unknown;
  if (existsSync(json)) {
    const manifest: unknown = JSON.parse(readFileSync(json, 'utf8'));
    if (manifest && typeof manifest === 'object' && 'inputs' in manifest) jsonInputs = manifest.inputs;
  }
  for (const name of ['src/manifest.ts', 'src/game.ts']) {
    const path = join(game, name);
    if (!existsSync(path)) continue;
    const file = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const findInputs = (node: ts.Node): ts.Expression | undefined => {
      if (
        ts.isVariableDeclaration(node) &&
        ts.isIdentifier(node.name) &&
        (node.name.text === 'manifest' || node.name.text === 'game') &&
        node.initializer
      ) {
        const root = unwrap(node.initializer);
        if (node.name.text === 'manifest' && ts.isIdentifier(root)) return root;
        if (ts.isObjectLiteralExpression(root)) {
          const manifest = node.name.text === 'game' ? property(root, 'manifest') : root;
          if (manifest) {
            const value = unwrap(manifest);
            if (ts.isIdentifier(value)) return value;
            if (ts.isObjectLiteralExpression(value)) return property(value, 'inputs');
          }
        }
      }
      return ts.forEachChild(node, findInputs);
    };
    const expression = findInputs(file);
    if (expression) {
      const value = unwrap(expression);
      const imported = ts.isIdentifier(value)
        ? value
        : ts.isPropertyAccessExpression(value) && value.name.text === 'inputs' && ts.isIdentifier(value.expression)
          ? value.expression
          : undefined;
      const isJsonImport =
        imported &&
        file.statements.some(
          (statement) =>
            ts.isImportDeclaration(statement) &&
            ts.isStringLiteral(statement.moduleSpecifier) &&
            resolve(dirname(path), statement.moduleSpecifier.text) === resolve(json) &&
            statement.importClause?.name?.text === imported.text,
        );
      if (isJsonImport && jsonInputs !== undefined) return jsonInputs;
      const resolved = literal(value);
      if (jsonInputs !== undefined && !isDeepStrictEqual(jsonInputs, JSON.parse(JSON.stringify(resolved))))
        throw new Error('manifest control declarations conflict');
      return resolved;
    }
    if (name === 'src/manifest.ts') throw new Error('unable to resolve static manifest inputs');
  }
  if (jsonInputs !== undefined) return jsonInputs;
  throw new Error('unable to resolve static manifest inputs');
}

function unwrap(node: ts.Expression): ts.Expression {
  while (
    ts.isAsExpression(node) ||
    ts.isSatisfiesExpression(node) ||
    ts.isParenthesizedExpression(node) ||
    ts.isTypeAssertionExpression(node)
  )
    node = node.expression;
  return node;
}

function property(node: ts.ObjectLiteralExpression, name: string): ts.Expression | undefined {
  let value: ts.Expression | undefined;
  for (const item of node.properties) {
    // A spread or computed key could override the inputs after the literal we inspected.
    if (ts.isSpreadAssignment(item) || (item.name && ts.isComputedPropertyName(item.name)))
      throw new Error('manifest inputs must be static');
    if (
      ts.isPropertyAssignment(item) &&
      (ts.isIdentifier(item.name) || ts.isStringLiteral(item.name)) &&
      item.name.text === name
    ) {
      if (value) throw new Error('manifest inputs must not be duplicated');
      value = item.initializer;
    }
  }
  return value;
}

function literal(expression: ts.Expression): unknown {
  const node = unwrap(expression);
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isNumericLiteral(node)) return Number(node.text);
  if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
  if (ts.isArrayLiteralExpression(node))
    return node.elements.map((item) => {
      if (ts.isSpreadElement(item) || ts.isOmittedExpression(item)) throw new Error('inputs must be static');
      return literal(item);
    });
  if (ts.isObjectLiteralExpression(node)) {
    const value: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    for (const item of node.properties) {
      if (!ts.isPropertyAssignment(item) || !(ts.isIdentifier(item.name) || ts.isStringLiteral(item.name)))
        throw new Error('inputs must be static');
      value[item.name.text] = literal(item.initializer);
    }
    return value;
  }
  throw new Error('inputs must be static');
}

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import ts from 'typescript';
import type { GateCheck } from './index.js';

const rasterSource =
  /(?:url\(\s*["']?data:image\/(?:png|jpe?g|webp|gif|avif)|url\([^)]*\.(?:png|jpe?g|webp|gif|avif)|var\()/i;
const length = '(?:[+-]?(?:\\d*\\.)?\\d+(?:%|[a-z]+)?|(?:calc|min|max|clamp)\\([^;{}]*?\\))';
const twoLengths = new RegExp(`^\\s*${length}\\s+${length}(?:\\s|;|$)`, 'i');

function conditionalAt(text: string, end: number): boolean {
  const stack: boolean[] = [];
  let boundary = 0;
  for (let i = 0; i < end; i++) {
    if (text[i] === '{') {
      stack.push(/(?:^|;)\s*@(media|supports|container)\b/i.test(text.slice(boundary, i)));
      boundary = i + 1;
    } else if (text[i] === '}') {
      stack.pop();
      boundary = i + 1;
    }
  }
  return stack.some(Boolean);
}

function maskComments(file: string, text: string): string {
  const masked = text
    .replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, ' '))
    .replace(/<!--[\s\S]*?-->/g, (comment) => comment.replace(/[^\n]/g, ' '))
    .split('');
  if (/\.[cm]?[jt]sx?$/.test(file)) {
    const scanner = ts.createScanner(ts.ScriptTarget.Latest, false, ts.LanguageVariant.JSX, text);
    for (let token = scanner.scan(); token !== ts.SyntaxKind.EndOfFileToken; token = scanner.scan()) {
      if (token === ts.SyntaxKind.SingleLineCommentTrivia)
        for (let i = scanner.getTokenPos(); i < scanner.getTextPos(); i++) masked[i] = ' ';
    }
  }
  return masked.join('');
}

/** Conservative source checks; the capture gate measures the actual rendered result. */
export function scanImageStretch(root: string): GateCheck[] {
  const findings: GateCheck[] = [];
  const report = (file: string, text: string, offset: number, detail: string) => {
    const before = text.slice(0, offset);
    const lineStart = before.lastIndexOf('\n') + 1;
    const previous = before.slice(Math.max(0, before.lastIndexOf('\n', lineStart - 2) + 1));
    const lineEnd = text.indexOf('\n', offset);
    const sameLine = text.slice(lineStart, lineEnd < 0 ? text.length : lineEnd);
    const exception = /\/\*\s*gm-allow-stretch:\s*[^*\s][\s\S]*?\*\//;
    if (exception.test(sameLine) || /^\s*\/\*\s*gm-allow-stretch:\s*[^*\s][\s\S]*?\*\/\s*$/.test(previous)) return;
    findings.push({
      id: 'image-stretch',
      ok: false,
      file: relative(root, file),
      line: before.split('\n').length,
      detail,
    });
  };
  const files: string[] = [];
  const scan = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('.') || ['node_modules', 'dist', 'prototypes', 'coverage'].includes(entry.name))
        continue;
      const file = join(dir, entry.name);
      if (entry.isDirectory()) {
        scan(file);
        continue;
      }
      if (!entry.isFile() || !/\.(?:css|html|[cm]?[jt]sx?)$/.test(entry.name) || /\.(?:test|spec)\./.test(entry.name))
        continue;
      files.push(file);
    }
  };
  scan(root);
  const texts = files.map((file) => readFileSync(file, 'utf8'));
  const byPath = new Map(files.map((file, index) => [resolve(file), texts[index]!]));
  for (const [index, file] of files.entries()) {
    const entry = { name: file };
    const text = texts[index]!;
    const related = new Set<string>();
    const collectStyles = (path: string) => {
      if (related.has(path)) return;
      related.add(path);
      const content = maskComments(path, byPath.get(path) ?? '');
      if (!content) return;
      for (const match of content.matchAll(
        /(?:href\s*=\s*|(?:from\s+|import\s*)?)["'](?![a-z]+:|\/\/)([^"'?#]+\.css)["']/gi,
      )) {
        const start = content.lastIndexOf('<link', match.index);
        const end = content.indexOf('>', start);
        if (start >= 0 && end >= match.index) {
          const link = content.slice(start, end + 1);
          const rel = /\brel\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(link);
          if (!rel || !(rel[1] ?? rel[2] ?? rel[3] ?? '').toLowerCase().split(/\s+/).includes('stylesheet')) continue;
          if (/\sdisabled(?:\s|=|\/?>)/i.test(link)) continue;
          const media = /\bmedia\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(content.slice(start, end + 1));
          if (media && (media[1] ?? media[2] ?? media[3] ?? '').trim().toLowerCase() !== 'all') continue;
        }
        const line = content.slice(
          content.lastIndexOf('\n', match.index) + 1,
          content.indexOf('\n', match.index) < 0 ? content.length : content.indexOf('\n', match.index),
        );
        if (/^\s*@import\b/i.test(line) && /(?:["']|\))\s+(?!all\s*;)[^;]+;/i.test(line)) continue;
        collectStyles(match[1]!.startsWith('/') ? resolve(root, `.${match[1]!}`) : resolve(dirname(path), match[1]!));
      }
    };
    collectStyles(resolve(file));
    const css = [...related].map((path) => maskComments(path, byPath.get(path) ?? '')).join('\n}\n');
    const rasterSelectors = new Set<string>();
    for (const rule of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      if (/\bbackground(?:-image)?\s*:/i.test(rule[2]!) && rasterSource.test(rule[2]!))
        for (const selector of rule[1]!.split(',')) rasterSelectors.add(selector.trim());
    }
    const code = maskComments(file, text);
    for (const match of code.matchAll(/\bobject-fit\s*:\s*fill\b/gi))
      report(file, text, match.index, 'image may be stretched by CSS');
    for (const match of code.matchAll(/\bbackground-size\s*:\s*100%\s+100%(?![\w.-])/gi))
      report(file, text, match.index, 'background may be stretched by CSS');
    for (const match of code.matchAll(/\bbackground\s*:[^;{}]*\/\s*100%\s+100%(?![\w.-])/gi))
      report(file, text, match.index, 'background may be stretched by CSS');
    for (const block of code.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      if (
        !rasterSource.test(block[2]!) &&
        !block[1]!.split(',').some((selector) => rasterSelectors.has(selector.trim()))
      )
        continue;
      const size = /\bbackground-size\s*:\s*([^;{}]+)/i.exec(block[2]!);
      const shorthand = /\bbackground\s*:[^;{}]*\/\s*([^;{}]+)/i.exec(block[2]!);
      if (shorthand && twoLengths.test(shorthand[1]!) && !/100%\s+100%/i.test(shorthand[0]))
        report(
          file,
          text,
          block.index + block[1]!.length + 1 + shorthand.index,
          'raster background may be stretched by CSS',
        );
      if (size && twoLengths.test(size[1]!) && !/100%\s+100%/i.test(size[0]))
        report(
          file,
          text,
          block.index + block[1]!.length + 1 + size.index,
          'raster background may be stretched by CSS',
        );
    }
    const isStyled = (tag: string) => {
      const classes = /\bclass(?:Name)?=["']([^"']+)["']/.exec(tag)?.[1]?.split(/\s+/) ?? [];
      const id = /\bid=["']([^"']+)["']/.exec(tag)?.[1];
      const selectors = ['img', ...classes.map((name) => `.${name}`), ...(id ? [`#${id}`] : [])];
      const styled = [...css.matchAll(/([^{}]+)\{[^{}]*object-fit\s*:\s*(?:contain|cover|none|scale-down)[^{}]*\}/gi)]
        .filter((rule) => !conditionalAt(css, rule.index))
        .some((rule) =>
          rule[1]!.split(',').some((part) => {
            const target = part.trim();
            if (/[\s>+~:[]/.test(target)) return false;
            const components = target.match(/(?:^[a-z][\w-]*|[.#][\w-]+)/gi) ?? [];
            return components.length > 0 && components.every((component) => selectors.includes(component));
          }),
        );
      return /object[-Ff]it/.test(tag) || styled;
    };
    for (const match of code.matchAll(/<img\b[^>]*>/gi)) {
      if (/\.[jt]sx$/.test(entry.name)) continue;
      if (/\bwidth\s*=/.test(match[0]) && /\bheight\s*=/.test(match[0]) && !isStyled(match[0]))
        report(file, text, match.index, 'image has width and height without object-fit');
    }
    if (!/\.[cm]?[jt]sx?$/.test(entry.name)) continue;
    const source = ts.createSourceFile(
      file,
      text,
      ts.ScriptTarget.Latest,
      true,
      entry.name.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );
    const visit = (node: ts.Node) => {
      if (
        (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) &&
        node.tagName.getText(source) === 'img'
      ) {
        const attributes = node.attributes.properties
          .filter(ts.isJsxAttribute)
          .map((attr) => attr.name.getText(source));
        if (attributes.includes('width') && attributes.includes('height') && !isStyled(node.getText(source)))
          report(file, text, node.getStart(source), 'image has width and height without object-fit');
      }
      let property: string | undefined;
      let value: ts.Expression | undefined;
      if (
        ts.isBinaryExpression(node) &&
        node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
        ts.isPropertyAccessExpression(node.left) &&
        ts.isPropertyAccessExpression(node.left.expression) &&
        node.left.expression.name.text === 'style'
      ) {
        property = node.left.name.text;
        value = node.right;
      } else if (
        ts.isPropertyAssignment(node) &&
        ts.isObjectLiteralExpression(node.parent) &&
        ((ts.isJsxExpression(node.parent.parent) &&
          ts.isJsxAttribute(node.parent.parent.parent) &&
          node.parent.parent.parent.name.getText(source) === 'style') ||
          (ts.isPropertyAssignment(node.parent.parent) && node.parent.parent.name.getText(source) === 'style'))
      ) {
        property = node.name.getText(source).replace(/^["']|["']$/g, '');
        value = node.initializer;
      }
      if (value && ts.isStringLiteralLike(value)) {
        if (property === 'objectFit' && value.text === 'fill')
          report(file, text, node.getStart(source), 'image may be stretched by objectFit');
        if (property === 'backgroundSize' && twoLengths.test(value.text))
          report(file, text, node.getStart(source), 'background may be stretched by backgroundSize');
      }
      if (
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression) &&
        node.expression.name.text === 'drawImage' &&
        node.arguments.length === 9
      ) {
        const values = [3, 4, 7, 8]
          .map((i) => node.arguments[i])
          .map((arg) => (arg && ts.isNumericLiteral(arg) ? Number(arg.text) : NaN));
        const [sw, sh, dw, dh] = values as [number, number, number, number];
        if (sw > 0 && sh > 0 && dw > 0 && dh > 0 && Math.abs(dw / dh / (sw / sh) - 1) > 0.02 + 1e-9)
          report(file, text, node.getStart(source), 'drawImage source and destination ratios differ');
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return findings;
}

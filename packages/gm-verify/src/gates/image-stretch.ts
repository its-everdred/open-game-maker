import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import ts from 'typescript';
import type { GateCheck } from './index.js';

/** Conservative source checks; the capture gate measures the actual rendered result. */
export function scanImageStretch(root: string): GateCheck[] {
  const findings: GateCheck[] = [];
  const report = (file: string, text: string, offset: number, detail: string) => {
    const before = text.slice(0, offset);
    const lineStart = before.lastIndexOf('\n') + 1;
    const previous = before.slice(Math.max(0, before.lastIndexOf('\n', lineStart - 2) + 1));
    const lineEnd = text.indexOf('\n', offset);
    const sameLine = text.slice(lineStart, lineEnd < 0 ? text.length : lineEnd);
    if (/\/\*\s*gm-allow-stretch:\s*[^*\s][\s\S]*?\*\//.test(previous + sameLine)) return;
    findings.push({
      id: 'image-stretch',
      ok: false,
      file: relative(root, file),
      line: before.split('\n').length,
      detail,
    });
  };
  const scan = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('.') || ['node_modules', 'dist'].includes(entry.name)) continue;
      const file = join(dir, entry.name);
      if (entry.isDirectory()) {
        scan(file);
        continue;
      }
      if (!entry.isFile() || !/\.(?:css|html|[cm]?[jt]sx?)$/.test(entry.name) || /\.(?:test|spec)\./.test(entry.name))
        continue;
      const text = readFileSync(file, 'utf8');
      const code = text.replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, ' '));
      for (const match of code.matchAll(/\bobject-fit\s*:\s*fill\b/gi))
        report(file, text, match.index, 'image may be stretched by CSS');
      for (const match of code.matchAll(/\bbackground-size\s*:\s*100%\s+100%(?![\w.-])/gi))
        report(file, text, match.index, 'background may be stretched by CSS');
      for (const match of code.matchAll(/\bbackground\s*:[^;{}]*\/\s*100%\s+100%(?![\w.-])/gi))
        report(file, text, match.index, 'background may be stretched by CSS');
      for (const block of code.matchAll(/\{[^{}]*\}/g)) {
        if (!/url\([^)]*\.(?:png|jpe?g|webp|gif|avif)(?:[?#][^)]*)?["']?\)/i.test(block[0])) continue;
        const size =
          /\bbackground-size\s*:\s*(?:\d+(?:\.\d+)?(?:px|em|rem|%|vw|vh))\s+(?:\d+(?:\.\d+)?(?:px|em|rem|%|vw|vh))/i.exec(
            block[0],
          );
        if (size && !/100%\s+100%/i.test(size[0]))
          report(file, text, block.index + size.index, 'raster background may be stretched by CSS');
      }
      for (const match of code.matchAll(/<img\b[^>]*>/gi)) {
        if (/\bwidth\s*=/.test(match[0]) && /\bheight\s*=/.test(match[0]) && !/object[-Ff]it/.test(match[0]))
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
          ts.isCallExpression(node) &&
          ts.isPropertyAccessExpression(node.expression) &&
          node.expression.name.text === 'drawImage' &&
          node.arguments.length === 9
        ) {
          const values = [3, 4, 7, 8]
            .map((i) => node.arguments[i])
            .map((arg) => (arg && ts.isNumericLiteral(arg) ? Number(arg.text) : NaN));
          const [sw, sh, dw, dh] = values as [number, number, number, number];
          if (sw > 0 && sh > 0 && dw > 0 && dh > 0 && Math.abs(dw / dh / (sw / sh) - 1) > 0.02)
            report(file, text, node.getStart(source), 'drawImage source and destination ratios differ');
        }
        ts.forEachChild(node, visit);
      };
      visit(source);
    }
  };
  scan(root);
  return findings;
}

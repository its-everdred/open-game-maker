/** Rewrite root-relative URL values without altering absolute URLs containing the same path. */
export function rewriteRootReferences(
  text: string,
  rewrite: (value: string, moduleRelative: boolean) => string,
  css = false,
  html = false,
): string {
  if (html) {
    const blocks = [...text.matchAll(/(<(style|script)\b[^>]*>)([\s\S]*?)(<\/\2\s*>)/giu)];
    if (blocks.length) {
      let cursor = 0;
      let result = '';
      for (const block of blocks) {
        result += rewriteRootReferences(text.slice(cursor, block.index), rewrite, false, true);
        result +=
          rewriteRootReferences(block[1]!, rewrite, false, true) +
          rewriteRootReferences(block[3]!, rewrite, block[2]!.toLowerCase() === 'style') +
          block[4];
        cursor = block.index + block[0].length;
      }
      return result + rewriteRootReferences(text.slice(cursor), rewrite, false, true);
    }
  }
  const pattern = html
    ? /<!--[\s\S]*?-->|["'`]|url\(([^)]*)\)|(\b(?:src|href|poster)\s*=\s*)(\/(?!\/)[^\s>]+)/gsu
    : /\/\/[^\r\n]*|\/\*[\s\S]*?\*\/|["'`]|url\(([^)]*)\)|(\b(?:src|href|poster)\s*=\s*)(\/(?!\/)[^\s>]+)/gsu;
  let result = '';
  let cursor = 0;
  for (let match = pattern.exec(text); match; match = pattern.exec(text)) {
    const offset = match.index;
    let whole = match[0];
    const [, cssValue, attribute, attributeValue] = match;
    let quote: string | undefined;
    let value: string | undefined;
    if (whole === '"' || whole === "'" || whole === '`') {
      quote = whole;
      let end = offset + 1;
      while (end < text.length && text[end] !== quote) {
        end += text[end] === '\\' && end + 1 < text.length ? 2 : 1;
      }
      if (end < text.length) {
        whole = text.slice(offset, end + 1);
        value = text.slice(offset + 1, end);
        pattern.lastIndex = end + 1;
      }
    }
    const replacement = (() => {
      if (attribute && attributeValue) return html ? attribute + rewrite(attributeValue, false) : whole;
      if (quote !== undefined && value !== undefined) {
        const before = text.slice(Math.max(0, offset - 120), offset);
        const after = text.slice(offset + whole.length, offset + whole.length + 60);
        if (html && /\bstyle\s*=\s*$/iu.test(before))
          return `${quote}${rewriteRootReferences(value, rewrite, true)}${quote}`;
        const moduleRelative =
          /\b(?:from|import)\s*(?:\(\s*)?$/u.test(before) ||
          (/\bnew\s+URL\s*\(\s*$/u.test(before) && /^\s*,\s*import\.meta\.url/u.test(after));
        return `${quote}${rewrite(value, moduleRelative)}${quote}`;
      }
      if (cssValue === undefined || !css) return whole;
      const trimmed = cssValue.trim();
      const quoteChar = trimmed[0];
      const quoted = (quoteChar === '"' || quoteChar === "'") && trimmed.endsWith(quoteChar);
      const path = quoted ? trimmed.slice(1, -1) : trimmed;
      return whole.replace(path, rewrite(path, true));
    })();
    result += text.slice(cursor, offset) + replacement;
    cursor = offset + whole.length;
  }
  return result + text.slice(cursor);
}

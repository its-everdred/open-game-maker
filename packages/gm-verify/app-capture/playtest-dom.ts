/**
 * Runs inside the game frame while the playtest bot plays. Self-contained: Playwright serializes it into the page.
 * Returns what the runner turns into failures: the board count, text a long press would select, whether the
 * touch-callout rule covers the page, and the game's own state checks.
 */
export async function inspectPlaytest(): Promise<{
  boards: number;
  selectable: string[];
  callout: boolean;
  invariants: { name: string; ok: boolean; detail?: string }[] | null | 'absent';
}> {
  const shown = (element: Element) => {
    const bounds = element.getBoundingClientRect();
    if (bounds.width <= 0 || bounds.height <= 0) return false;
    for (let item: Element | null = element; item; item = item.parentElement) {
      const style = getComputedStyle(item);
      if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false;
    }
    return true;
  };
  const boards = [...document.querySelectorAll('[data-gm-play-area]')].filter(shown).length;

  // Chromium resolves `user-select` through inheritance, so the computed value is what a long press meets.
  const selectable: string[] = [];
  for (const element of document.querySelectorAll<HTMLElement>('body *')) {
    if (selectable.length >= 5) break;
    if (element.closest('input, textarea, [contenteditable=""], [contenteditable="true"]')) continue;
    const text = [...element.childNodes]
      .filter((node) => node.nodeType === Node.TEXT_NODE)
      .map((node) => node.textContent ?? '')
      .join('')
      .trim();
    if (!text || !shown(element)) continue;
    const style = getComputedStyle(element);
    if (style.userSelect !== 'none' && style.webkitUserSelect !== 'none') selectable.push(text.slice(0, 40));
  }

  // Chromium drops `-webkit-touch-callout` from the CSSOM, so read the stylesheet text iOS Safari will read.
  const sources: string[] = [
    ...[...document.querySelectorAll('style')].map((style) => style.textContent ?? ''),
    `html{${document.documentElement.getAttribute('style') ?? ''}}`,
    `body{${document.body.getAttribute('style') ?? ''}}`,
  ];
  for (const link of document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]')) {
    try {
      const response = await fetch(link.href);
      if (response.ok) sources.push(await response.text());
    } catch {
      // An unreadable sheet cannot prove the rule; the other sources still may.
    }
  }
  const callout = sources.some((css) => {
    const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '');
    for (const match of stripped.matchAll(/([^{}]*)\{([^{}]*)\}/g)) {
      if (!/(^|;)\s*-webkit-touch-callout\s*:\s*none\s*(!important\s*)?(;|$)/i.test(match[2]!)) continue;
      const selectors = match[1]!.split(',').map((selector) => selector.trim());
      if (
        selectors.some((selector) => {
          try {
            return selector === '*' || document.documentElement.matches(selector) || document.body.matches(selector);
          } catch {
            return false;
          }
        })
      )
        return true;
    }
    return false;
  });

  const qa = (
    window as unknown as { __gmQa?: { invariants(): { name: string; ok: boolean; detail?: string }[] | null } }
  ).__gmQa;
  return { boards, selectable, callout, invariants: qa ? qa.invariants() : 'absent' };
}

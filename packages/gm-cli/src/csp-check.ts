import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

/*
 * Static checks against the games host's CSP (`gameHeaders` in @ogm/contracts): `script-src 'self'` refuses inline
 * scripts, inline event handlers and `javascript:` URLs; every other load is limited to the game's own origin (plus
 * blob:/data: for images and media), and `default-src 'none'` refuses frames and plugins outright.
 */

const JS_TYPES = new Set([
  '',
  'module',
  'importmap',
  'speculationrules',
  'text/javascript',
  'application/javascript',
  'text/ecmascript',
  'application/ecmascript',
  'text/jscript',
  'text/livescript',
  'application/x-javascript',
  'text/x-javascript',
]);
const TAG = /<([a-zA-Z][\w-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/gu;
const ATTRIBUTE = /([^\s"'=<>/]+)(?:\s*=\s*("[^"]*"|'[^']*'|[^\s"'=<>`]+))?/gu;
const LOADS: Record<string, string> = {
  script: 'src',
  link: 'href',
  img: 'src',
  audio: 'src',
  video: 'src',
  source: 'src',
  track: 'src',
  input: 'src',
};
const LOADING_LINKS = /\b(?:stylesheet|preload|modulepreload|icon|manifest)\b/iu;

function attributes(source: string): Map<string, string> {
  const result = new Map<string, string>();
  for (const [, name, raw] of source.matchAll(ATTRIBUTE)) {
    const value = raw === undefined ? '' : raw.replace(/^["']|["']$/gu, '');
    const key = name!.toLowerCase();
    if (!result.has(key)) result.set(key, value);
  }
  return result;
}

const offOrigin = (url: string) => /^(?:[a-z][a-z\d+.-]*:)?\/\//iu.test(url.trim());

/** The CSP problems in one HTML document, each naming the element the games host would block. */
export function cspProblemsInHtml(html: string): string[] {
  const problems: string[] = [];
  const text = html.replace(/<!--[\s\S]*?-->/gu, '');
  const bodiless = text.replace(
    /<(script|style)\b((?:[^>"']|"[^"]*"|'[^']*')*)>([\s\S]*?)<\/\1\s*>/giu,
    (_match, tag: string, attrs: string, body: string) => {
      const type = (attributes(attrs).get('type') ?? '').trim().toLowerCase();
      if (tag.toLowerCase() === 'script' && !attributes(attrs).has('src') && JS_TYPES.has(type) && body.trim())
        problems.push('an inline <script>');
      return `<${tag}${attrs}>`;
    },
  );
  for (const [, rawTag, rawAttrs] of bodiless.matchAll(TAG)) {
    const tag = rawTag!.toLowerCase();
    const attrs = attributes(rawAttrs!);
    for (const name of attrs.keys())
      if (/^on[a-z]+$/u.test(name)) problems.push(`an inline ${name} handler on <${tag}>`);
    for (const [name, value] of attrs)
      if (['href', 'src', 'action', 'formaction'].includes(name) && /^\s*javascript:/iu.test(value))
        problems.push(`a javascript: URL on <${tag}>`);
    if (['iframe', 'frame', 'object', 'embed'].includes(tag)) problems.push(`an <${tag}>`);
    for (const url of [
      ...(attrs.get('srcset') ?? '').split(',').map((item) => item.trim().split(/\s+/u)[0] ?? ''),
      attrs.get('poster') ?? '',
    ])
      if (offOrigin(url)) problems.push(`<${tag}> loading ${url.trim().slice(0, 80)} from another origin`);
    const load = LOADS[tag];
    const url = load && attrs.get(load);
    if (!url || !offOrigin(url)) continue;
    if (tag === 'link' && !LOADING_LINKS.test(attrs.get('rel') ?? '')) continue;
    if (tag === 'input' && (attrs.get('type') ?? '').toLowerCase() !== 'image') continue;
    problems.push(`<${tag}> loading ${url.trim().slice(0, 80)} from another origin`);
  }
  return [...new Set(problems)];
}

/** Off-origin `@import` and `url()` loads (fonts, images, stylesheets) in a stylesheet. */
export function cspProblemsInCss(css: string): string[] {
  const problems: string[] = [];
  const text = css.replace(/\/\*[\s\S]*?\*\//gu, '');
  for (const [, url] of text.matchAll(/(?:url\(\s*["']?|@import\s+["'])([^"')\s]+)/giu))
    if (offOrigin(url!)) problems.push(`a stylesheet load of ${url!.slice(0, 80)} from another origin`);
  return [...new Set(problems)];
}

function distFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return distFiles(path);
    return entry.isFile() && /\.(?:html?|css)$/iu.test(entry.name) ? [path] : [];
  });
}

/**
 * Every HTML page and stylesheet in a built game, checked against the games host's CSP. Loads made from scripts are
 * left to the capture gates, which run the build under the same CSP.
 */
export function checkDistCsp(dist: string): string[] {
  return distFiles(dist).flatMap((file) =>
    (/\.css$/iu.test(file) ? cspProblemsInCss : cspProblemsInHtml)(readFileSync(file, 'utf8')).map(
      (problem) =>
        `dist/${relative(dist, file).split('\\').join('/')} has ${problem}, which the games host's CSP blocks`,
    ),
  );
}

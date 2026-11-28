import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { renderRedirects } from '../tools/redirects.mjs';

/* dist/ is written by tools/build.mts in the pretest step; nothing here touches the network */
const distDir = fileURLToPath(new URL('../dist', import.meta.url));
const repositoryRoot = fileURLToPath(new URL('../../..', import.meta.url));

const allowedHosts = new Set([
  'github.com',
  'aiur.team',
  'tailscale.com',
  'netlify.com',
  'console.cloud.google.com',
  'khala.aiur.team',
  'fonts.googleapis.com',
  'fonts.gstatic.com',
]);
const siteHost = 'site.invalid';
const redirectedPaths = new Set(
  renderRedirects('https://app.example')
    .split('\n')
    .map((line) => line.split(/\s+/)[0]!)
    .filter((path) => path && !path.includes('*')),
);
const repoBlob = /^\/its-everdred\/open-game-maker-2000\/blob\/[^/]+\/(.+)$/;

function htmlFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return htmlFiles(path);
    return path.endsWith('.html') ? [path] : [];
  });
}

function references(html: string): string[] {
  const urls: string[] = [];
  for (const [, attribute, value] of html.matchAll(/\s(href|src|srcset|poster)="([^"]*)"/g)) {
    const decoded = value!.replaceAll('&amp;', '&');
    if (attribute === 'srcset') urls.push(...decoded.split(',').map((entry) => entry.trim().split(/\s+/)[0]!));
    else urls.push(decoded);
  }
  return urls;
}

function servedFile(dist: string, pathname: string): string | undefined {
  const path = decodeURIComponent(pathname);
  return [join(dist, path), join(dist, path, 'index.html'), join(dist, `${path}.html`)].find(
    (candidate) => existsSync(candidate) && statSync(candidate).isFile(),
  );
}

/* returns why `reference` on the page at `pagePath` (a path under dist/) is broken, or undefined if it resolves */
function brokenLink(reference: string, pagePath: string, dist: string, checkout: string): string | undefined {
  const url = new URL(reference, `https://${siteHost}/${pagePath}`);
  if (url.host === siteHost)
    return servedFile(dist, url.pathname) || redirectedPaths.has(url.pathname) ? undefined : 'no file in dist/';
  if (url.protocol !== 'https:') return `scheme ${url.protocol}`;
  if (!allowedHosts.has(url.host)) return `host ${url.host} is not allow-listed`;
  const blob = url.host === 'github.com' ? repoBlob.exec(url.pathname) : null;
  if (blob && !existsSync(join(checkout, decodeURIComponent(blob[1]!)))) return 'no such file in the checkout';
  return undefined;
}

function brokenLinks(dist: string, checkout: string): string[] {
  return htmlFiles(dist).flatMap((file) => {
    const pagePath = relative(dist, file);
    return references(readFileSync(file, 'utf8')).flatMap((reference) => {
      const reason = brokenLink(reference, pagePath, dist, checkout);
      return reason ? [`${pagePath}: ${reference} (${reason})`] : [];
    });
  });
}

describe('link check', () => {
  it('finds links in every built page', () => {
    const pages = htmlFiles(distDir).map((file) => relative(distDir, file));
    expect(pages).toEqual(expect.arrayContaining(['index.html', join('setup', 'index.html')]));
    for (const file of htmlFiles(distDir)) expect(references(readFileSync(file, 'utf8')).length).toBeGreaterThan(0);
  });

  it('resolves every href and src in dist/ to a built file, a checkout file or an allow-listed host', () => {
    expect(brokenLinks(distDir, repositoryRoot)).toEqual([]);
  });

  it('reports a missing internal file, a missing repo file and a host off the allow-list', () => {
    const page = 'setup/index.html';
    const blob = 'https://github.com/its-everdred/open-game-maker-2000/blob/main';
    expect(brokenLink('/missing.css', page, distDir, repositoryRoot)).toBe('no file in dist/');
    expect(brokenLink('../nope.js', page, distDir, repositoryRoot)).toBe('no file in dist/');
    expect(brokenLink(`${blob}/no/such/file.md`, page, distDir, repositoryRoot)).toBe('no such file in the checkout');
    expect(brokenLink('https://example.com/', page, distDir, repositoryRoot)).toBe(
      'host example.com is not allow-listed',
    );
    expect(brokenLink('http://github.com/', page, distDir, repositoryRoot)).toBe('scheme http:');
    expect(brokenLink(`${blob}/SETUP.md`, page, distDir, repositoryRoot)).toBeUndefined();
    expect(brokenLink('/setup', 'index.html', distDir, repositoryRoot)).toBeUndefined();
    expect(brokenLink('/site.css', page, distDir, repositoryRoot)).toBeUndefined();
  });
});

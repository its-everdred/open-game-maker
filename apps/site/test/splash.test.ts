import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { renderSplashHtml } from '../src/render/html.js';
import { loadSplashContent, parseSplashContent } from '../src/splash.js';

const splashPath = fileURLToPath(new URL('../content/splash.yaml', import.meta.url));
const publicDir = fileURLToPath(new URL('../public', import.meta.url));
const content = loadSplashContent(splashPath);
const html = renderSplashHtml(content);

function count(pattern: RegExp): number {
  return html.match(pattern)?.length ?? 0;
}

function visibleText(markup: string): string[] {
  return markup
    .replace(/<head>[\s\S]*<\/head>/, '')
    .replace(/<svg[\s\S]*?<\/svg>/g, '')
    .split(/<[^>]+>/)
    .map((text) => text.trim())
    .filter(Boolean);
}

describe('splash page', () => {
  it('renders one heading, the line once and both CTAs from splash.yaml', () => {
    expect(count(/<h1[\s>]/g)).toBe(1);
    expect(html.split(content.line)).toHaveLength(2);
    expect(html).toContain(`<a class="s-cta" href="/setup">${content.cta.setup}</a>`);
    expect(html).toContain(`<a class="s-cta" href="/signin">${content.cta.sign_in}</a>`);
  });

  it('renders three muted looping inline videos whose clips and posters are committed', () => {
    const videos = html.match(/<video [^>]*>/g) ?? [];
    expect(videos).toHaveLength(3);
    for (const [index, video] of videos.entries()) {
      const capture = content.captures[index]!;
      expect(video).toContain(`src="${capture.path}"`);
      expect(video).toContain(`poster="${capture.poster}"`);
      expect(video).toMatch(/\bmuted\b.*\bloop\b.*\bplaysinline\b/);
      expect(existsSync(`${publicDir}${capture.path}`)).toBe(true);
      expect(existsSync(`${publicDir}${capture.poster}`)).toBe(true);
    }
    for (const asset of ['logo.webp', 'poster-landscape.webp', 'poster-portrait.webp']) {
      expect(existsSync(`${publicDir}/hero/${asset}`)).toBe(true);
    }
  });

  it('shows the invite-only request access note with the existing content', () => {
    expect(visibleText(html)).toEqual([
      content.line,
      content.cta.setup,
      content.cta.sign_in,
      'Invite only. Request access.',
      ...content.captures.map((capture) => capture.heading),
      content.footer.licence,
    ]);
    expect(html).toContain('aria-label="Source on GitHub"');
  });

  it('names no host of this machine, so a self-hoster only edits splash.yaml', () => {
    expect(html).not.toMatch(/\.tail[0-9a-f]+\.ts\.net|\/home\/[a-z]/);
    expect(readFileSync(splashPath, 'utf8')).not.toMatch(/\.tail[0-9a-f]+\.ts\.net|\/home\/[a-z]/);
  });

  it('escapes content so YAML text cannot inject markup', () => {
    const rendered = renderSplashHtml({ ...content, line: '<script>x</script> & "q"' });
    expect(rendered).toContain('&lt;script&gt;x&lt;/script&gt; &amp; &quot;q&quot;');
    expect(rendered).not.toContain('<script>x');
  });

  it('rejects content that breaks the schema', () => {
    const valid = readFileSync(splashPath, 'utf8');
    expect(() => parseSplashContent(`app_origin: https://app.example\n${valid}`)).toThrow();
    expect(() =>
      parseSplashContent(valid.replace(/  - heading: Play on a phone[\s\S]*?poster: [^\n]+\n/, '')),
    ).toThrow();
    expect(() => parseSplashContent(`${valid}\ntagline: more words\n`)).toThrow();
    expect(() => parseSplashContent(valid.replace('path: /captures/play.mp4', 'path: /../../SETUP.md'))).toThrow();
  });
});

describe('splash media URLs', () => {
  it('routes every media URL through the asset mapper so the build can cache-bust immutable files', () => {
    const rendered = renderSplashHtml(content, (path) => `${path}?v=test`);
    const media = [
      '/hero/logo.webp',
      '/hero/poster-landscape.webp',
      '/hero/poster-portrait.webp',
      ...content.captures.flatMap((capture) => [capture.path, capture.poster]),
    ];
    for (const path of media) {
      expect(rendered).toContain(`"${path}?v=test"`);
      expect(rendered).not.toContain(`"${path}"`);
    }
  });
});

describe('built splash (dist/index.html, written by the pretest build)', () => {
  const distDir = fileURLToPath(new URL('../dist', import.meta.url));
  const built = readFileSync(`${distDir}/index.html`, 'utf8');

  it('ships every media file and keys its URL to the file bytes, so a re-recorded clip escapes the immutable cache', () => {
    const urls = [...built.matchAll(/(?:src|poster|srcset)="(\/(?:hero|captures)\/[^"?]+)\?v=([0-9a-f]{10})"/g)];
    expect(urls).toHaveLength(9);
    for (const [, path, version] of urls) {
      const bytes = readFileSync(`${distDir}${path!}`);
      expect(bytes.equals(readFileSync(`${publicDir}${path!}`))).toBe(true);
      expect(version).toBe(createHash('sha256').update(bytes).digest('hex').slice(0, 10));
    }
    expect(existsSync(`${distDir}/_headers`)).toBe(true);
    expect(built).not.toMatch(/\.tail[0-9a-f]+\.ts\.net|\/home\/[a-z]/);
  });
});

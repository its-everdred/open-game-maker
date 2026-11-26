import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';

const dist = fileURLToPath(new URL('../dist/', import.meta.url));
const page = new JSDOM(readFileSync(`${dist}/index.html`, 'utf8')).window.document;

describe('factory landing page', () => {
  it('presents the approved headline and the creation story', () => {
    expect(page.querySelector('h1')?.textContent).toBe('Game Factory that Supports Humans');
    expect([...page.querySelectorAll('main section[id] h2')].map((heading) => heading.textContent)).toEqual([
      'Create a game',
      'Software factory',
      'Get your hands dirty',
      'Continuous review',
      'Support every device',
    ]);
    expect(page.body.textContent).not.toMatch(/\bpacks\b/i);
    expect(page.body.textContent).toContain('Curated tools.');
  });

  it('versions the immutable logo URL with the shipped file bytes', () => {
    const logo = readFileSync(`${dist}/hero/logo.webp`);
    const version = createHash('sha256').update(logo).digest('hex').slice(0, 10);
    expect(page.querySelector('nav img')?.getAttribute('src')).toBe(`/hero/logo.webp?v=${version}`);
  });

  it('preserves both destinations and marks the unfinished recording', () => {
    expect(page.querySelector('a[href="/setup"]')).not.toBeNull();
    expect(page.querySelector('a[href="/signin"]')).not.toBeNull();
    expect(page.body.textContent).toContain('Mobile editor loop pending');
  });
});

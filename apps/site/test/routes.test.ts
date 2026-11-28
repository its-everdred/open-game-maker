import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import { loadSetupContent } from '../src/schema.js';

/* dist/ is written by tools/build.mts in the pretest step */
const distDir = fileURLToPath(new URL('../dist', import.meta.url));
const repositoryRoot = fileURLToPath(new URL('../../..', import.meta.url));
const setup = loadSetupContent(fileURLToPath(new URL('../content/setup.yaml', import.meta.url)), repositoryRoot);

function page(path: string): Document {
  return new JSDOM(readFileSync(`${distDir}/${path}`, 'utf8')).window.document;
}

describe('built routes', () => {
  it.each(['index.html', 'setup/index.html'])('%s exists with one <h1> and a <title>', (path) => {
    expect(existsSync(`${distDir}/${path}`)).toBe(true);
    const doc = page(path);
    expect(doc.querySelectorAll('h1')).toHaveLength(1);
    expect(doc.title.trim()).not.toBe('');
  });

  it('links visitors to the app and self-hosting guide', () => {
    const links = [...page('index.html').querySelectorAll('a')].map((a) => a.getAttribute('href'));
    expect(links).toContain('/setup');
    expect(links).toContain('/signin');
  });

  it('ships discoverable agent introductions alongside the built homepage', () => {
    const agentGuide = readFileSync(`${distDir}/AGENTS.md`, 'utf8');
    const discovery = readFileSync(`${distDir}/llms.txt`, 'utf8');
    expect(agentGuide).toBe(readFileSync(fileURLToPath(new URL('../public/AGENTS.md', import.meta.url)), 'utf8'));
    expect(discovery).toBe(readFileSync(fileURLToPath(new URL('../public/llms.txt', import.meta.url)), 'utf8'));
    expect(agentGuide).toContain('invite-only');
    expect(agentGuide).toContain('[homepage](/)');
    expect(discovery).toContain('[Agent overview](/AGENTS.md)');
    expect(discovery).toContain('[Setup guide](/setup)');
  });

  it('renders the eight setup headers in order', () => {
    const headers = [...page('setup/index.html').querySelectorAll('h2 > button')].map((button) => [
      button.querySelector('.num')?.textContent,
      button.querySelector('.title')?.textContent,
    ]);
    expect(headers).toEqual(setup.steps.map((step) => [String(step.id), step.title]));
    expect(headers).toHaveLength(8);
  });
});

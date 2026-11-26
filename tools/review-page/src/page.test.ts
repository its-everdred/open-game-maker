import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { expect, it, vi } from 'vitest';
import { renderPage } from './build.js';
import type { Card } from './cards.js';

it('keeps partial group answers open until every group is answered', async () => {
  const card: Card = {
    key: 'multi',
    repo: 'core',
    ticket: 1,
    decision: '',
    title: 'Review',
    at: '',
    mode: 'multi',
    shared: [],
    options: [],
    groups: ['a', 'b'].map((id) => ({ id, label: id, media: [], options: [{ id: 'yes', label: 'Yes', media: [] }] })),
  };
  const page = renderPage(readFileSync(new URL('./page.html', import.meta.url), 'utf8'), [card]);
  let saved: Record<string, unknown> | undefined;
  const open = () =>
    new JSDOM(page, {
      runScripts: 'dangerously',
      beforeParse(window) {
        Object.assign(window, {
          claude: {
            use: async () => ({
              doc: () => ({
                get: async () => ({ exists: !!saved, data: () => saved }),
                set: async (value: Record<string, unknown>) => {
                  saved = value;
                },
              }),
            }),
          },
        });
      },
    });
  const first = open();
  await new Promise((resolve) => setTimeout(resolve, 0));
  first.window.document.querySelector<HTMLButtonElement>('button[data-g="a"]')!.click();
  await vi.waitFor(() => expect(saved).toBeDefined());
  expect(first.window.document.querySelector('.card')?.classList.contains('shut')).toBe(false);
  first.window.close();
  const second = open();
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(second.window.document.querySelector('.card')?.classList.contains('shut')).toBe(false);
  second.window.document.querySelector<HTMLButtonElement>('button[data-g="b"]')!.click();
  expect(second.window.document.querySelector('.card')?.classList.contains('shut')).toBe(true);
  second.window.close();
}, 30_000);

it('collapses an answered card immediately and restores the answered row on load', async () => {
  const card: Card = {
    key: 'dec_a',
    repo: 'core',
    ticket: 1,
    decision: 'dec_a',
    title: 'Review',
    at: '',
    mode: 'review',
    shared: [],
    options: [{ id: 'yes', label: 'Yes', media: [] }],
  };
  const template = readFileSync(new URL('./page.html', import.meta.url), 'utf8');
  const page = renderPage(template, [card]);
  let saved: Record<string, unknown> | undefined;
  const open = (html = page) =>
    new JSDOM(html, {
      runScripts: 'dangerously',
      beforeParse(window) {
        Object.assign(window, {
          claude: {
            use: async () => ({
              doc: () => ({
                get: async () => ({ exists: !!saved, data: () => saved }),
                set: async (value: Record<string, unknown>) => {
                  saved = value;
                },
              }),
            }),
          },
        });
      },
    });
  const first = open();
  await vi.waitFor(() => expect(first.window.document.querySelector('button')).not.toBeNull());
  await new Promise((resolve) => setTimeout(resolve, 0));
  first.window.document.querySelector('button')!.click();
  await vi.waitFor(() => expect(first.window.document.querySelector('.card')?.classList.contains('shut')).toBe(true));
  expect(first.window.document.querySelector('.st')?.textContent).toBe('Answered ✓ · Yes');
  first.window.close();
  const second = open();
  await vi.waitFor(() => expect(second.window.document.querySelector('.card')?.classList.contains('shut')).toBe(true));
  expect(second.window.document.querySelector('.st')?.textContent).toBe('Answered ✓ · Yes');
  second.window.close();
  const reissued = open(renderPage(template, [{ ...card, ignoreSavedBefore: saved?.at as number }]));
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(reissued.window.document.querySelector('.card')?.classList.contains('shut')).toBe(false);
  reissued.window.close();
}, 30_000);

it('collapses before the save completes and reopens if it fails', async () => {
  const card: Card = {
    key: 'dec_a',
    repo: 'core',
    ticket: 1,
    decision: 'dec_a',
    title: 'Review',
    at: '',
    mode: 'review',
    shared: [],
    options: [{ id: 'yes', label: 'Yes', media: [] }],
  };
  const page = renderPage(readFileSync(new URL('./page.html', import.meta.url), 'utf8'), [card]);
  let rejectSave!: (error: Error) => void;
  const pending = new Promise<void>((_, reject) => {
    rejectSave = reject;
  });
  const dom = new JSDOM(page, {
    runScripts: 'dangerously',
    beforeParse(window) {
      Object.assign(window, {
        claude: { use: async () => ({ doc: () => ({ get: async () => ({ exists: false }), set: () => pending }) }) },
      });
    },
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  dom.window.document.querySelector('button')!.click();
  expect(dom.window.document.querySelector('.card')?.classList.contains('shut')).toBe(true);
  expect(dom.window.document.querySelector('.st')?.textContent).toBe('Answered ✓ · Yes');
  rejectSave(new Error('offline'));
  await vi.waitFor(() => expect(dom.window.document.querySelector('.card')?.classList.contains('shut')).toBe(false));
  expect(dom.window.document.querySelector('.st')?.textContent).toBe('Not saved');
  dom.window.close();
}, 30_000);

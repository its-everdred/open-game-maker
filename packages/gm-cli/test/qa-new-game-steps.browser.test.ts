import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newGameSteps, type CreatedGame } from '../src/qa-new-game-steps.js';

type Browser = Awaited<ReturnType<(typeof import('@ogm/gm-verify'))['launch']>>;
let browser: Browser;

// A small interactive boundary fixture exercises actual browser clicks, response capture, two turns and redirect.
const html = `<!doctype html><html><body><main id="root"></main><script>
const root = document.querySelector('#root');
const button = (text, action) => { const b = document.createElement('button'); b.textContent = text; b.onclick = action; root.append(b); return b; };
function screen(title) { root.replaceChildren(); const h = document.createElement('h1'); h.textContent = title; root.append(h); }
function pick(title, choice, next) { screen(title); button(choice, () => { button('Next', next); }); }
function talk() {
  screen('Talk it through');
  const builder = document.createElement('section'); builder.setAttribute('aria-label', 'Builder');
  const caption = document.createElement('div'); caption.className = 'caption'; builder.append(caption); root.append(builder);
  const form = document.createElement('div'); form.className = 'build-chat-composer'; const text = document.createElement('textarea'); form.append(text); root.append(form);
  let count = 0; const finish = button('Finish', async () => { await fetch('/api/v1/jobs', { method: 'POST' }); location.href = '/all?spotlight=g_123'; }); finish.disabled = true;
  let recommended = false;
  button('Send', () => { if (!text.value) return; const value = text.value; const line = document.createElement('p'); line.className = 'line'; line.textContent = count === 0 ? 'I recommend a small forest game.' : 'Scope agreed.'; caption.append(line); text.value = ''; count++; if (count === 1 && /recommend/i.test(value)) recommended = true; if (count === 2 && recommended && /agree/i.test(value)) finish.disabled = false; });
}
function players() { pick('Players', 'Solo', async () => { const r = await fetch('/api/v1/games', { method: 'POST' }); if (r.ok) talk(); else { screen('Talk it through'); button('Try again', () => {}); } }); }
function world() { pick('World', 'Forest', players); }
function art() { screen('Art'); button('Pixel art', () => { screen('Art'); button('Kenney 1-Bit', () => { screen('Art'); button('Select Kenney 1-Bit', () => { screen('Art'); button('Next', world); }); }); }); }
function vibe() { pick('Vibe', 'Cozy', art); }
function genre() { pick('Genre', 'Adventure', vibe); }
if (location.search) { root.innerHTML = '<div data-game-id="g_123"><p class="games-spotlight-job">Building</p></div>'; }
else { button('New game', genre); }
</script></body></html>`;

beforeAll(async () => {
  browser = await (await import('@ogm/gm-verify')).launch(true);
}, 60_000);
afterAll(async () => {
  await browser?.close();
});

async function journey(status: number) {
  const server = createServer((request, response) => {
    const path = new URL(request.url ?? '/', 'http://127.0.0.1').pathname;
    if (path === '/api/v1/games') {
      response.writeHead(status, { 'content-type': 'application/json' });
      response.end(JSON.stringify(status === 201 ? { id: 'g_123' } : { details: { gameId: 'g_123' } }));
    } else if (path === '/api/v1/jobs') {
      response.writeHead(201, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ jobId: 'j_123' }));
    } else {
      response.writeHead(200, { 'content-type': 'text/html' });
      response.end(html);
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  try {
    const page = await context.newPage();
    const stills: string[] = [];
    const created: CreatedGame[] = [];
    const result = newGameSteps(
      page,
      origin,
      async (name) => {
        stills.push(name);
      },
      (game) => {
        created.push(game);
      },
    );
    return {
      result: await result.then(
        (value) => ({ value }),
        (error: Error) => ({ error: error.message }),
      ),
      stills,
      created,
    };
  } finally {
    await context.close();
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
}

describe('New Game browser steps', () => {
  it('finishes after two builder replies and records the choice screens', async () => {
    const result = await journey(201);
    expect(result.result).toMatchObject({ value: { gameId: 'g_123', requestId: 'j_123' } });
    expect('value' in result.result ? result.result.value.finishedAt : undefined).toEqual(expect.any(Number));
    expect(result.created).toEqual([{ id: 'g_123', status: 201, ok: true }]);
    expect(result.stills).toContain('conversation');
    expect(result.stills).toContain('library');
  });
  it('retains the game ID when provisioning returns 502', async () => {
    const result = await journey(502);
    expect(result.result).toEqual({ error: 'game creation returned 502' });
    expect(result.created).toEqual([{ id: 'g_123', status: 502, ok: false }]);
  });
});
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

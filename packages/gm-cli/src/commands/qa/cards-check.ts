import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, relative, resolve } from 'node:path';

import { EXIT, UsageError, type GmCommand } from '../../command.js';
import { printJson } from '../../context.js';
import {
  cardFailures,
  cardList,
  expectedParts,
  probeCardPart,
  staleCards,
  type CardPart,
} from '../../qa-cards-check.js';
import { matchesConfiguredOrigin } from '../../qa-games-cache.js';
import { readEnvFile } from '../publish/index.js';

/*
 * 2026-11-23: on Kevin's iPhone the games list showed each card's logo, then blanked it (#1312). This opens the
 * production list in WebKit at 390x844 with the given cards and checks every thumbnail and logo shows and stays.
 */
export const command: GmCommand = {
  name: 'qa cards-check',
  summary: 'show the games list in WebKit at 390x844; every card thumbnail and logo must load and stay visible',
  usage: '[<cards.json>] --app <app origin> --out <dir> [--hold 5] [--load 30]',
  example: 'qa cards-check --app https://app.example --out assets-local/review/app/cards-check',
  flags: {
    app: { type: 'string', help: 'the app origin' },
    out: { type: 'string', help: 'cards-check.json and a still of the list' },
    hold: { type: 'number', default: 5, help: 'seconds each card must keep its art' },
    load: { type: 'number', default: 30, help: 'seconds a card may take to show its art' },
  },
  async run(ctx, args, flags) {
    if (args.length > 1) throw new UsageError('at most one cards file', 'gm help qa cards-check');
    const app = typeof flags.app === 'string' ? flags.app.replace(/\/$/u, '') : '';
    if (!URL.canParse(app) || !/^https?:$/u.test(new URL(app).protocol))
      throw new UsageError('--app must be an http(s) origin', 'gm help qa cards-check');
    if (typeof flags.out !== 'string') throw new UsageError('--out is required', 'gm help qa cards-check');
    const holdMs = (flags.hold as number) * 1000;
    const loadMs = (flags.load as number) * 1000;
    if (!(holdMs > 0 && loadMs > 0))
      throw new UsageError('--hold and --load must be positive', 'gm help qa cards-check');
    const envDir = ctx.env?.OGM_ENV_DIR || join(ctx.home ?? homedir(), '.config', 'ogm', 'env');
    const api = readEnvFile(join(envDir, 'api.env'));
    // The QA session cookie goes only to the configured app.
    if (!matchesConfiguredOrigin(app, api.OGM_APP_ORIGIN))
      throw new UsageError('--app must match OGM_APP_ORIGIN in api.env', 'gm help qa cards-check');
    // Without a file, every game's real card comes from the host's API (the internal QA route).
    let body: string;
    if (args[0]) body = readFileSync(resolve(ctx.cwd, args[0]), 'utf8');
    else {
      if (!(api.OGM_INTERNAL_TOKEN && api.OGM_API_PORT)) {
        ctx.err(`qa cards-check: OGM_INTERNAL_TOKEN and OGM_API_PORT must be set in ${envDir}/api.env`);
        return EXIT.failed;
      }
      const response = await fetch(`http://127.0.0.1:${api.OGM_API_PORT}/internal/qa/cards`, {
        headers: { 'x-ogm-internal': api.OGM_INTERNAL_TOKEN },
        signal: AbortSignal.timeout(30_000),
      });
      if (!response.ok) {
        ctx.err(`qa cards-check: the API answered ${response.status} for the cards`);
        return EXIT.failed;
      }
      body = await response.text();
    }
    const games = cardList(JSON.parse(body) as unknown);
    const expected = expectedParts(games);
    const qa = readEnvFile(join(envDir, 'qa.env'));
    if (!(qa.OGM_QA_SESSION_COOKIE_NAME && qa.OGM_QA_SESSION_COOKIE)) {
      ctx.err(`qa cards-check: missing the QA session in ${envDir}/qa.env; run ops/bin/ogm-qa-session`);
      return EXIT.failed;
    }
    const out = resolve(ctx.cwd, flags.out);
    mkdirSync(out, { recursive: true });

    const verify = await import('@ogm/gm-verify');
    const browser = await verify.launchWebkit();
    const parts: CardPart[] = [];
    const errors: string[] = [];
    try {
      const context = await browser.newContext({
        viewport: { width: 390, height: 844 },
        deviceScaleFactor: 3,
        isMobile: true,
        hasTouch: true,
        serviceWorkers: 'block',
      });
      await context.addCookies([{ name: qa.OGM_QA_SESSION_COOKIE_NAME, value: qa.OGM_QA_SESSION_COOKIE, url: app }]);
      const page = await context.newPage();
      page.on('pageerror', (error) => errors.push(error.message.slice(0, 300)));
      // The QA account owns no creator's games: its list shows the given cards instead. The first visit lists them
      // as cached before their variants existed; the reload then shows that cached list until the live one arrives.
      let served = JSON.stringify(staleCards(games));
      let held: Promise<void> = Promise.resolve();
      let release = () => {};
      await page.route(`${app}/api/v1/games`, async (route) => {
        if (route.request().method() !== 'GET') return route.continue();
        await held;
        return route.fulfill({ status: 200, contentType: 'application/json', body: served });
      });
      const shown = (gameId: string, part: 'cover' | 'logo') =>
        page.evaluate(probeCardPart, [gameId, part] as [string, 'cover' | 'logo']);
      await page.goto(`${app}/all`, { timeout: loadMs });
      await page.waitForSelector('[data-game-id]', { timeout: loadMs }).catch(() => undefined);
      for (const { gameId, part } of expected) {
        await page
          .locator(`[data-game-id="${gameId}"]`)
          .scrollIntoViewIfNeeded({ timeout: 5_000 })
          .catch(() => undefined);
        for (const end = Date.now() + 10_000; Date.now() < end; await page.waitForTimeout(200))
          if ((await shown(gameId, part)) === 'shown') break;
      }
      // Revisit: the cached cards show first; the live list is held until the first screen's cached art is on screen.
      served = body;
      held = new Promise((done) => (release = done));
      await page.reload({ timeout: loadMs });
      await page.waitForSelector('[data-game-id]', { timeout: loadMs }).catch(() => undefined);
      // The first screen's cards, once their cached art shows, must keep showing art from the moment the live list lands.
      let first: CardPart[] = [];
      for (const end = Date.now() + loadMs; Date.now() < end; await page.waitForTimeout(200)) {
        first = [];
        for (const item of expected) {
          const box = await page.locator(`[data-game-id="${item.gameId}"]`).boundingBox();
          if (box && box.y < 844 && box.y + box.height > 0)
            first.push({ ...item, shownAt: null, lostAt: null, state: await shown(item.gameId, item.part) });
        }
        if (first.every((part) => part.state === 'shown')) break;
      }
      // From here each new image takes as long as a phone on 4G, so a card that blanks while art changes shows it.
      await page.route('**/*', async (route) =>
        route.request().resourceType() === 'image'
          ? new Promise<void>((done) => setTimeout(done, 2_000)).then(() => route.fallback())
          : route.fallback(),
      );
      release();
      const released = Date.now();
      for (const part of first) if (part.state === 'shown') part.shownAt = 0;
      parts.push(...first);
      while (Date.now() - released < loadMs + holdMs) {
        const now = Date.now() - released;
        for (const part of first) {
          const state = await shown(part.gameId, part.part);
          if (part.lostAt === null) part.state = state;
          if (state === 'shown') part.shownAt ??= now;
          else if (part.shownAt !== null) part.lostAt ??= now - part.shownAt;
        }
        if (first.some((part) => part.shownAt === null) && now > loadMs) break;
        if (first.every((part) => part.shownAt !== null && now - part.shownAt >= holdMs)) break;
        await page.waitForTimeout(100);
      }
      // Then every other card, scrolled into view one at a time: its art has to show, then stay for the hold.
      const checked = new Set(first.map((part) => `${part.gameId} ${part.part}`));
      for (const gameId of [...new Set(expected.map((part) => part.gameId))]) {
        const mine = expected
          .filter((part) => part.gameId === gameId && !checked.has(`${part.gameId} ${part.part}`))
          .map((part): CardPart => ({ ...part, shownAt: null, lostAt: null, state: 'missing' }));
        if (!mine.length) continue;
        parts.push(...mine);
        await page
          .locator(`[data-game-id="${gameId}"]`)
          .scrollIntoViewIfNeeded({ timeout: 5_000 })
          .catch(() => undefined);
        const start = Date.now();
        while (Date.now() - start < loadMs + holdMs) {
          const now = Date.now() - start;
          for (const part of mine) {
            const state = await shown(gameId, part.part);
            if (part.lostAt === null) part.state = state;
            if (state === 'shown') part.shownAt ??= now;
            else if (part.shownAt !== null) part.lostAt ??= now - part.shownAt;
          }
          if (mine.some((part) => part.shownAt === null) && now > loadMs) break;
          if (mine.every((part) => part.shownAt !== null && now - part.shownAt >= holdMs)) break;
          await page.waitForTimeout(100);
        }
      }
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({ path: join(out, 'cards.png'), timeout: 60_000 }).catch(() => undefined);
    } finally {
      await browser.close();
    }
    const failures = cardFailures(parts, loadMs, games.length);
    writeFileSync(
      join(out, 'cards-check.json'),
      `${JSON.stringify({ viewport: '390x844', failures, parts, errors }, null, 2)}\n`,
    );
    const shown = relative(ctx.cwd, out) || '.';
    if (ctx.json) printJson(ctx, { verdict: failures.length ? 'fail' : 'pass', out: shown, failures });
    else {
      for (const line of failures) ctx.out(`fail: ${line}`);
      ctx.out(`${failures.length ? 'fail' : 'pass'}: ${parts.length} card images; report in ${shown}`);
    }
    return failures.length ? EXIT.failed : EXIT.ok;
  },
};

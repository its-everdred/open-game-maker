import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, relative, resolve } from 'node:path';

import { EXIT, UsageError, type GmCommand } from '../../command.js';
import { printJson } from '../../context.js';
import { cardFailures, expectedParts, probeCardPart, type CardPart } from '../../qa-cards-check.js';
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
    // Without a file, every game's real card comes from the host's API (the internal QA route).
    let body: string;
    if (args[0]) body = readFileSync(resolve(ctx.cwd, args[0]), 'utf8');
    else {
      const api = readEnvFile(join(envDir, 'api.env'));
      if (!(api.OGM_INTERNAL_TOKEN && api.OGM_API_PORT)) {
        ctx.err(`qa cards-check: OGM_INTERNAL_TOKEN and OGM_API_PORT must be set in ${envDir}/api.env`);
        return EXIT.failed;
      }
      const response = await fetch(`http://127.0.0.1:${api.OGM_API_PORT}/internal/qa/cards`, {
        headers: { 'x-ogm-internal': api.OGM_INTERNAL_TOKEN },
      });
      if (!response.ok) {
        ctx.err(`qa cards-check: the API answered ${response.status} for the cards`);
        return EXIT.failed;
      }
      body = await response.text();
    }
    const expected = expectedParts(JSON.parse(body) as unknown);
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
      // The QA account owns no creator's games: its list shows the given cards instead.
      await page.route(`${app}/api/v1/games`, (route) =>
        route.request().method() === 'GET'
          ? route.fulfill({ status: 200, contentType: 'application/json', body })
          : route.continue(),
      );
      await page.goto(`${app}/all`, { timeout: loadMs });
      await page.waitForSelector('[data-game-id]', { timeout: loadMs }).catch(() => undefined);
      for (const gameId of [...new Set(expected.map((part) => part.gameId))]) {
        const mine = expected
          .filter((part) => part.gameId === gameId)
          .map((part): CardPart => ({ ...part, shownAt: null, lostAt: null, state: 'missing' }));
        parts.push(...mine);
        await page
          .locator(`[data-game-id="${gameId}"]`)
          .scrollIntoViewIfNeeded({ timeout: 5_000 })
          .catch(() => undefined);
        const start = Date.now();
        // Each piece first has to show, then keep showing for the hold.
        while (Date.now() - start < loadMs + holdMs) {
          const now = Date.now() - start;
          for (const part of mine) {
            part.state = await page.evaluate(probeCardPart, [gameId, part.part] as [string, 'cover' | 'logo']);
            if (part.state === 'shown') part.shownAt ??= now;
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
    const failures = cardFailures(parts, loadMs);
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

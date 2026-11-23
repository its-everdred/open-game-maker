import { EXIT, UsageError, type GmCommand } from '../../command.js';
import { printJson } from '../../context.js';
import { frameFailures, observeFrame } from '../../qa-frame-check.js';

/*
 * 2026-11-23: the app also answered on its bare domain, which the games host's frame-ancestors did not list, and
 * iPhone Safari showed Try again in every game (#1297). This frames a game on every app domain in WebKit.
 */
export const command: GmCommand = {
  name: 'qa frame-check',
  summary: 'frame a game in WebKit on every app domain and fail on a refused frame',
  usage: '<game frame url> --app <origin> [--app <origin> ...] [--timeout 30]',
  example: 'qa frame-check https://games.example/g/g_123/build_456/ --app https://app.example --app https://example',
  flags: {
    app: { type: 'string', multiple: true, help: 'an app domain to open; repeat for each' },
    timeout: { type: 'number', default: 30, help: 'seconds per domain' },
  },
  async run(ctx, args, flags) {
    if (args.length !== 1) throw new UsageError('one game frame url is required', 'gm help qa frame-check');
    const frameUrl = args[0]!;
    const apps = (flags.app as string[] | undefined) ?? [];
    if (!apps.length) throw new UsageError('at least one --app is required', 'gm help qa frame-check');
    for (const url of [frameUrl, ...apps])
      if (!URL.canParse(url) || !/^https?:$/u.test(new URL(url).protocol))
        throw new UsageError(`not an http(s) url: ${url}`, 'gm help qa frame-check');
    const timeout = flags.timeout as number;
    if (!Number.isFinite(timeout) || timeout <= 0) throw new UsageError('invalid timeout', 'gm help qa frame-check');

    const verify = await import('@ogm/gm-verify');
    const browser = await verify.launchWebkit();
    const results = [];
    try {
      for (const app of apps) {
        const observation = await observeFrame(browser, app, frameUrl, timeout * 1000);
        results.push({ ...observation, failures: frameFailures(observation) });
      }
    } finally {
      await browser.close();
    }
    const failed = results.some((result) => result.failures.length);
    if (ctx.json) printJson(ctx, { verdict: failed ? 'fail' : 'pass', frame: frameUrl, results });
    else
      for (const { app, landed, failures } of results) {
        const via = landed && landed !== new URL(app).origin ? ` (via ${landed})` : '';
        ctx.out(failures.length ? `fail ${app}${via}: ${failures.join('; ')}` : `ok ${app}${via}`);
      }
    return failed ? EXIT.failed : EXIT.ok;
  },
};

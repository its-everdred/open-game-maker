#!/usr/bin/env node
import { run } from './cli.js';

process.exitCode = await run(process.argv.slice(2), {
  onTestTimeout: () => {
    // Exit even if a wedged Playwright transport keeps the executable alive.
    setTimeout(() => process.exit(1), 5_000).unref();
  },
});

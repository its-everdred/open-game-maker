#!/usr/bin/env node
// Print Netlify's _redirects for the deploy payload: send the old Netlify hostname and every alias domain to the
// configured public app origin, add API and auth proxies to VITE_API_ORIGIN, then the SPA fallback.
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

import { readApiOrigin, readAppAliasOrigins, readPublicAppOrigin } from './games-origin.mjs';

const RETIRED_APP_ORIGIN = 'https://ogm2000.netlify.app';

export function renderRedirects(apiOrigin, publicAppOrigin, aliasOrigins = []) {
  return [
    ...[RETIRED_APP_ORIGIN, ...aliasOrigins].map((origin) => `${origin}/*  ${publicAppOrigin}/:splat  301!`),
    `/api/*  ${apiOrigin}/api/:splat  200`,
    `/auth/*  ${apiOrigin}/auth/:splat  200`,
    '/proto  /proto/  301',
    '/proto/*  /proto/:splat  200',
    '/*  /index.html  200',
    '',
  ].join('\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const envDir = process.env.OGM_ENV_DIR || join(homedir(), '.config', 'ogm', 'env');
  try {
    process.stdout.write(
      renderRedirects(readApiOrigin(envDir), readPublicAppOrigin(envDir), readAppAliasOrigins(envDir)),
    );
  } catch (error) {
    process.stderr.write(`deploy: ${error.message}\n`);
    process.exit(1);
  }
}

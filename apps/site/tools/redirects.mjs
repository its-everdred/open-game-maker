#!/usr/bin/env node
// Print the marketing site's Netlify redirects. The try-it instance is deploy-time configuration, never site content.
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

import { readPublicAppOrigin } from '../../web/tools/games-origin.mjs';

export function renderRedirects(appOrigin) {
  return [
    `/games  ${appOrigin}/games  302!`,
    `/games/*  ${appOrigin}/games/:splat  302!`,
    `/new  ${appOrigin}/new  302!`,
    `/signin  ${appOrigin}/signin  302!`,
    `/auth/*  ${appOrigin}/auth/:splat  302!`,
    `/api/*  ${appOrigin}/api/:splat  302!`,
    `/docs  /docs/index.html  200`,
    `/:slug  ${appOrigin}/play/:slug  302`,
    '',
  ].join('\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const envDir = process.env.OGM_ENV_DIR || join(homedir(), '.config', 'ogm', 'env');
  try {
    process.stdout.write(renderRedirects(readPublicAppOrigin(envDir)));
  } catch (error) {
    process.stderr.write(`deploy: ${error.message}\n`);
    process.exit(1);
  }
}

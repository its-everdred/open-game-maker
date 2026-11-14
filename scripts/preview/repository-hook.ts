#!/usr/bin/env node
// Called by a repository daemon's trusted workspace hooks, outside the worker sandbox.
import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
  existsSync,
  linkSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';

const operation = process.argv[2];
if (operation !== 'create' && operation !== 'remove') throw new Error('expected create or remove');
const workspace = realpathSync(process.cwd());
const workspaceHash = createHash('sha256').update(workspace).digest('hex');
const repositoriesRoot = join(homedir(), '.config/ogm/preview-repos');
if (operation === 'remove') {
  for (const entry of (existsSync(repositoriesRoot)
    ? readdirSync(repositoriesRoot, { withFileTypes: true })
    : []
  ).filter((entry) => entry.isDirectory() && /^[0-9a-f]{64}$/u.test(entry.name))) {
    rmSync(join(repositoriesRoot, entry.name, 'grants', `${workspaceHash}.json`), { force: true });
  }
} else {
  const origin = (process.env.THIS_REPOSITORY_URL ?? '').trim();
  const match = /^(?:https:\/\/github\.com\/|git@github\.com:)([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+?)(?:\.git)?$/iu.exec(
    origin,
  );
  if (!match) throw new Error('unsupported repository origin');
  const repo = match[1].toLowerCase();
  const repoHash = createHash('sha256').update(repo).digest('hex');
  const root = join(repositoriesRoot, repoHash);
  const grantDir = join(root, 'grants');
  const grantPath = join(grantDir, `${workspaceHash}.json`);
  const ticket = process.env.AIUR_HOOK_TICKET_IDENTIFIER || basename(workspace);
  if (!/^[1-9]\d{0,15}$/u.test(ticket)) throw new Error('invalid ticket');
  const issue = JSON.parse(execFileSync('gh', ['api', `repos/${repo}/issues/${ticket}`], { encoding: 'utf8' })) as {
    state: string;
    labels: { name: string }[];
  };
  const games = issue.labels.map((label) => label.name).filter((name) => /^game:[A-Za-z0-9_-]{1,200}$/u.test(name));
  if (issue.state !== 'open' || games.length !== 1) throw new Error('ticket needs one game label and must be open');
  const game = games[0]!.slice(5);
  mkdirSync(grantDir, { recursive: true, mode: 0o700 });
  const secretPath = join(root, 'secret');
  const secretTemp = `${secretPath}.${randomUUID()}.tmp`;
  writeFileSync(secretTemp, randomBytes(32).toString('base64url'), { mode: 0o600, flag: 'wx' });
  try {
    linkSync(secretTemp, secretPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
  } finally {
    rmSync(secretTemp, { force: true });
  }
  const secret = readFileSync(secretPath, 'utf8').trim();
  if (!secret) throw new Error('empty preview secret');
  const grant = randomUUID();
  const temp = `${grantPath}.${randomUUID()}.tmp`;
  writeFileSync(temp, JSON.stringify({ repo, ticket, game, grant, workspace }), { mode: 0o600, flag: 'wx' });
  renameSync(temp, grantPath);
  for (const name of ['.gm', '.gm/context']) {
    const path = join(workspace, name);
    if (!existsSync(path)) mkdirSync(path, { mode: 0o700 });
    if (realpathSync(path) !== path) throw new Error('unsafe workspace context');
  }
  const payload = Buffer.from(
    JSON.stringify({ ticket, game, grant, expires: Date.now() + 2 * 60 * 60 * 1000 }),
  ).toString('base64url');
  const signature = createHmac('sha256', secret).update(`preview:${payload}`).digest('base64url');
  const context = join(workspace, '.gm/context');
  const contextTemp = join(context, `.preview-${randomUUID()}.tmp`);
  writeFileSync(contextTemp, JSON.stringify({ token: `${payload}.${signature}` }), { mode: 0o600, flag: 'wx' });
  renameSync(contextTemp, join(context, 'preview.json'));
}

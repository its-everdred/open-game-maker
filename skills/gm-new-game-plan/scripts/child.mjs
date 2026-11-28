#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import process from 'node:process';
import { setTimeout } from 'node:timers';
import { plannerRelay } from './relay.mjs';

const [ticket, slug, file] = process.argv.slice(2);
if (!file) throw new Error('usage: node child.mjs <planner-ticket> <game-slug> <child.json>');
const relay = plannerRelay(ticket, slug);
const child = JSON.parse(readFileSync(file, 'utf8'));
const plannerBranch = execFileSync('git', ['symbolic-ref', '--short', 'HEAD'], { encoding: 'utf8' }).trim();
const admitted = await relay('new-game-child', { child, plannerBranch });
const deadline = Date.now() + 300_000;
let delayMs = 2_000;
while (Date.now() < deadline) {
  const status = await relay('new-game-child-status', { childKey: child.key });
  if (['failed', 'cancelled'].includes(status.state)) throw new Error(`child ${status.state}`);
  if (status.issueNumber && status.todoAt) {
    process.stdout.write(`${JSON.stringify(status)}\n`);
    process.exit(0);
  }
  await new Promise((resolve) => setTimeout(resolve, Math.min(delayMs, Math.max(0, deadline - Date.now()))));
  delayMs = Math.min(delayMs * 2, 15_000);
}
throw new Error(`child job ${admitted.jobId} is still waiting for dispatch`);

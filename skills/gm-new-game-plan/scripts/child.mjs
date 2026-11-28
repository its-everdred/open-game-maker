#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import process from 'node:process';
import { setTimeout } from 'node:timers';
import { plannerRelay } from './relay.mjs';

const [ticket, slug, file] = process.argv.slice(2);
if (!file) throw new Error('usage: node child.mjs <planner-ticket> <game-slug> <child.json>');
const relay = plannerRelay(ticket, slug);
const child = JSON.parse(readFileSync(file, 'utf8'));
const admitted = await relay('new-game-child', { child });
const deadline = Date.now() + 300_000;
while (Date.now() < deadline) {
  const status = await relay('new-game-child-status', { childKey: child.key });
  if (status.issueNumber) {
    process.stdout.write(`${JSON.stringify(status)}\n`);
    process.exit(0);
  }
  if (['failed', 'cancelled'].includes(status.state)) throw new Error(`child ${status.state}`);
  await new Promise((resolve) => setTimeout(resolve, 1000));
}
throw new Error(`child job ${admitted.jobId} is still waiting for dispatch`);

#!/usr/bin/env node
import { Buffer } from 'node:buffer';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';
import { plannerRelay } from './relay.mjs';

const [ticket, slug] = process.argv.slice(2);
const relay = plannerRelay(ticket, slug);
if (!process.env.TMPDIR) throw new Error('TMPDIR is required for private context');
const privateDir = mkdtempSync(join(process.env.TMPDIR, 'ogm-new-game-'));
try {
  const context = await relay('new-game-context');
  for (const [index, item] of context.attachments.entries()) {
    const attachment = await relay('new-game-attachment', { attachment: item.id });
    const path = join(privateDir, `attachment-${index}`);
    writeFileSync(path, Buffer.from(attachment.data, 'base64'), { mode: 0o600 });
    item.localPath = path;
  }
  const destination = join(privateDir, 'context.json');
  writeFileSync(destination, JSON.stringify(context), { mode: 0o600 });
  process.stdout.write(`${destination}\n`);
} catch (error) {
  rmSync(privateDir, { recursive: true, force: true });
  throw error;
}

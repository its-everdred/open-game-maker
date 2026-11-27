import { copyFileSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';

import { migrate, MIGRATIONS_DIR } from '../src/migrate.js';
import { openDb } from '../src/open.js';

it('preserves existing events and their feed epoch when upgrading ticket lifecycle storage', () => {
  const directory = mkdtempSync(join(tmpdir(), 'ogm-ticket-migration-'));
  const { sqlite } = openDb(':memory:');
  try {
    for (const name of readdirSync(MIGRATIONS_DIR)) {
      if (name.endsWith('.sql') && !name.endsWith('_ticket_lifecycle.sql'))
        copyFileSync(join(MIGRATIONS_DIR, name), join(directory, name));
    }
    migrate({ sqlite, dir: directory });
    sqlite
      .prepare(
        "INSERT INTO aiur_cursors (daemon_slug, last_seq, epoch, updated_at) VALUES ('game', 7, 'old-epoch', 'now')",
      )
      .run();
    sqlite
      .prepare(
        "INSERT INTO aiur_events (daemon_slug, seq, topic, payload, observed_at) VALUES ('game', 7, 'ticket.10.lifecycle.changed', '{}', 'now')",
      )
      .run();
    migrate({ sqlite });
    expect(sqlite.prepare('SELECT daemon_slug, epoch, seq, topic FROM aiur_events').all()).toEqual([
      { daemon_slug: 'game', epoch: 'old-epoch', seq: 7, topic: 'ticket.10.lifecycle.changed' },
    ]);
    sqlite
      .prepare(
        "INSERT INTO aiur_events (daemon_slug, epoch, seq, topic, payload, observed_at) VALUES ('game', 'new-epoch', 7, 'ticket.11.lifecycle.changed', '{}', 'now')",
      )
      .run();
    expect(sqlite.prepare('SELECT count(*) AS count FROM aiur_events').get()).toEqual({ count: 2 });
  } finally {
    sqlite.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

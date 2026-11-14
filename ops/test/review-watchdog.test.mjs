import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { alertOperator, reviewHealthy, startReviewWatchdog } from '../../services/api/src/review-rounds/watchdog.mjs';

test('persists alert and recovery even when terminal broadcast fails', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'review-watchdog-'));
  const path = join(dir, 'alert.json');
  try {
    await alertOperator(true, path, async () => {
      throw new Error('no terminal');
    });
    assert.equal(JSON.parse(await readFile(path, 'utf8')).stale, true);
    await alertOperator(false, path, async () => {});
    assert.equal(JSON.parse(await readFile(path, 'utf8')).stale, false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('checks the API heartbeat and treats an unreachable API as unhealthy', async () => {
  assert.equal(
    await reviewHealthy(1, 10, async () => new Response(JSON.stringify({ details: { review_rounds: { ok: true } } }))),
    true,
  );
  assert.equal(
    await reviewHealthy(1, 10, async () => new Response(JSON.stringify({ details: { review_rounds: { ok: false } } }))),
    false,
  );
  assert.equal(
    await reviewHealthy(1, 10, async () => {
      throw new Error('offline');
    }),
    false,
  );
});

test('alerts once and reports recovery', async () => {
  let healthy = false;
  const events = [];
  const stop = startReviewWatchdog({
    port: 1234,
    intervalMs: 10,
    log: (event) => events.push(event),
    check: async () => healthy,
    alert: async () => {},
  });
  try {
    await new Promise((resolve) => setTimeout(resolve, 25));
    assert.deepEqual(events, [{ event: 'admin-alert', code: 'review_reconciler_stale' }]);
    healthy = true;
    await new Promise((resolve) => setTimeout(resolve, 25));
    assert.deepEqual(events[1], { event: 'review_reconciler_recovered' });
  } finally {
    stop();
  }
});

test('retries a failed operator broadcast', async () => {
  let attempts = 0;
  const events = [];
  const stop = startReviewWatchdog({
    port: 1234,
    intervalMs: 10,
    log: (event) => events.push(event),
    check: async () => false,
    alert: async () => {
      attempts += 1;
      if (attempts === 1) throw new Error('unavailable');
    },
  });
  try {
    await new Promise((resolve) => setTimeout(resolve, 25));
    assert.equal(attempts, 2);
    assert.ok(events.some((event) => event.code === 'review_alert_delivery_failed'));
  } finally {
    stop();
  }
});

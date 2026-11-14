import { mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { gm, tempDir } from './helpers.js';

function fixture(body: string, ready = true, after = ''): string {
  const root = tempDir();
  mkdirSync(join(root, 'dist'));
  writeFileSync(
    join(root, 'dist/index.html'),
    `<!doctype html><style>html,body { margin:0; height:100%; } ${body}</style><script>
if (location.search.includes('build=test')) throw Error('published build rejected test mode');
const channel = new MessageChannel();
channel.port1.postMessage(JSON.stringify({v: 1, t: 'ready', payload: {protocol: 1}}));
</script><div></div><script>${after}; if (${ready}) window.dispatchEvent(new Event('gm-frame-ready'));</script>`,
  );
  return root;
}

describe('gm check boot', () => {
  it('rejects a uniform frame and accepts a visible frame at both sizes', async () => {
    const blank = await gm(['check', 'boot'], {
      cwd: fixture('body { background: green }', true, "window.createImageBitmap = () => { throw Error('forged'); }"),
    });
    expect(blank.code).toBe(1);
    expect(blank.err.join(' ')).toContain('near-uniform');
    const visible = await gm(['check', 'boot'], {
      cwd: fixture('body { background: green } div { width:100%; height:4%; background:red }'),
    });
    expect(visible.code).toBe(0);
  }, 120_000);

  it('checks both viewport sizes in the selected build directory', async () => {
    const root = fixture(
      'body { background: green } div { width:50%; height:100%; background:red } @media (min-width:1000px) { div { display:none } }',
    );
    renameSync(join(root, 'dist'), join(root, 'built'));
    const result = await gm(['check', 'boot', '--dist', 'built'], { cwd: root });
    expect(result.code).toBe(1);
    expect(result.err.join(' ')).toContain('tablet-landscape');
    expect(result.err.join(' ')).not.toContain('phone');
  }, 120_000);

  it('rejects an invalid viewport', async () => {
    const result = await gm(['check', 'boot', '--viewport', 'wide']);
    expect(result.code).toBe(2);
    expect(result.err.join(' ')).toContain('--viewport must be');
  });

  it('rejects a visible build that never signals readiness', async () => {
    const result = await gm(['check', 'boot', '--viewport', 'phone'], {
      cwd: fixture('body { background: green } div { width:50%; height:100%; background:red }', false),
    });
    expect(result.code).toBe(1);
    expect(result.err.join(' ')).toContain('Timeout');
    expect(result.err).toHaveLength(1);
    expect(result.err[0]).toContain('phone');
  }, 120_000);
});

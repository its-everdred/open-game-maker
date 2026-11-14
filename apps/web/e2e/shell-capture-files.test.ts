import { mkdtempSync, mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { captureFile, captureUrlFile } from './support/shell-capture-files';

describe('shell capture files', () => {
  it('serves contained files but rejects missing files and symlink escapes', () => {
    const root = mkdtempSync(join(tmpdir(), 'shell-files-'));
    const dist = join(root, 'dist');
    mkdirSync(dist);
    writeFileSync(join(dist, 'index.html'), 'ok');
    writeFileSync(join(root, 'secret'), 'secret');
    symlinkSync(join(root, 'secret'), join(dist, 'escape'));
    expect(captureFile(dist, 'index.html')).toBe(join(dist, 'index.html'));
    expect(captureFile(dist, 'missing')).toBeNull();
    expect(captureFile(dist, 'escape')).toBeNull();
  });

  it('decodes URL paths while rejecting invalid and escaping encodings', () => {
    const root = mkdtempSync(join(tmpdir(), 'shell-url-files-'));
    writeFileSync(join(root, 'café scene.png'), 'image');
    expect(captureUrlFile(root, 'caf%C3%A9%20scene.png')).toBe(join(root, 'café scene.png'));
    expect(captureUrlFile(root, '%zz')).toBeNull();
    expect(captureUrlFile(root, '%2e%2e/secret')).toBeNull();
  });
});

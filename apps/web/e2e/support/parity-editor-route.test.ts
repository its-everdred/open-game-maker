import { expect, it } from 'vitest';
import { parityEditorRoute } from './parity-editor-route';

it('uses the real Blobs sandbox and leaves other game routes alone', () => {
  expect(parityEditorRoute('/g/game?mode=edit&test', 'blobs')).toBe('/g/game?mode=edit&test=&scenario=sandbox');
  expect(parityEditorRoute('/g/game?mode=edit&test', 'other')).toBe('/g/game?mode=edit&test');
  expect(parityEditorRoute('/g/game?scenario=old#editor', 'blobs')).toBe('/g/game?scenario=sandbox#editor');
});

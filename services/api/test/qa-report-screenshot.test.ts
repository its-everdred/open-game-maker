import { expect, it } from 'vitest';

import { asUser } from './helpers.js';
import { ids, reportsApp } from './reports-helpers.js';

it('stores a report screenshot for an administrator without exposing it to another player', async () => {
  const { app, post } = await reportsApp();
  const screenshot = 'data:image/webp;base64,UklGRg==';
  const response = await post({ gameId: ids.game, buildHash: 'build1', text: 'stuck', screenshot });
  expect(response.status).toBe(201);
  const { reportId } = (await response.json()) as { reportId: string };
  const read = (user: string) => app.request(`/api/v1/reports/${reportId}`, { headers: asUser(user) });
  expect(await (await read(ids.admin)).json()).toMatchObject({ screenshot });
  expect((await read(ids.outsider)).status).toBe(403);
  const image = await app.request(`/api/v1/reports/${reportId}/screenshot`, { headers: asUser(ids.admin) });
  expect(image.headers.get('content-type')).toBe('image/webp');
  expect(Buffer.from(await image.arrayBuffer()).toString('base64')).toBe('UklGRg==');
  expect((await app.request(`/api/v1/reports/${reportId}/screenshot`, { headers: asUser(ids.outsider) })).status).toBe(
    403,
  );
});

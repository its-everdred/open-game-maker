import { expect, it } from 'vitest';
import config from '../playwright.config.js';

it('binds its dedicated preview port outside the Linux ephemeral range', () => {
  const server = Array.isArray(config.webServer) ? config.webServer[0] : config.webServer;
  const url = new URL(String(server?.url));
  expect(Number(url.port)).toBeLessThan(32768);
  expect(server?.command).toContain(`--port ${url.port} --strictPort`);
  expect(config.use?.baseURL).toBe(url.origin);
});

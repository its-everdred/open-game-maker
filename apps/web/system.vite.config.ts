import { env } from 'node:process';

import { mergeConfig } from 'vite';

import base from './vite.config';

const api = `http://127.0.0.1:${env.OGM_API_PORT}`;

// The system test serves the built app and proxies its real API calls to the isolated test API.
export default mergeConfig(base, { preview: { proxy: { '/api': api, '/auth': api } } });

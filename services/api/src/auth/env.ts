import { loadEnv } from '@ogm/config';

export const authEnvSpec = {
  OGM_APP_ORIGIN: { kind: 'url' },
  OGM_SESSION_SECRET: { kind: 'secret' },
  OGM_WS_TOKEN_SECRET: { kind: 'secret' },
  OGM_ALLOWED_EMAILS: { kind: 'string', required: false },
  OGM_MAINTAINER_EMAILS: { kind: 'string', required: false },
  GOOGLE_CLIENT_ID: { kind: 'string', required: false },
  GOOGLE_CLIENT_SECRET: { kind: 'string', required: false },
  SMTP_URL: { kind: 'string', required: false },
  SMTP_FROM: { kind: 'string', required: false },
  OGM_QA_EMAILS: { kind: 'string', required: false },
} as const;

export type AuthEnv = ReturnType<typeof loadAuthEnv>;

export function loadAuthEnv(source?: Record<string, string | undefined>) {
  return loadEnv('api', authEnvSpec, source);
}

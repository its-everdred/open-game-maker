import type { Sqlite } from '@ogm/db';

import { normalizeEmail, parseEmailList } from './access.js';
import { AdminInboxMailSender } from './mail-admin-inbox.js';
import { SmtpMailSender } from './mail-smtp.js';

export type MailMessage = { to: string; subject: string; text: string; html?: string };

export interface MailSender {
  send(m: MailMessage): Promise<{ id: string }>;
}

// SMTP only when SMTP_URL is set; otherwise every mail lands in the admin inbox (D-MAIL). Mail to an OGM_QA_EMAILS
// address always lands in the admin inbox, so the host can read the QA account's sign-in link (ops/bin/ogm-qa-signin).
export function selectMailSender(
  env: { SMTP_URL?: string; SMTP_FROM?: string; OGM_QA_EMAILS?: string },
  sqlite: Sqlite,
): { sender: MailSender; kind: 'smtp' | 'admin-inbox' } {
  if (!env.SMTP_URL) return { sender: new AdminInboxMailSender(sqlite), kind: 'admin-inbox' };
  const smtp = new SmtpMailSender(env.SMTP_URL, env.SMTP_FROM);
  const qa = parseEmailList(env.OGM_QA_EMAILS);
  if (qa.size === 0) return { sender: smtp, kind: 'smtp' };
  const inbox = new AdminInboxMailSender(sqlite);
  return { sender: { send: (m) => (qa.has(normalizeEmail(m.to)) ? inbox : smtp).send(m) }, kind: 'smtp' };
}

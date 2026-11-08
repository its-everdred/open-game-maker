import type { Transporter } from 'nodemailer';
import { describe, expect, it, vi } from 'vitest';

import { AdminInboxMailSender, listOutbox, markOpened } from '../src/auth/mail-admin-inbox.js';
import { SmtpMailSender } from '../src/auth/mail-smtp.js';
import { selectMailSender } from '../src/auth/mail.js';
import { makeDeps } from './helpers.js';

const message = { to: 'kim@example.com', subject: 'Hi', text: 'https://makeopen.games/x' };

describe('MailSender', () => {
  it('defaults to the admin inbox when SMTP_URL is unset', () => {
    const { sqlite } = makeDeps();
    const selected = selectMailSender({}, sqlite);
    expect(selected.kind).toBe('admin-inbox');
    expect(selected.sender).toBeInstanceOf(AdminInboxMailSender);
  });

  it('selects SMTP when SMTP_URL is set', () => {
    const selected = selectMailSender(
      { SMTP_URL: 'smtp://127.0.0.1:2525', SMTP_FROM: 'ogm@example.com' },
      makeDeps().sqlite,
    );
    expect(selected.kind).toBe('smtp');
    expect(selected.sender).toBeInstanceOf(SmtpMailSender);
  });

  it('keeps a QA address on the admin inbox under SMTP, so the host can read its sign-in link', async () => {
    const { sqlite } = makeDeps();
    const sendMail = vi.fn().mockResolvedValue({ messageId: '<1@example.com>' });
    vi.spyOn(SmtpMailSender.prototype, 'send').mockImplementation(sendMail);
    const { sender } = selectMailSender({ SMTP_URL: 'smtp://127.0.0.1:2525', OGM_QA_EMAILS: 'QA@example.com' }, sqlite);
    await sender.send({ ...message, to: 'qa@example.com' });
    await sender.send(message);
    expect(listOutbox(sqlite).map((row) => row.to)).toEqual(['qa@example.com']);
    expect(sendMail).toHaveBeenCalledExactlyOnceWith(message);
    vi.restoreAllMocks();
  });

  it('admin inbox writes one mail_outbox row per send, listable and markable once', async () => {
    const { sqlite } = makeDeps();
    const { id } = await new AdminInboxMailSender(sqlite).send(message);
    expect(listOutbox(sqlite)).toMatchObject([{ id, ...message, html: null, opened_at: null }]);
    expect(markOpened(sqlite, id)).toBe(true);
    expect(markOpened(sqlite, id)).toBe(false);
    expect(listOutbox(sqlite, { unopened: true })).toEqual([]);
  });

  it('SMTP sends once through the transport with the From address', async () => {
    const sendMail = vi.fn().mockResolvedValue({ messageId: '<1@example.com>' });
    const sender = new SmtpMailSender('smtp://unused', 'ogm@example.com', { sendMail } as unknown as Transporter);
    expect(await sender.send(message)).toEqual({ id: '<1@example.com>' });
    expect(sendMail).toHaveBeenCalledExactlyOnceWith({ from: 'ogm@example.com', ...message });
  });
});

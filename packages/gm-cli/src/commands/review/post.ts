import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { basename } from 'node:path';
import { createHash } from 'node:crypto';

import { ReviewSubmission } from '@ogm/contracts';
import { CommandError, EXIT, UsageError, type GmCommand } from '../../command.js';
import { gameDir, workspaceRoot } from '../../outbox.js';
import { submitReviewRelay } from '../../review-relay.js';
import { putBlob } from '../../blobs.js';

export const command: GmCommand = {
  name: 'review post',
  summary: 'post a review round from a JSON submission',
  usage: '<submission.json>',
  flags: {},
  async run(ctx, args) {
    if (args.length !== 1) throw new UsageError('provide a submission JSON file', 'gm help review post');
    let input: unknown;
    try {
      input = JSON.parse(readFileSync(args[0]!, 'utf8')) as unknown;
    } catch {
      throw new UsageError('cannot read submission JSON', 'gm help review post');
    }
    const parsed = ReviewSubmission.safeParse(input);
    if (!parsed.success) throw new CommandError(parsed.error.issues.map((issue) => issue.message).join('; '));
    const root = realpathSync(workspaceRoot(ctx.cwd));
    const attachments: { index: number; bytes: Buffer; mime: string }[] = [];
    for (const [index, media] of parsed.data.media.entries()) {
      if ((media.kind !== 'still' && media.kind !== 'clip' && media.kind !== 'audio') || !media.ref.startsWith('file:'))
        continue;
      const path = realpathSync(resolve(ctx.cwd, media.ref.slice(5)));
      const local = relative(root, path);
      if (!local || local === '..' || local.startsWith(`..${sep}`) || local.split(sep).includes('.gm'))
        throw new CommandError('review media must be inside the workspace outside .gm');
      const mime =
        media.kind === 'clip'
          ? 'video/mp4'
          : media.kind === 'audio'
            ? /\.wav$/iu.test(path)
              ? 'audio/wav'
              : /\.mp3$/iu.test(path)
                ? 'audio/mpeg'
                : /\.ogg$/iu.test(path)
                  ? 'audio/ogg'
                  : 'audio/mp4'
            : /\.png$/iu.test(path)
              ? 'image/png'
              : 'image/jpeg';
      if (
        (media.kind === 'clip' && !/\.mp4$/iu.test(path)) ||
        (media.kind === 'still' && !/\.(png|jpe?g)$/iu.test(path)) ||
        (media.kind === 'audio' && !/\.(wav|mp3|ogg|m4a)$/iu.test(path))
      )
        throw new CommandError('review media must be a PNG, JPEG, MP4, WAV, MP3, OGG, or M4A');
      const stat = statSync(path);
      if (!stat.isFile() || stat.size <= 0 || stat.size > 64 * 1024 * 1024)
        throw new CommandError('invalid review media size');
      const bytes = readFileSync(path);
      if (!bytes.length || bytes.length > 64 * 1024 * 1024) throw new CommandError('review media exceeds size limit');
      media.ref = `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
      attachments.push({ index, bytes, mime });
    }
    const slug = basename(gameDir(ctx.cwd, root));
    const previewFile = join(root, '.gm', 'context', 'preview.json');
    const scoped = existsSync(previewFile)
      ? (JSON.parse(readFileSync(previewFile, 'utf8')) as { token?: unknown })
      : null;
    if (typeof scoped?.token === 'string' && scoped.token) {
      ctx.out(await submitReviewRelay(root, slug, scoped.token, parsed.data, attachments));
      return EXIT.ok;
    }
    if (parsed.data.media.some((media) => media.kind === 'audio'))
      throw new CommandError('mock audio requires a ticket-scoped preview credential');
    if (!ctx.blobApi)
      throw new UsageError('no daemon upload configuration', 'run inside a configured worker workspace');
    for (const attachment of attachments) {
      const media = parsed.data.media[attachment.index]!;
      await putBlob(ctx, attachment.bytes, media.ref.slice(7), attachment.mime);
    }
    const secret = readFileSync(ctx.blobApi.secretFile, 'utf8').trim();
    if (!secret) throw new CommandError('daemon hook secret is empty');
    const response = await fetch(
      `${ctx.blobApi.url.replace(/\/+$/, '')}/internal/games/${encodeURIComponent(slug)}/review-rounds`,
      {
        method: 'POST',
        headers: { authorization: `Bearer ${secret}`, 'content-type': 'application/json' },
        body: JSON.stringify(parsed.data),
        signal: AbortSignal.timeout(20_000),
      },
    );
    const body = await response.text();
    if (!response.ok) throw new CommandError(`review post failed (HTTP ${response.status}): ${body}`);
    ctx.out(body);
    return EXIT.ok;
  },
};

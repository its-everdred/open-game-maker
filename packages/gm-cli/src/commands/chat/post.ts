import { AgentOutboxLine, ChatPostPayload } from '@ogm/contracts';
import { ulid } from 'ulid';

import { EXIT, UsageError, type GmCommand } from '../../command.js';
import { appendOutboxLine, copyOutboxMedia, jobContext } from '../../outbox.js';

export type PostChatOptions = {
  cwd?: string;
  job?: string;
  text?: string;
  image?: string;
  clip?: string;
  poster?: string;
  emit?: (event: string, payload: unknown, jobId?: string) => void;
};

type WriteChatPostOptions = PostChatOptions & {
  environmentJob?: string | null;
};

async function writeChatPost(options: WriteChatPostOptions): Promise<AgentOutboxLine> {
  const text = options.text?.trim();
  if (!text) throw new UsageError('--text needs one line', 'gm chat post --text "<one line>"');
  if (/\r|\n/.test(text)) throw new UsageError('--text must be one line', 'replace line breaks with spaces');
  if (text.length > 8000) throw new UsageError('--text exceeds 8000 characters', 'shorten the post');
  if (options.image && options.clip)
    throw new UsageError('--image and --clip cannot be combined', 'post the image and clip separately');
  if (options.clip && !options.poster) throw new UsageError('clips need a poster', 'add --poster shots/phone/t0.png');
  if (!options.clip && options.poster)
    throw new UsageError('--poster needs --clip', 'remove --poster or add --clip <mp4>');

  const { root, jobId } = jobContext({ ...options, cwd: options.cwd ?? process.cwd() });
  let rawPayload: unknown = { kind: 'text', text };
  if (options.clip) {
    rawPayload = {
      kind: 'clip',
      text,
      file: copyOutboxMedia(root, options.clip, 'clip'),
      poster: copyOutboxMedia(root, options.poster!, 'poster'),
    };
  } else if (options.image) {
    rawPayload = { kind: 'image', text, file: copyOutboxMedia(root, options.image, 'image') };
  }
  const payload = ChatPostPayload.parse(rawPayload);
  const line = AgentOutboxLine.parse({
    v: 1,
    id: ulid(),
    job_id: jobId,
    at: new Date().toISOString(),
    type: 'chat.post',
    payload,
  });
  appendOutboxLine(root, 'chat.jsonl', line);
  options.emit?.('chat.post', { kind: payload.kind }, jobId);
  return line;
}

/** Write one creator-chat outbox line for reuse by other `gm` commands. */
export async function postChat(options: PostChatOptions): Promise<{ id: string }> {
  const line = await writeChatPost(options);
  return { id: line.id };
}

function stringFlag(flags: Record<string, unknown>, name: string): string | undefined {
  return typeof flags[name] === 'string' ? flags[name] : undefined;
}

export const command: GmCommand = {
  name: 'chat post',
  summary: 'post one build update and optional media to the creator chat',
  usage: '--text "<one line>" [--image <png> | --clip <mp4> --poster <png>]',
  example: 'chat post --job "$GM_JOB" --text "first pass" --image shots/phone/t0.png',
  flags: {
    job: { type: 'string', help: 'build job id (defaults to GM_JOB, then .gm/context/job.json)' },
    text: { type: 'string', help: 'one-line message shown with the post' },
    image: { type: 'string', help: 'PNG still to copy into the outbox' },
    clip: { type: 'string', help: 'MP4 clip to copy into the outbox (25 MiB max)' },
    poster: { type: 'string', help: 'PNG poster required with --clip' },
  },
  async run(ctx, _args, flags) {
    const line = await writeChatPost({
      cwd: ctx.cwd,
      job: stringFlag(flags, 'job'),
      environmentJob: ctx.config.jobId,
      text: stringFlag(flags, 'text'),
      image: stringFlag(flags, 'image'),
      clip: stringFlag(flags, 'clip'),
      poster: stringFlag(flags, 'poster'),
      emit: ctx.emit,
    });
    ctx.out(ctx.json ? JSON.stringify(line) : line.id);
    return EXIT.ok;
  },
};

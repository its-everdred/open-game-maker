import {
  MAX_CHAT_ATTACHMENTS,
  MAX_IMAGE_ATTACHMENT_BYTES,
  MAX_TEXT_ATTACHMENT_BYTES,
  type ChatAttachment,
} from '@ogm/contracts/browser';

import { api } from '../../lib/api/client';

export const ATTACH_ACCEPT = 'image/*,.txt,.md,.markdown,.json,text/plain,text/markdown,application/json';
export const LARGE_PASTE_CHARACTERS = 1_500;
export const LARGE_PASTE_LINES = 20;

const TEXT_BY_EXTENSION: Record<string, string> = {
  txt: 'text/plain',
  md: 'text/markdown',
  markdown: 'text/markdown',
  json: 'application/json',
};
const TEXT_TYPES = new Set(Object.values(TEXT_BY_EXTENSION));

export type PendingAttachment = {
  key: string;
  file: File;
  type: string;
  title?: string;
  preview?: string;
  uploaded?: ChatAttachment;
};
export type UploadAttachment = (jobId: string, file: File, type: string) => Promise<ChatAttachment>;

// The type to upload with, or null when the server would refuse the file. Browsers often leave `.md` untyped, so text
// files are recognised by extension too.
export function attachmentType(file: File): string | null {
  if (file.type.startsWith('image/')) return file.size <= MAX_IMAGE_ATTACHMENT_BYTES ? file.type : null;
  const extension = /\.([a-z]+)$/i.exec(file.name)?.[1]?.toLowerCase();
  const type = TEXT_TYPES.has(file.type) ? file.type : extension ? TEXT_BY_EXTENSION[extension] : undefined;
  return type !== undefined && file.size <= MAX_TEXT_ATTACHMENT_BYTES ? type : null;
}

let nextKey = 0;

// Keeps the files the server would accept, up to the per-message limit.
export function addAttachments(current: PendingAttachment[], files: Iterable<File>): PendingAttachment[] {
  const next = [...current];
  for (const file of files) {
    if (next.length >= MAX_CHAT_ATTACHMENTS) break;
    const type = attachmentType(file);
    if (type !== null && file.size > 0) next.push({ key: `attachment-${(nextKey += 1)}`, file, type });
  }
  return next;
}

export function isLargeTextPaste(text: string): boolean {
  return text.length > LARGE_PASTE_CHARACTERS || text.split(/\r\n|\r|\n/).length > LARGE_PASTE_LINES;
}

export function addPastedText(current: PendingAttachment[], text: string): PendingAttachment[] {
  const file = new File([text], 'pasted-text.txt', { type: 'text/plain' });
  const next = addAttachments(current, [file]);
  if (next.length === current.length) return current;
  const added = next[next.length - 1]!;
  return [...next.slice(0, -1), { ...added, title: 'Pasted text', preview: text }];
}

export async function uploadChatAttachment(
  jobId: string,
  file: File,
  type: string,
  signal?: AbortSignal,
): Promise<ChatAttachment> {
  return api<ChatAttachment>(`/jobs/${encodeURIComponent(jobId)}/chat/attachments`, {
    method: 'POST',
    headers: { 'content-type': type, 'x-file-name': encodeURIComponent(file.name) },
    body: file,
    signal,
  });
}

// Uploads each file once; a retry after a failed post reuses the ids already stored.
export async function uploadAll(
  jobId: string,
  pending: PendingAttachment[],
  upload: UploadAttachment,
): Promise<ChatAttachment[]> {
  const uploaded: ChatAttachment[] = [];
  for (const item of pending) {
    item.uploaded ??= await upload(jobId, item.file, item.type);
    uploaded.push(item.uploaded);
  }
  return uploaded;
}

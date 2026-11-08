import { existsSync, readdirSync, readFileSync } from 'node:fs';

import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { describe, expect, it } from 'vitest';
import { toJSONSchema, type z } from 'zod';

import {
  AgentOutboxLine,
  BuildChatMessage,
  ChatAttachment,
  ChatPostBody,
  ChatPostPayload,
  chatSchemas,
  OptionPlayable,
} from '../src/chat.js';
import { loadJson } from './helpers.js';

const packageRoot = new URL('../', import.meta.url);

function fixturesFor(stem: string): string[] {
  const name = /^chat\.(.+)\.v1$/.exec(stem)![1];
  const directory = new URL(`fixtures/chat/${name}/`, packageRoot);
  if (!existsSync(directory)) return [`fixtures/chat/${name}.json`];
  return readdirSync(directory)
    .filter((entry) => entry.endsWith('.json'))
    .map((entry) => `fixtures/chat/${name}/${entry}`);
}

const shapes = Object.entries(chatSchemas).map(([stem, schema]) => ({ stem, schema: schema as z.ZodType }));

describe('build chat contract', () => {
  it.each(shapes)('$stem fixtures parse and the emitted schema is current', ({ stem, schema }) => {
    const emitted = JSON.parse(readFileSync(new URL(`schemas/${stem}.json`, packageRoot), 'utf8')) as object;
    expect(emitted).toEqual({
      ...toJSONSchema(schema, { target: 'draft-2020-12' }),
      $id: `https://open-game-maker-2000.local/schemas/${stem}.json`,
    });
    const ajv = new Ajv2020.default({ allErrors: true, strict: true, strictRequired: false, allowUnionTypes: true });
    addFormats.default(ajv);
    const validate = ajv.compile(emitted);
    for (const file of fixturesFor(stem)) {
      const result = schema.safeParse(loadJson(file));
      expect(result.success, `${file}: ${result.error?.message}`).toBe(true);
      expect(validate(loadJson(file)), `${file}: ${JSON.stringify(validate.errors)}`).toBe(true);
    }
  });

  // The panel and every chat ticket copy this contract, so each rule that keeps a row renderable is enforced.
  it.each([
    { file: 'message.unknown-kind.json', schema: BuildChatMessage, path: 'kind' },
    { file: 'message.media-without-size.json', schema: BuildChatMessage, path: 'media.width' },
    { file: 'outbox-line.bad-type.json', schema: AgentOutboxLine, path: 'type' },
    { file: 'post-payload.image-without-file.json', schema: ChatPostPayload, path: 'file' },
    { file: 'post.too-many-attachments.json', schema: ChatPostBody, path: 'attachments' },
    { file: 'attachment.disallowed-type.json', schema: ChatAttachment, path: 'mime' },
    // A playable's scenario is a bare query: a URL never reaches the card, and the host's own parameters stay the host's.
    { file: 'option-playable.url-scenario.json', schema: OptionPlayable, path: 'scenario' },
    { file: 'option-playable.reserved-param.json', schema: OptionPlayable, path: 'scenario' },
  ])('rejects $file at $path', ({ file, schema, path }) => {
    const result = (schema as z.ZodType).safeParse(loadJson(`fixtures/chat-negative/${file}`));
    expect(result.success).toBe(false);
    expect(result.error!.issues.map((issue) => issue.path.join('.'))).toContain(path);
  });

  it('rejects whitespace-only creator text in both runtime and emitted JSON schemas', () => {
    const document = loadJson('fixtures/chat-negative/post.whitespace.json');
    expect(ChatPostBody.safeParse(document).success).toBe(false);

    const emitted = JSON.parse(readFileSync(new URL('schemas/chat.post.v1.json', packageRoot), 'utf8')) as object;
    const ajv = new Ajv2020.default({ allErrors: true, strict: true, strictRequired: false });
    const validate = ajv.compile(emitted);
    expect(validate(document)).toBe(false);
  });

  it('pairs the agent clip outbox line with the row it becomes', () => {
    const { line, message } = loadJson<{ line: unknown; message: unknown }>('fixtures/chat/agent-clip.json');
    const parsedLine = AgentOutboxLine.parse(line);
    const parsedMessage = BuildChatMessage.parse(message);
    const payload = ChatPostPayload.parse(parsedLine.payload);
    expect(parsedMessage).toMatchObject({
      id: parsedLine.id,
      job_id: parsedLine.job_id,
      at: parsedLine.at,
      actor: 'agent',
      kind: payload.kind,
      text: payload.text,
    });
  });

  // A creator may send files with no words, but never an empty message or the same file twice.
  it('accepts attachments without text and refuses an empty or duplicated post', () => {
    const id = 'a_8f1c2a4e-5b6d-4c7e-9f00-1a2b3c4d5e20';
    expect(ChatPostBody.parse({ attachments: [id] })).toEqual({ attachments: [id] });
    expect(ChatPostBody.safeParse({}).success).toBe(false);
    expect(ChatPostBody.safeParse({ attachments: [] }).success).toBe(false);
    expect(ChatPostBody.safeParse({ text: 'two', attachments: [id, id] }).success).toBe(false);
  });
});

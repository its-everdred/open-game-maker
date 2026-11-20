import { EXIT, UsageError, type GmCommand } from '../../command.js';
import { inventoryPath, readInventory, writeInventory } from '../../decision-inventory.js';
import { command as decide } from '../decide/index.js';
import { postChat } from '../chat/post.js';
import { resolve } from 'node:path';
import { alreadyAsked, readDecisions } from '../../ledger/decisions.js';
import { gameDir } from '../../outbox.js';

function optionId(label: string, index: number): string {
  const id = label
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 32);
  return id || `option-${index + 1}`;
}

export const command: GmCommand = {
  name: 'decisions raise',
  summary: 'raise an open inventory decision as a non-blocking creator Command',
  usage: '<id>',
  flags: {},
  async run(ctx, args) {
    if (args.length !== 1) throw new UsageError('provide a decision id', 'gm decisions raise <id>');
    const { file } = inventoryPath(ctx.cwd);
    const inventory = readInventory(file);
    const entry = inventory.find((decision) => decision.id === args[0]);
    if (!entry || entry.status !== 'open')
      throw new UsageError(`decision ${args[0]} is not open`, 'use an open decision id from gm decisions next');
    const topicWords = entry.area.split(/\s+/).filter(Boolean);
    const topic = (topicWords.length === 1 ? `${entry.area} choice` : topicWords.slice(0, 5).join(' ')).slice(0, 80);
    const recommendedOption = entry.options.find((option) => entry.recommendation.startsWith(`${option.label}:`));
    const recommendationReason = recommendedOption
      ? entry.recommendation.slice(recommendedOption.label.length + 1).trim()
      : entry.why;
    if (alreadyAsked(readDecisions(gameDir(ctx.cwd)), topic, entry.question)) {
      entry.status = 'asked';
      writeInventory(file, inventory);
      ctx.out(`decision ${entry.id} was already asked; synchronized inventory status`);
      return EXIT.ok;
    }
    const ids = entry.options.map((option, index) => optionId(option.label, index));
    if (new Set(ids).size !== ids.length)
      throw new UsageError(
        `decision ${entry.id} has option labels that map to duplicate ids`,
        'use distinct option labels',
      );
    const missing = entry.options.find((option) => !option.media);
    if (missing)
      throw new UsageError(
        `decision ${entry.id} option "${missing.label}" needs media${missing.media_needed ? `: ${missing.media_needed}` : ''}`,
        'attach media to every option before raising the decision',
      );
    const mediaIds: string[] = [];
    for (const option of entry.options) {
      const media = option.media!;
      const chatId = /^chat:[A-Za-z0-9_-]+$/.test(media) ? media.slice('chat:'.length) : null;
      if (chatId) {
        mediaIds.push(chatId);
      } else {
        const post = await postChat({
          cwd: ctx.cwd,
          job: ctx.config.jobId ?? undefined,
          text: `${entry.area}: ${option.label}`,
          image: resolve(ctx.cwd, media),
          emit: ctx.emit,
        });
        mediaIds.push(post.id);
      }
    }
    const result = await decide.run(ctx, [], {
      topic,
      question: entry.question,
      option: entry.options.map((option, index) => `${ids[index]}=${option.label}`),
      media: entry.options.map((_option, index) => `${ids[index]}=${mediaIds[index]}`),
      recommend: ids[entry.options.findIndex((option) => entry.recommendation.startsWith(`${option.label}:`))],
      reason: recommendationReason || entry.why,
      blocking: false,
    });
    if (result !== EXIT.ok) return result;
    entry.status = 'asked';
    writeInventory(file, inventory);
    return EXIT.ok;
  },
};

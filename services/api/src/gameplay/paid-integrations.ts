import { readdir, readFile } from 'node:fs/promises';
import { extname, join, relative } from 'node:path';

// Hosts of AI, voice and media APIs billed per request. A game build that names one would spend money while it is
// played, so it is refused while paid APIs during gameplay are off.
const PAID_HOSTS = [
  'api.openai.com',
  'api.anthropic.com',
  'generativelanguage.googleapis.com',
  'texttospeech.googleapis.com',
  'api.elevenlabs.io',
  'fal.run',
  'api.replicate.com',
  'api.stability.ai',
  'api.mistral.ai',
  'api.cohere.ai',
  'api.cohere.com',
  'api.groq.com',
  'api.together.xyz',
  'api.deepgram.com',
  'api.assemblyai.com',
  'api.perplexity.ai',
  'openrouter.ai',
];
const PAID = new RegExp(
  `(?<![\\w.-])(?:[\\w-]+\\.)*(?:${PAID_HOSTS.map((host) => host.replaceAll('.', '\\.')).join('|')})(?![\\w-])`,
);
// Provider key shapes (OpenAI/Anthropic `sk-`, Google `AIza`, Replicate `r8_`, Groq `gsk_`). A game client never
// holds one, whatever the setting.
const CREDENTIAL = /(?<![\w-])(?:sk-[A-Za-z0-9_-]{20,}|AIza[0-9A-Za-z_-]{35}|r8_[A-Za-z0-9]{30,}|gsk_[A-Za-z0-9]{30,})/;
const TEXT = new Set(['.js', '.mjs', '.cjs', '.html', '.htm', '.json', '.css', '.svg', '.txt', '.webmanifest', '.map']);

export type IntegrationScan = { paid: string[]; credentials: string[] };

// The files of a built game (relative paths) that name a paid provider or hold a provider credential.
export async function scanBuild(root: string): Promise<IntegrationScan> {
  const scan: IntegrationScan = { paid: [], credentials: [] };
  // A build with no files on disk serves nothing, so it calls nothing.
  const entries = await readdir(root, { recursive: true, withFileTypes: true }).catch((error: unknown) => {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  });
  for (const entry of entries) {
    if (!entry.isFile() || !TEXT.has(extname(entry.name).toLowerCase())) continue;
    const path = join(entry.parentPath, entry.name);
    const text = await readFile(path, 'utf8');
    const file = relative(root, path);
    if (PAID.test(text)) scan.paid.push(file);
    if (CREDENTIAL.test(text)) scan.credentials.push(file);
  }
  return scan;
}

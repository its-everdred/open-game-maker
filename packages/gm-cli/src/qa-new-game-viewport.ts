import { execFile } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { newGameSteps, type CreatedGame } from './qa-new-game-steps.js';

type Browser = Awaited<ReturnType<(typeof import('@ogm/gm-verify'))['launch']>>;
type Page = Awaited<ReturnType<Awaited<ReturnType<Browser['newContext']>>['newPage']>>;
type Viewport = { width: number; height: number };

export type NewGameViewportConfig = {
  origin: string;
  cookie: { name: string; value: string };
  out: string;
  viewport: Viewport;
  onCreated?: (game: CreatedGame) => Promise<void>;
  verify: (page: Page, gameId: string, requestId: string, finishedAt: number) => Promise<void>;
  cleanup: (game: CreatedGame) => Promise<void>;
};

/** Always attempt cleanup, including a failed create that returned a game ID. Never report success without an MP4. */
export async function newGameViewport(
  browser: Browser,
  config: NewGameViewportConfig,
  deps: {
    steps: typeof newGameSteps;
    encode: (video: string, mp4: string) => Promise<void>;
  } = {
    steps: newGameSteps,
    encode: async (video, mp4) => {
      await promisify(execFile)(
        'ffmpeg',
        ['-y', '-i', video, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '27', '-movflags', '+faststart', mp4],
        { timeout: 180_000, maxBuffer: 1_000_000 },
      );
    },
  },
) {
  const name = `${config.viewport.width}x${config.viewport.height}`;
  const videoDir = join(config.out, `.video-${name}`);
  await mkdir(videoDir, { recursive: true });
  const context = await browser.newContext({
    viewport: config.viewport,
    deviceScaleFactor: 2,
    hasTouch: true,
    recordVideo: { dir: videoDir, size: config.viewport },
  });
  const failures: string[] = [];
  const stills: string[] = [];
  let game: CreatedGame | undefined;
  let videoPath: string | undefined;
  try {
    await context.addCookies([{ ...config.cookie, url: config.origin }]);
    const page = await context.newPage();
    const video = page.video();
    if (!video) throw new Error('browser did not start recording');
    videoPath = await video.path();
    const still = async (step: string) => {
      const path = join(config.out, `${name}-${step}.png`);
      await page.screenshot({ path });
      stills.push(path);
    };
    const result = await deps.steps(page, config.origin, still, async (value) => {
      await config.onCreated?.(value);
      game = value;
    });
    await config.verify(page, result.gameId, result.requestId, result.finishedAt);
    await still('progress');
  } catch (error) {
    failures.push(error instanceof Error ? error.message.split('\n')[0]! : 'browser run failed');
  } finally {
    try {
      await context.close();
    } catch {
      failures.push('browser recording could not be closed');
    }
    if (game) {
      try {
        await config.cleanup(game);
      } catch {
        failures.push('QA cleanup failed; inspect the run before retrying');
      }
    }
  }
  const mp4 = join(config.out, `${name}.mp4`);
  if (videoPath) {
    try {
      await deps.encode(videoPath, mp4);
    } catch {
      failures.push('MP4 encoding failed');
    }
  } else failures.push('browser recording is missing');
  return {
    viewport: name,
    ok: failures.length === 0,
    failures,
    stills,
    mp4: failures.includes('MP4 encoding failed') || !videoPath ? null : mp4,
  };
}

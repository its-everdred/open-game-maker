import sharp from 'sharp';

/** Reject an unpainted game frame before reporting visual parity. */
export async function assertGameFramePainted(
  screenshot: Buffer,
  frame: { x: number; y: number; width: number; height: number },
  scale: number,
) {
  // Inspect the centre of the game, excluding its edges and loading controls.
  const left = Math.round((frame.x + frame.width / 4) * scale);
  const top = Math.round((frame.y + frame.height / 4) * scale);
  const width = Math.floor((frame.width / 2) * scale);
  const height = Math.floor((frame.height / 2) * scale);
  if (left < 0 || top < 0 || width < 1 || height < 1) throw new Error('Invalid game frame bounds');
  const crop = await sharp(screenshot).extract({ left, top, width, height }).removeAlpha().png().toBuffer();
  const stats = await sharp(crop).stats();
  const variation = stats.channels.slice(0, 3).reduce((sum, channel) => sum + channel.stdev, 0) / 3;
  if (variation < 2) throw new Error('Game frame is blank; cannot report glass parity');
}

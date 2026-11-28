import { legacyBlobGrants, stagePublishAssets } from './publish-assets.js';

// Executed by the trusted host hook, never from a game-provided binary or inside its sandbox.
const [game, destination, assetsRoot, blobRoot, visibility] = process.argv.slice(2);
if (!game || !destination || !assetsRoot || !blobRoot || (visibility !== 'public' && visibility !== 'private')) {
  throw new Error('publish asset staging needs a game, destination, configured stores, and repository visibility');
}
await stagePublishAssets(game, destination, assetsRoot, blobRoot, visibility, await legacyBlobGrants(game));

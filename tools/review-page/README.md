# Review page pipeline

The pipeline builds the existing review page from Aiur Commands, human-review
tickets and optional JSONL feeds. It stages local media, prepares an Artifact
publish bundle, relays picks and records the published file inventory. Node 24,
`gh`, `ffmpeg`, access to each Aiur instance and the Executor's `decide.sh` are required.

Create a private configuration file outside the repository. Paths must be
absolute; the `message` executable receives one JSON pick as its sole argument
and must deliver it to the Executor, returning a nonzero exit on failure.

```json
{
  "sources": [
    { "key": "open-games", "checkout": "<games-checkout>", "repository": "<owner>/<games-repository>", "aiur": "<aiur-command>", "decideRepo": "og" },
    { "key": "core", "checkout": "<core-checkout>", "repository": "<owner>/<core-repository>", "aiur": "<aiur-command>", "decideRepo": "core" }
  ],
  "mediaRoots": ["<approved-media-root>"],
  "decisionsLogs": ["<decisions-log>"],
  "feeds": { "rounds": "<rounds-jsonl>" },
  "playLinks": "<verified-play-links-json>",
  "output": "<output-directory>",
  "state": "<private-state-directory>",
  "artifactUrl": "<artifact-url>",
  "initialPublished": "<artifact-file-inventory-json>",
  "initialPage": "<existing-page-html>",
  "initialRelayed": "<existing-relay-ledger>",
  "legacyMedia": "<existing-page-media-directory>",
  "decide": "<executor-decide-script>",
  "message": "<executor-message-script>"
}
```

`decisionsLogs`, `feeds`, `playLinks`, `initialPage`, `initialRelayed` and `legacyMedia` are optional for a
new page. For an existing page, supply its current HTML and relay ledger so
recent answers stay collapsed and old picks are not resent. Supply a complete
JSON array of the artifact's currently published file paths as
`initialPublished`; use `[]` only for a genuinely empty artifact. The first
build cannot safely infer the remote file inventory. Paths under `m/` no longer
used by the page are nulled when needed to stay under the 512-file limit;
other published paths are never automatically deleted. Local media must resolve
inside a configured `mediaRoots` directory, including after symlink resolution.
When `legacyMedia` is supplied, add it to `mediaRoots`: it supplies the old
page's snapshots when a worker has removed an original. The builder encodes
local images as JPEG, video as H.264 MP4, and audio as MP3 for phone playback.
An optional `ffmpeg` configuration value selects the executable. Each source
may also specify `id` and `reviewLabel` when the same repository is served by
more than one Aiur instance; its `aiur` and optional `gh` paths must address
that instance.
`playLinks` maps card keys to verified HTTPS playable URLs. The build reports
and omits media-free cards without a review or play link; Executor-only and
explicit non-product Commands are omitted from the creator-facing page.

After reading ArtifactData picks into a JSON document, run:

```sh
node tools/review-page/src/cli.ts relay <config.json> <picks.json>
node tools/review-page/src/cli.ts build <config.json>
```

`picks.json` is an array of documents with `path` and `data`, or a map from
card key to pick document. Pass the resulting `bundle.json` to the Artifact
publish call. After it succeeds, record its returned version before building
again:

```sh
node tools/review-page/src/cli.ts record <config.json> <version>
```

The record step checks that the page and media have not changed since the
build. Relay saves picks before delivery and retries failures on the next run,
even if that run receives an empty picks document. One failed pick does not
prevent other picks from being delivered. It records the decision-delivery
step separately so a failed Command answer can be retried without repeating
that step. If a delivery process times out after reaching its destination, its
outcome may be unknown: reconcile that pick before retrying. The state directory
is private operational data. A `pipeline.lock` left by an interrupted process
must be removed only after confirming that process has stopped.

Run focused checks with `pnpm --filter @ogm/review-page test` and
`pnpm --filter @ogm/review-page typecheck`.

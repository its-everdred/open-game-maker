# New Game request parent issue

When the New Game flow finishes in the scope chat, Open Game Maker files a parent issue and queues a separate planner
ticket. The parent is the root of the game's Build Order and no worker claims it. Everything raw — the scope
conversation, voice transcripts as text, pastes, attachments and the agreed spec — stays in the app's private storage
and reaches an authorised agent through the internal API described below. Nothing raw reaches GitHub.

## The parent issue

One issue per New Game request, in the game's repository, filed by the intake when the request's `new_game` job reaches
filing:

- **Labels:** `request:new-game` and `feature:gm-<jobId>`. Never a dispatch label — no `<slug>:todo`, no lifecycle
  state — so no daemon queues or claims it. The daemon's dispatch set is the game's `<slug>:todo` label, so a parent
  without it is invisible to workers.
- **Title:** the agreed title, at most 120 characters.
- **Body:** the creation choices as short labelled lines, one paraphrased brief sentence, the game id and the request's
  opaque reference, then a fixed note that the private context is not in the issue. An address-shaped value is
  redacted and the brief is cut at 400 characters. The body ends with the job's markers
  (`<!-- gm-job:<id> gm-ticket:new-game gm-sig:<sha256> -->`), so a retried create is found instead of filed twice.
- The parent itself has no spend cap or aiur nudge. The separate planner ticket receives a spend cap and is queued;
  the request remains active while its worker plans.

The request's opaque reference is its job id. It names the private context but grants nothing on its own: the internal
API needs a scoped token or the internal credential, and the parent issue carries neither.

## Private context

`GET /internal/new-game/requests/:requestId` returns the request's context for an authorised agent:

```json
{
  "request": "j_...",
  "game": { "id": "g_...", "title": "Lantern Bay", "slug": "lantern-bay" },
  "choices": { "genre": "platformer", "vibe": "cozy", "players": "single" },
  "brief": "A cozy island platformer about relighting harbour lanterns.",
  "spec": { "session_id": "s_...", "revision": 1 },
  "revisions": [{ "revision": 1, "agreedAt": "2026-11-04T18:00:00.000Z" }],
  "messages": [
    { "id": "m_...", "at": "…", "actor": "creator", "kind": "text", "text": "Keep it calm at dusk.", "media": false }
  ],
  "designDecisions": [],
  "attachments": [{ "id": "att_...", "kind": "text", "name": "mood-board.md", "mime": "text/markdown", "bytes": 7 }],
  "parent": { "repo": "owner/game", "number": 12 }
}
```

The context is read from the app's own storage — the request and scope-session rows, the append-only chat table (a voice
turn lands there as text, never as audio), the scope revision history and the blob store. `spec` is the latest agreed
scope, `revisions` its agreement history. Only a `new_game` request with a filed parent resolves; an ordinary job is not
a request and returns `404`.

A pasted file or an image's bytes are served one at a time from
`GET /internal/new-game/requests/:requestId/attachments/:attachmentId`, with the row's content type. An attachment id
that belongs to another request is `404`.

### Authorisation

The route accepts either credential and nothing else — a user session cannot read it:

- **Scoped token** in `Authorization: Bearer ngc1.…`. It names one request and its game, lives an hour, and is signed
  with a secret derived from the API's job token secret (domain-separated), so no extra secret is distributed. A token
  minted for another request is `403`. A token never goes to GitHub.
- **The internal credential** in `x-ogm-internal`, the same shared secret the API already accepts for internal calls.
  The Executor's unit carries it.

`POST /internal/new-game/requests/:requestId/token` mints a scoped token and needs the internal credential. It returns
`{ request, game, token, expiresAt }` with `201`. The planner's workspace relay instead delivers context and attachments
after verifying its ticket, game and workspace grant against the active request's recorded planner ticket.

Credentials are checked before the request's existence: an unauthenticated caller gets `401` and learns nothing about
which request ids exist.

## Automatic planning

Intake creates one planner ticket linked to the parent, records it durably, sets its spend cap, and queues it on the
game's daemon. Its worker uses `gm-new-game-plan` and the configured first-playable ticket limit. The workspace relay
grants only the recorded, active planner ticket access to that request's private context. The planner submits each
child through the same relay: normal admission reserves its budget, enforces the per-game ticket limit atomically,
and files the child with its own spend cap. The child gets its todo label behind a dependency on the parent; when an
edit slot opens, intake removes that gate and dispatches it using the planner's verified checkpoint. Reusing a child key
returns the same job. The intake GitHub credential needs permission to manage issue dependencies and to create and read
Git refs in the game repository. The API retains a checkpoint ref so a delayed child can start after the planner's
branch is removed.

A registered daemon uses its own trusted workspace hooks. Before using it for New Game planning, install the current
`gm-new-game-plan` skill and its scripts in every worker workspace, call
`node <ogm-core>/scripts/preview/repository-hook.ts create` from `after_create` after cloning and from `before_run`,
and call the same script with `remove` from `before_remove`. The create hook verifies the issue, binds the grant to
that workspace, and prepares a planner child's checkpoint and current answers before it runs; the remove hook revokes
the grant. The worker cannot retrieve context or submit children until this host setup is in place.

Two invariants keep a worker off the parent:

1. The parent carries no label in the daemon's dispatch set. A game daemon dispatches on `<slug>:todo` and reads only its
   own lifecycle states; `request:new-game` is neither.
2. The request's active job points to the planner ticket, not the parent, so chat reaches the planner worker.

If filing fails — GitHub unavailable, or the summary missing — the request stays `admitted`, the intake alerts, and the
sweep retries. A create whose outcome is unknown is recovered by its marker rather than filed a second time.

The intake runs the game's daemon preflight before filing the parent, so the daemon is ready for the planner and its
children. Retries reuse the parent and planner markers and resume from their saved cap and queue checkpoints.

## Editor changes are not requests

Only the New Game flow produces `request:new-game`. A chat request from an existing game's editor is a `feature` job: it
files one ordinary ticket with its dispatch label, spend cap and aiur nudge, for one agent. The parent path is guarded
on the job's `new_game` kind, so an editor ticket can never carry the request label.

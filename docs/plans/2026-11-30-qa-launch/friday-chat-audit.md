# Friday chat audit (2026-11-27, ~16:40–17:30Z)

Kevin's Friday priority: chat in the app, with voice, wired to the real agent tickets; New Game hands its answers to a
real agent that starts work with aiur's existing skills, first playable within an hour.

**Prod state at audit time:** the app is deployed at `7fa61d309` (auto-update.log `2026-11-27T13:14:45Z ogm: deferred web
deploy done 7fa61d309`). The API runs from `~/ogm-stack` at `7fa61d309` (restarted 06:53Z); main is at `ba1d80842`. Fleet:
core `AGENTS 7/6`, and every Friday ticket (#1110, #1403, #1413, #1417, #1418, #1450) is `awaiting-dispatch, backing_off`.
#1412 is the only one with a workpad (no PR).

Evidence sources: prod DB `~/.local/share/ogm/data/ogm.sqlite3` (read-only), `~/ogm-stack.api.log`, QA logs in
`~/.local/state/ogm/qa/`, `aiur-main status|commands` on both daemons, and the source at `7fa61d309`. Nothing was created
on prod: every probe here was a read. The two code-reading findings (marked *code*) are not proven live.

| # | Item | Verdict |
|---|---|---|
| 1 | Typed chat (edit page, New Game) | **MISSING**: never once reached an agent on prod |
| 2 | Dictation | **PARTIAL**: short clip passes, long dictation unproven, weak check |
| 3 | Two-way voice | **WORKS** (scripted), not proven on a ticket |
| 4 | Ticket chat | **PARTIAL**: progress view works, thread empty, no send |
| 5 | Persistence | **PARTIAL**: stored server-side, never proven leave/return |
| 6 | New Game → agent → first playable | **MISSING** |
| 7 | Non-blocking Commands | **PARTIAL**: supported, but late answers are mooted, not delivered |

---

## 1. Typed chat: MISSING

**Edit page.** The first message admits a `feature` job (`apps/web/src/features/build-chat/Chat.tsx` → `POST /api/v1/jobs`).
The intake (`services/builder/src/intake/file-job.ts`, inside the API) files a ticket, and later messages go through
aiur `messages`.
- Prod DB, `jobs`: 424 rows since 11-08. 423 are operator publish jobs and **0 has an aiur ticket**
  (`aiur_issue_number` is null on all of them). The only creator edit job is `j_2c5ec08f…` ("hi", Dusk Helm, 11-23),
  state `failed`.
- `build_chat_messages`: 9 rows ever, all `actor=creator`, all `mirror_state=pending`, 11-19. **No agent reply has ever
  been stored.**
- API log: every edit job ever failed preflight.
  - 4 × `job_intake_alert preflight_failed "blobs: missing .aiur/config"` (11-19).
  - 1 × `"systemctl --user start ogm-aiur@dusk-helm.service exited 5: … not found"` (11-23 02:01Z).
- The Dusk Helm failure was fixed 3 h later by `a2ba9871b` ("Share a registered daemon, never provision beside it",
  #1270). No edit message has been sent since, so the path is **unexercised, not proven**.
- The relay that brings worker media into the chat is off on prod. Every boot logs
  `{"event":"chat-relay-disabled","missing":"OGM_BUILDER_WORKSPACES_ROOT"}`, last at the 06:53Z boot: `api.env` has
  `OGM_BUILDER_WORKSPACES_ROOT=` (empty in every backup too).
- Kevin's re-scope (core #1427 update, 11-26) replaces this path: the editor chat opens an on-demand aiur agent
  conversation with no ticket.

**New Game scope chat.** `POST /api/v1/game-drafts` files a "Temporary game scope conversation" issue and chats with it.
- **Never used on prod:**
  - the API log has 0 `/api/v1/game-drafts` requests since the route shipped (`0a329c13a`, 11-21);
  - `game_drafts` and `scope_sessions` hold 0 rows;
  - `its-everdred/open-games` has 0 issues titled "Temporary game scope conversation".
- *code* **Wrong-daemon bug:** `services/api/src/main.ts:166` files the draft issue in `OGM_INSTANCE_REPO`
  (`its-everdred/open-games`), then calls `enqueueTodo([N])` on `coreAiurClient`. That client is `AIUR_API_URL`
  `127.0.0.1:4010`, the **core** daemon, which tracks `its-everdred/open-game-maker`.
  `build-chat/job-directory.ts:71` routes the draft chat to `{ daemonSlug: 'core', ticket: N }`. A creator's scope
  messages would go to core issue #N, an unrelated ticket, or fail.
- **Gap and owner:** core #1450 (editor chat as an aiur conversation; needs aiur #8154, in progress, and #8157). The
  New Game draft bug has **no ticket**: file one (core) or fold it into #1412.
- **Shortest path:**
  1. Point the draft assistant at the open-games daemon client (or file the draft in core). That is a one-line choice.
  2. Set `OGM_BUILDER_WORKSPACES_ROOT=~/.aiur/w` in `api.env` and restart the API (Executor host step, after Kevin is
     told).
  3. Send one real edit message on Blobs or Dusk Helm and watch for a ticket, `mirror_state=sent` and an agent row.

## 2. Dictation: PARTIAL

- The last `qa-voice-e2e` (`~/.local/state/ogm/qa/voice-e2e/2bf10f7face7.log`, 11-27 03:55Z) passed:
  `dictation pass: Make the sky blue。` (3.2 s clip).
- The 11-24 run (`2f4c0698b837.log`) failed: `dictation fail: the message box shows "Make this guy-"`.
- **The check is weak.** `packages/gm-cli/src/qa-voice-e2e.ts:16`: "the box must show at least one of its words". A
  truncated transcript passes as long as one word lands. The clip is one short sentence, so the long-utterance
  truncation Kevin hit is untested.
- It ran on `2bf10f7`. No voice check has run on the deployed `7fa61d309`.
- The prod log's last voice requests are `POST /api/v1/voice/token 403` and `/voice/dictation-token 403`, beside
  `GET /api/v1/jobs 403` and `/me/core-commands 403`, at line 213077, today. Some signed-in account is refused voice:
  this is #1413's "every eligible user".
- **Owner:** core #1403 (`agent:todo`, backing off), which depends on core #1087. **#1087 carries `pc:queued,pc:todo` and
  no `agent:*` label, so it cannot dispatch on the NUC.** CLAUDE.md says to move `pc:*` tickets to `agent:*`. That is
  the first unblock.
- **Shortest path:**
  1. Relabel #1087 `agent:todo` and `--todo` it.
  2. Make the dictation check need ≥ 90 % of a 10–15 s clip's words (in #1403's scope).
  3. Kevin says a long sentence on his iPhone.

## 3. Two-way voice: WORKS (scripted)

- `2bf10f7face7.log`: `two-way pass: agent audio 17 frames, 121.9 s played; stored 2 turns`; the transcript is "Hello?
  Can you hear me?" and the agent replies.
- The test target is a QA job (`QA_VOICE_ISSUE`, `services/api/src/qa/voice.ts:55`), not a real worker ticket. The voice
  agent channel is `fork: :none` (#1110 body), so it cannot consult the worker's own session.
- **Gap:** two-way voice on a ticket chat and on New Game (core #1413; forked voice in aiur #8082).

## 4. Ticket chat: PARTIAL (read progress yes, conversation no, send no)

- **Works:** the edit menu tracker opens any running ticket, job-less ones included (`#1330`, merged 11-25, live).
  `GET /games/:id/tickets/:n/detail` answers 54 × 200 on prod: status, live activity, summary, PR/CI, worker media and
  timeline from aiur's ticket detail (#8043). Progress is visible.
- **Thread is empty in practice:** `createTicketConversationReader` (`services/api/src/worker-progress/conversation.ts`)
  shows only GitHub comments tagged `<!-- gm:creator-visible -->` and drops workpads and `aiur:agent-authored`
  comments.
  - No skill or prompt tells workers to write that tag. It appears in 4 open-games issues ever, all closed.
  - The `/conversation` route has **0 requests** in the prod API log.
- **Send: missing.** No app route posts to a job-less ticket. Job-owned chats send through aiur
  `POST /api/v1/<n>/messages`, which works today with `listen-mode steer|sync`; the core build chat already uses that
  client. So **not only aiur #8082:** step 2 (plain text send, delivered on the next turn or by steer) could ship now on
  the existing aiur message API.
  - #8082 adds attachments, delivery receipts, worker media in the thread, verdicts and forked voice.
  - Its send and read slices are pushed (`feat/ticket-thread-send` @ 25248d8151), with no PR (aiur #8082 comment
    11-27 12:48Z).
- No `qa-ticket-chat` check exists (`packages/gm-cli/src/commands/qa/` has none): core #1417, backing off.
- **Owners:**
  - core #1110 (`agent:rework`, backing off, still carries `needs-triage`);
  - aiur #8082 on the PC: open PRs from the pushed slices;
  - core #1417 for the check.
- **Shortest path:**
  1. Open the #8082 PRs.
  2. Meanwhile, #1110 step 2 sends via the existing `messages` API.
  3. Read the thread from aiur's ticket transcript (`ticketTranscript`, already in the client), not GitHub-tagged
     comments.

## 5. Persistence: PARTIAL

- Stored server-side:
  - build chat in `build_chat_messages` (9 rows survive since 11-19);
  - voice turns (`stored 2 turns`);
  - scope drafts in `game_drafts`;
  - ticket detail comes from aiur.
- Not proven: no real conversation has ever existed to leave and reopen (items 1 and 4). The edit chat starts a fresh
  `sessionId` after each completed job (`apps/web/src/routes/game/EditConversation.tsx`).
- The Executor thread (`/me/executor/thread`) never worked on prod: 1469 × 403, 44 × 404, 1 × 502, 1 × 503, 0 × 200.
  aiur #8034 is open; core #1349 logs `executor_notify_error` (4547 times in the last 20k lines).
- **Owner:** #1450's done line ("closing and reopening the app resumes the conversation"), with no test yet.

## 6. New Game: MISSING

- **Today after Finish:** the draft is agreed → the game is created → a `new_game` job → the intake files a
  `request:new-game` parent and stops. "Only the Executor plans from it" (`docs/reference/new-game-request.md`). No agent
  gets the form context automatically. The private context is served at `GET /internal/new-game/requests/:id` and
  needs the internal token or a scoped token (`services/api/src/new-game/token.ts`).
- **Prod E2E has never passed.** `~/.local/state/ogm/qa/new-game-e2e/ed58582f20b1.log` (11-26 15:03Z):
  `missing API, repository, internal token or QA session configuration`. The cause is that `OGM_QA_INSTANCE_REPO` is
  absent from `api.env`.
  - It needs a separate QA repo with the commit GitHub App installed (runbook §"Check new game creation").
  - That is not a one-line fix, so I didn't change it.
  - #1402 turned it into a headless test (draft PR #1465, human-review).
- **Planner:** core #1412 is in rework with a workpad and no PR. It is building in `gm-new-game-plan`; the open design
  point is a request-scoped credential for the worker. aiur #8137 is closed.
- **Where the skills live, and why a worker can't use them today:**
  - `research-spike` and `build-order` live in `~/github/skills` (the everdred skills repo), linked into
    `~/.claude/skills`.
  - `aiur-build` lives in the aiur release (`~/.aiur/ogm-release-src/.claude/skills/aiur-build`).
  - aiur maps skills by label (`agent.skills.by_label` in `~/games/open-games/.aiur/config`). It loads them from the
    **workspace's** `.claude/skills` (`src/lib/aiur/agent_skills/registry.ex`). Open-Games workspaces get that folder
    from `executor/materialize-workspace.sh`, which copies `~/ogm-stack/skills`: the gm-* skills plus vendor.
  - aiur adds `aiur-agent` and `ce-*` (`.agents/skills`).
  - **None of the three is in an Open-Games worker workspace.** Checked `~/.aiur/w/its-everdred/open-games/23`.
  - `role:game-design` maps to `[gm-core, gm-new-game-design, gm-new-game-plan, gm-image-mock, gm-scope-options]`.
- **Shortest reuse path to a first playable in under an hour:**
  1. Vendor `research-spike`, `build-order` and `aiur-build` into core `skills/vendor/`, through `skills.lock` as for
     impeccable, so the next core bump materializes them.
  2. Add a by-label entry, e.g. `"request:new-game": [gm-core, gm-new-game-plan, research-spike, build-order, aiur-build,
     gm-prototype]`, in the open-games config (hot-reload).
  3. #1412's dispatch adds `agent:todo` (with `--todo`) to the filed parent, plus a scoped context token.
  4. Hand the first playable to the starter template (core #1418: playable the moment create finishes) plus one
     `phase:prototype model:low` ticket the planner files first. The fuller Build Order files behind it via
     `aiur-main queue add`.
  5. Creator questions go out as non-blocking Commands with `--recommend` (item 7).
  6. Fix the draft-assistant daemon bug (item 1) first, or the scope chat never reaches an agent at all.
- **Owners:**
  - core #1412 (planner, rework);
  - core #1418 (first playable, `agent:todo`);
  - core #1402 (test);
  - the skills vendoring has no ticket: add it to #1412 or file a core ticket;
  - the draft daemon bug has no ticket.

## 7. Non-blocking Commands: PARTIAL

- **Supported in aiur:**
  - `aiur command request <q> … [--recommend id] [--blocking]` (`aiur-main help`): blocking is opt-in, and
    `--recommend` records a recommended option with a reason.
  - The decision store redelivers undelivered answers to the ticket's next worker (`deliver_pending_answers`,
    `src/lib/aiur/decision_store.ex:322`) and records overrides before or after delivery (`:267`).
  - aiur #7872 (non-blocking Commands expiring at turn end) is closed.
- **Live on the games daemon:** 5 of 7 open Commands are `blocking:false`; 3 carry a `recommendation`, e.g.
  `dec_261a07db533dea1c` on #994: `option_id:"present"`. Non-blocking ones don't park their ticket. The blocking one,
  #1085, shows `agent:paused-decision … blocked_on_decision`.
- **But late answers rarely reach a worker:** of the last 40 resolved Commands there, **39 are
  `[non-blocking, moot, not_dispatched]` and 1 is `resolved, consumed`**. All 7 open ones are
  `delivery_status:not_dispatched` and `route_state:with_executor`.
  - There is no "apply the recorded default on timeout" behaviour; the worker just ships its recommendation.
- **OGM UI:** in-app answering works (`/games/:id/commands/:id/answer`; `qa-review-e2e` passed at 4 sizes on
  `2bf10f7face7`, 11-27 03:54Z). Kevin still answers on the artifact page.
- **Gap and owner:**
  - aiur: deliver a late answer to the ticket's next turn instead of mooting it. File it on aiur, PC session.
  - core #1110 step 6 (verdicts in the thread).

---

## Live URLs for Kevin's phone
- **New Game:** https://weaver.makeopen.games/new. Expect the scope chat to fail or hang (item 1's daemon bug); it has
  never run on prod.
- **A real ticket conversation:** https://weaver.makeopen.games/dusk-helm/edit → edit menu → work row "Wizard: two builds,
  fire/ice/lightning starting spells, ranged defense" (open-games #12, `waiting=active` at 17:05Z) → Conversation.
  - It shows status, activity, summary, media and the timeline.
  - The message thread will be empty and there is no send box (item 4).
  - Alternative: open-games #23 "Second wilderness stage (forest)".

## Top gaps, in order
1. **No chat has ever reached an agent from the app.** Owners:
   - core #1450 (editor and bug chats as aiur conversations), which needs aiur #8154 (in progress, PC);
   - an unfiled core bug for New Game drafts enqueued on the core daemon;
   - `OGM_BUILDER_WORKSPACES_ROOT` is empty (Executor host step).
2. **Ticket chat can't send and shows no worker text.** Owners: core #1110 (send via the existing aiur `messages` API
   now; read the aiur transcript) and aiur #8082 (pushed slices → PRs, PC).
3. **The voice chain is stalled.** Core #1087 carries `pc:*` labels, so it can't dispatch, which blocks #1403
   (dictation). #1413 (voice everywhere) faces unexplained voice-token 403s on prod. The dictation check passes on one
   word.

Also: the core fleet is at 7/6, and every Friday ticket is backing off for a slot.

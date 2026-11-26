# QA launch plan: Mon 2026-11-30 09:00 PT

Status: **proposal.** Nothing has been filed, labelled, paused or queued; Kevin approves first.
Written 2026-11-26 13:30Z (Thu 05:30 PT). Deadline Mon 17:00Z, about 100 hours away.

Refs: `core #N` = its-everdred/open-game-maker issue N, `og #N` = its-everdred/open-games, `aiur #N` = aiur-team/aiur.

Kevin's goal (2026-11-26): set up the full flow before inviting QA testers to weaver.makeopen.games to play Blobs and
create new games.

## 0. What the probes found (13:00–13:30Z)

- **Prod freshness is fine.** The app was last deployed at 328c6688e (11-25 18:04Z), which includes the new play and
  editor menus. All four games published 11-26 (`prod-freshness.py`: ok).
- **New Game has never passed its prod check.** `ogm-qa new-game-e2e` ran 13 times since 11-18 and never passed: 11 runs
  stopped on "missing API, repository, internal token or QA session configuration" (since 11-23), 2 timed out and 1 got
  a 502 on create. Nothing runs it daily (no timer).
- **New Game is Executor-gated.** The New Game flow ends by filing a `request:new-game` parent issue, and "only the
  Executor plans from it" (`docs/reference/new-game-request.md`). A tester's game gets no Build Order until Claude plans
  it by hand. That cannot work for testers.
- **Voice is half green.** The last `qa-voice-e2e` (11-24 04:35Z) shows two-way voice passing (16 frames of agent audio,
  2 stored turns). Dictation failed: the message box showed "Make this guy-" instead of the clip's words. The last full
  pass was 11-23. iPhone two-way voice was fixed in core #1325 (Safari audioSession).
- **Review E2E passes on prod** (last pass 11-25 10:11Z). In-app parity merged (core #1124, closed 11-24). Kevin still
  reviews on the artifact page.
- **Ticket agent chats are blocked upstream.** Core #1110 shipped step 1, the read-only thread. Steps 2–7 (send,
  images, verdicts, voice) wait on aiur #8082, the per-ticket worker thread for host apps. That ticket is `agent:todo`
  with no PR. Its sibling aiur #8132 (reskinnable components) closed today.
- **The Claude Design menus already shipped.** The 11-24 Claude Design mock "Editor + Play Menus" (phone portrait and
  landscape) became core #1326 (PR #1337, merged 11-24 14:33Z, live). Two follow-ups are parked: core #1333 (web bug
  reports never send because game routes lack a buildHash) and core #1334 (bug screenshot and mic). No proposal for the
  other screens (home and game list, New Game, settings, admin) exists.
- **Energy has the parts but no per-user weekly budget.** Contracts and API have family budget settings, a *daily*
  per-user `Allowance` and a per-user budget ledger (`services/api/src/budget/`). The Energy meter (core #1217) and
  admin dashboard (core #1219, `/admin/energy`) are live. Missing: a weekly window, an admin-set budget per user,
  enforcement at job admission and a creator-facing "remaining" view. aiur #7893 (`aiur.capacity`) closed today, which
  unblocks core #1220.
- **Blobs has Endless and CPU, but online play doesn't work yet.** Endless and the versus-CPU code (`features/cpu/`,
  three presets) are on main. The online two-client run in og #1025 failed at the host: "Play absent after 90 s", two
  404s, and the game adapter is "seat-table-only; create/join/start are no-ops". The worker also needs proof that the
  rooms WSS (`:8443`) and games host (`:10000`) are reachable from outside. 25 Blobs look tickets sit in `needs-triage`.
- **Coming Soon doesn't exist.** Games have `visibility: listed | private` plus per-game grants
  (`packages/policy/src/authorize.ts`). There is no coming-soon state.
- **Capacity:** Codex is at 20 % of its weekly window (resets 12-02), so there is room. Claude is at 98 % (resets Fri
  11-27 09:00Z = 01:00 PT), so the Executor stays in monitor mode until then. NUC load is 63–68 with 3 + 4 workers.
  The daemon status RPC timed out during this spike.
- **Deploy cap:** app deploys are limited to 1 an hour and none 23:00–05:00 PT. The last app deploys before launch are
  **Sun before 23:00 PT** and **Mon 05:00–09:00 PT** (4 slots). Game publishes have no cap.

## 1. Scope items: done, state, gaps, existing tickets

Every item is done only when **(a)** its scripted prod check passes in the post-deploy hook **and (b)** Kevin completes
it on his phone (the signed-in prod app). A merge alone doesn't count.

### S1. New Game creation flow (OGM + Open-Games)
- **Done:** A tester account goes New Game → scope chat (text or voice) → Finish. A playable first build then opens in
  the edit page within **≤ 60 min**, with no Executor action. The edit menu shows the first build ticket's progress
  %, and a notification arrives when it's playable. `ogm-qa new-game-e2e` passes at 390x844 and 844x390 and cleans up
  after itself.
- **State:** the create fixes landed (core #904, #983, #986, #990, #994, #1040; closed). The composer is in the scope
  chat (core #1084). The prod E2E never passed (see §0). Planning is Executor-only.
- **Gaps:** the E2E config and a daily run; an automatic planner; a first-playable path that doesn't need a full Build
  Order; per-tester limits (S6); review cards reaching the tester (S3).
- **Existing:** core #1351 (New Game form: separate look, camera and setting) → **keep at mock phase, P2**. It isn't
  needed for launch, and changing the form now adds risk.

### S2. Voice: one-way (dictation) and two-way
- **Done:** on Kevin's iPhone (home-screen app) and one Android phone, on prod:
  - dictation puts the spoken words in the composer on the New Game, edit chat, file-a-bug and ticket chat surfaces;
  - two-way voice holds a 3-turn conversation in the edit chat;
  - `qa-voice-e2e` passes dictation and two-way after every deploy.
- **State:** two-way voice passes on prod. Dictation fails (truncated text). The merged aiur composer (aiur #8049,
  merged 11-26) isn't re-pinned yet. Kevin's direction: reskin aiur's component and build no parallel OGM voice code.
- **Existing:**
  - core #1087 (re-pin and skin `@aiur/conversation`), `agent:todo`, `slot:voice-review` → **priority:1, first in core**.
  - core #1223 (composer error detail), human-review → close after the #1087 proof.
  - core #932 (one composer everywhere), the `agent:error` parent → close when #1087 lands.

### S3. Full in-app review UX (retire the artifact page)
- **Done:** every card type on the review page works in the app on Kevin's phone, for a whole day of real reviews:
  - single pick, A–E multiple choice, swipe, matrix, play slice, phase approve and notes;
  - each card's ticket opens its chat;
  - a push notification arrives when a review is ready.

  The Executor relay is then switched off and the page retired. Testers see review cards for **their own** games only.
- **State:** parity merged (core #1124); review E2E green on prod. Push isn't delivered: core #1349 (operator.notify
  never reaches Kevin), unblocked by aiur #8117 merged 11-26. The outcome gate core #1396 is in progress.
- **Existing:**
  - core #1349 → **priority:1**.
  - core #1396 → keep P1.
  - core #1374 (make the artifact page's build and relay deterministic) → **pause.** It invests in the page this item
    retires. Keep the current relay agent running until retirement instead.

### S4. Ticket agent chats
- **Done:** from an edit-menu work row or a review card, Kevin sends text and an image to the running worker. The worker
  receives it during its turn (native steer), replies with media, and a verdict given in the thread reaches the worker.
  Dictation works in the thread. A `qa-ticket-chat` prod check passes.
- **State:** step 1, the read-only thread, is shipped (core #1110). Steps 2–7 are blocked on aiur #8082.
- **Existing:**
  - aiur #8082 → **aiur P0** (on the PC's aiur session).
  - core #1110 → priority:1, dispatched the hour aiur #8082 merges.
  - aiur #8034 (Executor thread) → after launch.

### S5. Claude Design menus redesign
- **Done:** a Claude Design proposal covering every tester-facing surface (home and game list, New Game, play menu,
  edit menu, settings and Energy, admin users) in phone portrait and landscape. Kevin reviews and picks per screen. The
  approved screens are implemented and checked with phone stills of the published app (portrait and landscape) against
  the mock.
- **State:** play and editor menus are done (core #1326). The rest has no proposal. See decision D1.
- **Existing:**
  - core #1333 (bug reports fail validation: no buildHash) → **unpark, priority:1**. Testers' only feedback channel is
    broken.
  - core #1334 (bug screenshot and mic) → **unpark, priority:1.**

### S6. Energy basic: weekly budget per user
- **Done:**
  - an admin opens Admin › Users and sets a weekly budget on one user;
  - that user's new-game, edit-chat and fix jobs charge it;
  - at zero, the app refuses a new job with a clear Energy-empty state (no generic error);
  - the creator's Energy ring shows remaining and reset time;
  - a `qa-energy-budget` prod check sets a tiny budget on the QA account and proves the refusal.
- **State:** a daily per-user allowance and a per-user ledger exist. Admin Energy (provider caps) is live. There is no
  weekly per-user setting and no enforcement path on the job routes the testers use.
- **Existing:**
  - core #1220 (read `aiur.capacity`) → P2, now unblocked.
  - core #1253 (Save/Balanced/Best) → after launch.

### S7. Blobs: Endless, vs NPC, 2-player online
- **Done:**
  - on prod, from a phone, Endless runs from title to game over to retry, and versus CPU plays a full match at each
    difficulty; both are scripted journeys in `qa-game-play` for Blobs, at 390x844 and 844x390;
  - online: two real phones on different networks create, join and ready up, start in sync, and a combo sends garbage
    to the other player; reconnect works;
  - the combo-to-trash clip is recorded (og #1025);
  - the launch polish set (below) is fixed.
- **State:** Endless and CPU are on main. The online hosted run fails (see §0). The play check passes for Blobs.
- **Existing:**
  - og #1025 → priority:1, resumed after the new rooms-hosting ticket B3.
  - Launch polish, re-queued as priority:1 (each is visible in a tester's first minute): #711 (GO overflows the
    board), #710 (P2 board floats loose), #663 (tiny back and settings pills), #698 (host Pause shows on menus), #657
    (selected character missing in portrait), #819 and #881 (tablet plaques).
  - og #996 (jiggle physics), #512 (faces) and #992 (face check) → let the in-flight turn finish, then P2. They are
    look experiments, not launch blockers.
  - og #817 and #784 (Blobs test flakes) → P2.
  - core #1362 (site two-phone section) → after launch.

### S8. Dusk Helm "Coming Soon"
- **Done:** a game can be set to `coming_soon` by its owner or an admin. Everyone else sees its card with a "Coming
  Soon" badge but can't open play, edit or its build URLs (the API refuses with 403; the games host refuses unsigned
  build fetches). Kevin's account plays normally. Release flips it to listed. Dusk Helm is set to `coming_soon` on prod.
  The prod check uses the QA account (refused) and Kevin's own session (allowed, checked by hand).
- **State:** nothing exists. It's a small change on top of `visibility` and per-game grants.

### S9. QA tester readiness
- **Done:**
  - Kevin invites a tester by email from Admin. The tester signs in from the link on a phone, lands on a first-run
    screen pointing at Blobs and New Game, and can file a bug from the play menu that reaches a triaged GitHub issue.
  - Blobs' first load is ≤ 8 s on 4G and its second load ≤ 2 s on a mid Android.
  - One `ogm-qa launch` command runs every launch check and is green at Mon 08:00 PT.
- **State:** invites, roles and the sign-in link exist (core #514, #52). `ogm-qa signin` exists. Bug reports are
  broken (core #1333). Crash telemetry is live (core #1318). Device proof is still open (core #340).
- **Capacity risk:** every tester's New Game and edit chat becomes Codex work on the Open-Games daemon, sharing 4 slots
  with Blobs and Dusk Helm. Without a reserved creator lane and per-tester caps, testers queue behind fleet work
  (made worse by the priority-inversion bug, aiur #8142).

### S10. Marketing site and docs (added by Kevin 2026-11-26)
- **Done:** makeopen.games serves Assembly Line mock B, live on Netlify, checked with phone and desktop stills:
  - copy says "assets", never "packs";
  - hero: "Game Factory that Supports Humans" / "bring human art, agents write code.";
  - sections "Get your hands dirty" (the editor) and "Support Every Device";
  - an animated element in each section;
  - the two-phone Blobs multiplayer section (core #1362);
  - the curated-tools value point added 11-26.

  `makeopen.games/docs` serves human and agent docs with a toggle, in aiur-docs structure and the yellow style (core
  #1361). `makeopen.games/blobs` and `/duskhelm` (with and without hyphens) open the game (core #1397). For Dusk Helm,
  the link respects Coming Soon (S8).
- **State:**
  - **site:** makeopen.games is live (200, title "Open Game Maker 2000"). Mock B was approved to prototype on 11-26
    07:13Z, and core #1355 is in human-review;
  - **docs:** `/docs` returns 404. Core #1361 is mid-work: its image-broker mocks were refused, and the Executor
    redirected it to real HTML in the mock-B style;
  - **short links:** core #1397 is `agent:todo`, model:low;
  - **multiplayer section:** core #1362 needs the real recording from og #1025, which needs public rooms (B3).
- **Gaps:**
  - the hero copy, the two named sections and per-section animation aren't in any ticket body (Kevin's 11-26 words);
  - the multiplayer section has no fallback if online play misses.
- **Deploy limit:** the site and the app each deploy at most once an hour, none 23:00–05:00 PT. Batch site changes.

## 2. Proposed new tickets (24 work tickets, 10 epics)

Each scope item gets a **GitHub epic in core plus an aiur feature** (systems-as-epics, core #1399). The epics are
S1 New Game launch, S2 Voice launch, S3 In-app review, S4 Ticket chats, S5 Menus redesign, S6 Energy budgets, S7 Blobs
launch (in og), S8 Coming Soon, S9 QA readiness and S10 Site and docs. All work tickets carry `priority:1` and `launch:2026-11-30` (a new
label used to sort the queue). Core tickets are web, API or ops work, so they get no `game:` label.

| # | Title | Repo | Labels | Done | Depends on |
|---|---|---|---|---|---|
| NG1 | New Game prod E2E: restore the post-deploy hook (config missing since 11-23), run it daily, pass portrait and landscape | core | role:qa, model:medium | `qa-new-game-e2e` green twice in a row on prod, with a systemd timer | — |
| NG2 | New Game auto-planner: a filed `request:new-game` parent dispatches a Codex plan ticket (gm-new-game-plan) that files the game epic, aiur feature and ≤3 first-playable tickets with caps; no Executor step | core | role:engine, model:high | a QA-created game reaches agent:todo tickets in ≤10 min with no human action | aiur #8137, NG1 |
| NG3 | First playable status: the template build is playable the moment create finishes; the edit menu shows the first ticket's % and pushes "playable" | core | build-lane:web, model:medium | stills and push on prod for a QA game | NG2, core #1349 |
| V1 | Dictation on prod: fix the truncated transcript ("Make this guy-") and the composer's final-text commit | core | slot:voice-review, model:medium | `qa-voice-e2e` dictation passes 3 runs in a row; Kevin's iPhone | core #1087 |
| V2 | Voice on every tester surface: New Game, edit chat, file a bug, ticket chat; add the surfaces to `qa-voice-e2e` and add an Android Chrome run | core | role:qa, model:medium | all 4 surfaces green in the hook | V1, core #1334 |
| R1 | Retire the review page: run a parity audit of every card type on Kevin's phone; switch off the relay once one full day passes without the page | core | slot:voice-review, model:medium | Kevin's day of in-app reviews; relay agent stopped | core #1349, #1396 |
| R2 | Review cards and Commands reach each game's own creator (testers see only their games; Kevin sees all) | core | build-lane:web, model:high | the QA account sees its game's card and not Blobs' | NG2 |
| C1 | `qa-ticket-chat` prod check: send text and an image to a running QA ticket, get the worker's reply with media, give a verdict in the thread | core | role:qa, model:medium | green in the hook | core #1110, aiur #8082 |
| D1 | Claude Design proposal: every tester-facing menu and screen (home and games, New Game, play and edit menus, settings and Energy, admin users), phone portrait and landscape | core (Executor, Claude Design) | phase:mock | Kevin's per-screen picks on the review page | Claude reset Fri 01:00 PT |
| D2 | Build the approved menus: home and game list, plus the New Game screens | core | build-lane:web, phase:build, model:high | published-app stills match the mock | D1 pick |
| D3 | Build the approved menus: play and edit menu revisions | core | build-lane:web, phase:build, model:medium | as D2 | D1 pick, core #1334 |
| D4 | Build the approved menus: settings, Energy and admin users | core | build-lane:web, phase:build, model:medium | as D2 | D1 pick, E1 |
| E1 | Weekly per-user Energy budget: admin sets it per user (Admin › Users); weekly ledger window; enforced at admission for new game, edit chat and fix jobs; Energy-empty state; ring shows remaining | core | build-lane:backend, model:high | `qa-energy-budget` refusal proof on prod | — |
| E2 | Charge real cost: each user's jobs charged from aiur per-ticket usage (tokens → estimate), reconciling the reservation | core | build-lane:backend, model:medium | ledger rows match aiur usage for one QA job | E1, aiur (verify per-ticket usage) |
| B1 | Blobs Endless journey on prod: title → Endless → play → game over → retry, portrait and landscape, in `qa-game-play`; fix what it finds | og | game:blobs, role:qa, model:medium | green after each publish | — |
| B2 | Blobs vs CPU journey on prod: each difficulty plays a full match to the win or lose screen, in `qa-game-play`; fix what it finds | og | game:blobs, role:qa, role:gameplay, model:medium | green after each publish | — |
| B3 | Public rooms for the app shell: rooms WSS and games host reachable from outside (TLS); the host room adapter implements create, join and start (today no-ops) | core | role:multiplayer, model:high | two-client hosted run passes `gm qa multi-device` against prod | host step (Executor: Funnel/TLS) |
| CS1 | Game release state `coming_soon`: listed card with badge; play, edit and builds only for owner, admins and grants; Release action; policy, API and games-host enforcement | core | build-lane:backend, build-lane:web, model:medium | QA account refused; Dusk Helm set on prod | — |
| Q1 | Tester invite and first run: email invite → sign-in link → first-run screen (Blobs, New Game) on phone; extend `ogm-qa signin` | core | build-lane:web, model:medium | scripted invite-to-play on prod | — |
| Q3 | Tester bug triage: sent reports become `needs-triage` issues (reporter anonymized, build, logs, screenshot) and notify the Executor | core | build-lane:backend, model:medium | a QA report lands as an issue | core #1333 |
| Q4 | Phone performance gate: first and second load and frame time for the app shell and Blobs on a mid-range Android profile, in the hook | core | role:qa, model:medium | budgets met or tickets filed | core #340 |
| Q5 | `ogm-qa launch`: one go/no-go command running every launch check (S1–S9) and posting a pass table | core | role:qa, model:low | green Mon 08:00 PT | NG1, V2, C1, B1, B2, CS1, Q1, E1 |
| Q6 | Creator lane: tester jobs run on reserved worker slots, one job in flight per tester, queue position shown | core | role:engine, model:medium | two QA accounts' jobs don't wait behind fleet work | aiur #8115, #8142 |
| M1 | Site copy and motion to Kevin's 11-26 words: hero "Game Factory that Supports Humans" / "bring human art, agents write code."; "Get your hands dirty" and "Support Every Device" sections; one animated element per section; "assets", never "packs" | core | build-lane:web, phase:build, model:medium | live stills (phone and desktop) on makeopen.games | core #1355 |

Core #1362 gets a fallback in its body: if no real recording exists by Sun 12:00 PT, show the Endless and
versus-CPU clips and leave the two-phone animation for after launch.

`D1` is an Executor task, not a worker ticket: Claude Design after the Fri 01:00 PT reset. It is tracked on the S5
epic.

## 3. aiur work (on the PC's aiur session; Executor may merge via the merge queue)

| aiur | What | Blocks | Priority |
|---|---|---|---|
| #8082 | Per-ticket worker thread for host apps: send with attachments, live steer, worker media, verdicts, forked voice; components to the #8132 contract | S4 entirely (core #1110 steps 2–7, C1) | **P0, start now** |
| #8142 | Freed slots go to non-priority tickets while a priority:1 ticket waits | every launch ticket's dispatch order | **P0** |
| #8137 | Feature create refused by the allowlist on the OG daemon (fix PR #8139 approved) | the epics' aiur features; NG2 | **P0, merge today** |
| #8115 | Reserved slots for labelled tickets (`agent.reserved_slots`) | Q6 creator lane; the voice-review slot | P1 |
| #8114 | Ticket stuck in ci-wait after its PR merges | merge throughput (manual workaround exists) | P1 |
| #8135 | Concurrency from measured resources (in progress) | NUC load headroom | P1 |
| new (verify first) | Per-ticket usage or cost read for host apps, if `GET /api/v1/usage` can't attribute cost to a ticket | E2 | P2 (E1 ships without it) |
| #8034, #8129, #8136 | Executor thread, outcome gate, overlap reviewer | — | after launch |

**What blocks OGM:** aiur #8082 is the only hard external blocker on the critical path. aiur #8142 and #8137 are
throughput and setup blockers. aiur #8115 is soft: Q6 can fall back to a manual `priority:1` and a pause of fleet
work.

## 4. Queue adjustments (aiur build queues)

Kevin, 2026-11-26: priorities are set with **aiur build queues**, not labels or slot juggling. Labels stay as they are,
apart from the `priority:1` the intake procedure applies to new members.

**Apply after aiur PR #8139 lands.** Queue writes are refused today by the allowlist bug (aiur #8137). Also, both
daemons timed out on `queue show` during this spike (13:30Z), so the members of the stale lists below are unread.

**Before any write**, on each daemon:
- record the previous next-up (`aiur-main queue show --json`, `aiur-main queue order`);
- check that the effective policy has `build_queue.set_order: ranked`, which cross-list `--rank` needs. Without it,
  report placement as blocked; don't fake it with labels.

`<NG1>` and the other placeholders are the §2 tickets once filed. A ticket already in a stale list is moved with
`queue remove` followed by `queue add`.

### Core daemon (run in `~/games/open-game-maker-2000`)

```sh
# Launch lists, ranked ahead of every phase list. Order within each list = dispatch order.
aiur-main queue add 1087 <V1> <V2>                                --queue launch-voice      --rank 0
aiur-main queue add <CS1>                                         --queue launch-comingsoon --rank 1
aiur-main queue add 1333 <Q1> <Q3> <Q6> <Q4> <Q5>                 --queue launch-qa         --rank 2
aiur-main queue add <NG1> <NG2> <NG3>                             --queue launch-newgame    --rank 3
aiur-main queue add <E1> <E2>                                     --queue launch-energy     --rank 4
aiur-main queue add 1349 <R2> <R1>                                --queue launch-review     --rank 5
aiur-main queue add <B3>                                          --queue launch-rooms      --rank 6
aiur-main queue add 1110 <C1>                                     --queue launch-chats      --rank 7   # 1110 waits on aiur #8082 (native blocked_by)
aiur-main queue add 1334 <D2> <D3> <D4>                           --queue launch-menus      --rank 8   # D2–D4 filed after Kevin's D1 picks
aiur-main queue add 1355 1361 1397 <M1> 1362                      --queue launch-site       --rank 9   # 1362 waits on og #1025's recording
aiur-main queue order                                             # read back: launch-* at 0–9

# Stale phase lists: keep them but push them behind launch work. Hold the asset lists until after launch.
aiur-main queue order phase-2-qa-mvp      --to 10   # review members first: move any launch-relevant ticket into launch-qa
aiur-main queue order phase-3-multiplayer --to 11   # same; rooms work belongs in launch-rooms
aiur-main queue order phase-1-assets      --to 12
aiur-main queue order phase-5-dusk-assets --to 13
aiur-main queue hold --queue phase-1-assets
aiur-main queue hold --queue phase-5-dusk-assets

# Non-launch core work in flight (#1348 packs import, #1395 preferences, #1394 controller layer):
# leave it running (queues never preempt). #1394 merges only after og B1/B2 pass, because it changes Blobs input.
# Park the rest of the non-launch P1s in a held list rather than relabelling:
aiur-main queue add 1340 1282 1203 1215 1205 1225 1171 1145 1080 1071 1339 1336 1343 1393 1372 1374 --queue after-launch --rank 14
aiur-main queue hold --queue after-launch
```

### Open-Games daemon (run in `~/games/open-games`)

```sh
aiur-main queue add <B1> <B2> 711 710 663 698 657 1025 819 881    --queue launch-blobs      --rank 0
aiur-main queue add 1056 1052                                     --queue dusk-helm-p0      --rank 1   # reduced: only the P0 and the combat arena
aiur-main queue order phase-4-versus-puzzle --to 2   # Blobs backlog: move launch tickets out first (remove + add above)
aiur-main queue order phase-6-dusk-helm     --to 3
aiur-main queue hold --queue phase-6-dusk-helm      # Dusk Helm reduced: rounds already in review stay reviewable; no new dispatch
aiur-main queue add 1011 1012                                     --queue restorebound      --rank 4
aiur-main queue hold --queue restorebound           # RestoreBound reduced: held until after launch
aiur-main queue add 996 512 992 817 784                           --queue blobs-after-launch --rank 5   # look experiments and flakes
aiur-main queue order                                             # read back
```

**Release points:**
- `queue release --queue phase-6-dusk-helm` once launch-blobs is empty or Kevin asks;
- `restorebound`, `after-launch` and the two asset lists on Tue 12-01.

**Verify** per the intake procedure. Read back `queue show --json` on both daemons and record "launch-voice now
precedes phase-2-qa-mvp" (core) and "launch-blobs now precedes phase-4-versus-puzzle" (OG). A held, stale or unknown
read-back doesn't count as proof.

**Known defect:** aiur #8142 (freed slots go to non-priority work) may bypass the queue order. Until it's fixed,
check the next-up after each slot frees.

**Capacity (an Executor call, not a priority lever).** Queues set priority. Slot counts only set capacity.
Running aiur instances on the PC is authorized (Kevin, 11-25).

**Slot split (proposal):**

| Daemon | Today | Proposed | Use |
|---|---|---|---|
| core (NUC) | 3 | 4 | all launch: voice, review, energy, coming soon, new game |
| Open-Games (NUC) | 4 | 3 | 2 Blobs launch, 1 Dusk Helm (#1056, then #1052) |
| PC core instance (new) | 0 | 3 | web-heavy launch tickets (menus D2–D4, Q1, NG3) |
| PC aiur session | as is | as is | aiur #8082, #8142, #8115, #8114 |

NUC total stays at 7 workers (load 63–68 today). The PC adds the capacity. Codex has room (20 % of the week used). If
Kevin declines the PC instance, core 4 / OG 3 still fits, but the menus (D2–D4) slip to Sunday.

## 5. Timeline to Mon 09:00 PT (half-day blocks; ★ = Kevin checkpoint)

| Block (PT) | Critical path | Parallel | Checkpoint |
|---|---|---|---|
| **Thu 05–12** | Kevin approves; Executor files epics and tickets, applies queue changes; merge aiur #8137; start aiur #8082 and #8142 on PC | Host steps: fix the NG1 config, check the rooms TLS from outside (B3) | ★ approve plan and decisions D1–D6 |
| **Thu 12–24** | core #1087 re-pin; CS1; core #1333; E1 API | B1, B2 (og); NG2 starts; Q1 | — |
| **Fri 00–12** | 01:00 Claude resets → D1 Claude Design proposal; V1; NG1 green; CS1 live → Dusk Helm set to Coming Soon | B3 rooms; core #1349 push | ★ Fri ~08:00: pick menus per screen (D1); confirm Dusk Helm hidden on a second account |
| **Fri 12–24** | Site M1 plus short links (core #1397) live; NG2 merged; NG3; E1 web plus admin; D2–D4 start | og #1025 hosted run once B3 is up; Blobs polish set | ★ Fri ~18:00: voice on his iPhone (dictation and two-way) |
| **Sat 00–12** | Docs (core #1361) human pages live; aiur #8082 merged (target) → core #1110 steps 2–7; R2 | Q3, Q4; V2 | — |
| **Sat 12–24** | New Game E2E green with the auto-planner; D2–D4 published; C1 | og #1025 recording; Q6 | ★ Sat ~14:00: create a game end to end on his phone; one day of in-app reviews starts (R1) |
| **Sun 00–12** | Q5 `ogm-qa launch` runs; fix every red line | Blobs online two-phone test | ★ Sun ~10:00: full dress rehearsal on his phone (Blobs Endless, CPU and online; New Game; voice; review; ticket chat; Energy) |
| **Sun 12–23** | Site plus docs final deploy (one site deploy per hour; batch); fixes only; **last app deploy before 23:00 PT** (quiet hours) | Game publishes continue (no cap) | ★ Sun ~20:00: go/no-go per item, cuts decided |
| **Mon 05–09** | ≤4 app deploys if needed; `ogm-qa launch` green at 08:00 | invites drafted | ★ Mon 09:00: Kevin sends invites |

**Critical path:** aiur #8082 → core #1110 → C1 → Q5. That is the longest chain and owned outside OGM. Second is NG2 →
NG3 → the New Game E2E, which carries the most risk inside OGM.

## 6. Risks and cuts

| Risk | Likelihood | Fallback |
|---|---|---|
| aiur #8082 doesn't land by Sat noon (not started; large) | **high** | Launch ticket chats as the shipped read-only thread plus "message the worker" over today's text-only `POST /:issue/messages` (next turn). Testers get no ticket chats; Kevin's own chats follow next week. |
| New Game without the Executor (NG2) is new code on the critical path | medium-high | Testers get the template first playable plus edit-chat edits (single tickets). Full Build Orders are planned by the Executor at most 2 per day. |
| Full menus redesign (D1–D4) in 2 days | high | Ship the core #1326 menus plus #1333 and #1334. Implement only D2 (home and New Game) if picked; the rest after launch. |
| Online Blobs (B3, og #1025): public TLS rooms and a no-op host adapter | medium-high | Launch with Endless and versus CPU; Online shows "Coming Soon" (the same release state, per mode, if cheap) or is hidden. |
| Dictation stays flaky (V1) | medium | Two-way voice (passing) plus the phone keyboard's own mic. One-way only is *not* the fallback, since two-way already works. |
| Energy cost attribution (E2) | medium | E1 counts jobs (new game = N units, edit = 1) against the weekly budget; dollar attribution after launch. |
| Testers' jobs starve the fleet, or the reverse (priority inversion, aiur #8142; no reserved slots) | medium | Pause all non-launch fleet work Sunday night through Monday. Cap at 1 job per tester. |
| NUC load or Zomboid protection with extra jobs | medium | The PC core instance carries the web tickets; heavy renders stay off until after launch. |
| Site multiplayer section needs a real online recording (core #1362 ← og #1025 ← B3) | high | Ship the site with Endless and CPU clips in that section; add the two-phone animation after launch. |
| Docs site (core #1361) has only just started | medium | Human docs first (short, marketing-like), agent docs as a generated reference page. |
| Netlify cap squeezes the last mile | medium | Batch fixes into hourly deploys; deploy freeze Sun 23:00 PT; Mon 05:00–08:00 slots only for go/no-go fixes. |
| Executor Claude budget (98 % until Fri 01:00 PT) | high until Fri | Thursday is filing and monitoring only. Claude Design (D1) waits for the reset. |

**Likely to miss Monday:** full ticket chats (S4 steps 2–7), the full menus redesign beyond home and New Game, Energy
dollar attribution and online Blobs. **Likely to make it:** Coming Soon, Energy weekly budget (unit-based), voice,
in-app review (pending Kevin's day of use), Blobs Endless and CPU, tester invites and bug reports, New Game (with the
NG2 fallback), the marketing site (without the live two-phone recording) and short links. The docs are at risk:
human pages are likely, agent depth may not make it.

## 7. Decisions only Kevin can make

1. **D1 — scope of the "full Claude Design redesign proposal".** The play and edit menus from the 11-24 mock are
   already live (core #1326). *Recommend:* a new proposal for the other tester-facing surfaces (home and games, New
   Game, settings and Energy, admin), made Friday 01:00 PT. You pick per screen by 08:00 PT, and only home and New Game
   are guaranteed for Monday.
2. **D2 — what a tester's New Game produces by Monday.** *Recommend:* template first playable plus edit-chat edits,
   with the auto-planner filing at most 3 first-playable tickets per game. No full multi-agent Build Order for tester
   games until after QA.
3. **D3 — default weekly budget and its unit.** *Recommend:* job units, not dollars, at launch: 2 new games and 20
   edits per tester per week, admin-adjustable per user, with your account unlimited.
4. **D4 — how many testers, and who, on Monday.** *Recommend:* 3–5 invited testers on day 1, then more in a
   second wave on Wednesday. Each tester's game uses real agent time, so the first wave tells us what the weekly
   budget and creator lane can carry. (PC capacity and slot counts are the Executor's call; see §4.)
5. **D5 — online Blobs gate.** *Recommend:* if the two-phone hosted match isn't green by Sun 12:00 PT, launch with
   Endless and versus CPU and mark Online "Coming Soon".
6. **D6 — what testers see of the agent loop.** *Recommend:* testers get review cards for their own games and file
   bugs. Ticket chats and two-way voice with workers stay yours until aiur #8082 is proven.


## Voice-handoff prep

Material for a later voice-agent handoff on the Monday goals. This is not the handoff itself. It uses plain words,
with ticket numbers in parentheses at most. Engineering and ops questions (slots, queues, aiur fixes, hosting, deploy
batching) stay with the Executor and are left out. Within each item, questions without visuals come first; visual ones
are marked **for preview review** (send a preview; don't ask by voice).

### 1. New Game for testers
- **State:** you can create a game in the app. After that, a person (the Executor) has to plan it before any agent
  builds it, so a tester's game would sit untouched. The automatic prod check for New Game has never passed: its
  configuration broke on the 23rd.
- **Decided:** create → plan → first playable, on prod, before invites.
- **Undecided:** what a tester gets by Monday; how long "first playable" may take.
- **Questions:**
  1. What does a tester's new game become by Monday?
     - A: a playable starter game they shape by chatting edits;
     - B: a small automatic plan (up to 3 build steps) on top of A;
     - C: a full multi-agent build like Dusk Helm.

     *Recommend B.* C needs the Executor per game and won't scale to testers by Monday.
  2. What's the longest wait from Finish to playable before it feels broken? Options: 15 min, 60 min, "tell them it'll
     be ready later". *Recommend:* playable starter immediately, then a notification when the first agent build lands
     (target 60 min). It sets what we promise testers in the invite.
  3. The New Game form separating look, camera and setting: before or after launch? *Recommend after.* It changes the
     first screen testers see days before they arrive.
- **Risk:** the automatic planner is new code on the critical path. If it slips, testers get the starter-game-plus-edits
  version only.

### 2. Voice
- **State:** two-way voice works on prod (fixed for your iPhone on the 24th). Dictation cut the words short in the last
  automatic run. The app still uses an older copy of aiur's chat box; the new one is merged, and the switch is next,
  with the app's own look applied over it (your direction this morning).
- **Decided:** one-way and two-way on your phone on prod; aiur owns the component and OGM restyles it.
- **Undecided:** which screens must have voice for testers; whether testers get two-way voice.
- **Questions:**
  1. Should testers get two-way voice on Monday, or dictation only? *Recommend dictation for testers, two-way for
     you.* Two-way costs ElevenLabs minutes per tester, and the per-tester budget doesn't count voice yet.
  2. Which screens need the mic for testers? New Game chat, edit chat, file a bug, agent chat. *Recommend all four for
     dictation.* Testers will try the mic wherever they see a text box.
- **Risk:** dictation is flaky. The fallback is the phone keyboard's own mic.

### 3. Reviews in the app
- **State:** the app's review screen matches the review page you use today. Its automatic check passed on the 25th.
  Push notifications for "review ready" have never reached your phone; the aiur piece they needed merged today.
- **Decided:** retire the review page once you've reviewed in the app for a whole day.
- **Undecided:** when you start that day; whether testers get review cards.
- **Questions:**
  1. Can you do Saturday as your app-only review day? *Recommend yes.* It's the only way to retire the page before
     Monday.
  2. Should testers see review cards and decisions for their own games? *Recommend yes, own games only.* Otherwise
     their agents' questions go nowhere.
  3. Should the review-intensity slider (least to most agent check-ins) come before or after launch? *Recommend after.*
- **Risk:** without push notifications, reviews wait until someone opens the app.

### 4. Agent chats per ticket
- **State:** you can read a ticket's conversation in the app. Sending messages, images, verdicts and voice to the agent
  is waiting on a large aiur piece that hasn't started.
- **Decided:** every review card opens that ticket's agent chat, with voice.
- **Undecided:** the Monday fallback.
- **Questions:**
  1. If aiur's piece isn't ready by Saturday noon, what do you want Monday? Options:
     - A: read-only chat plus a "message the agent" box that answers on its next turn;
     - B: hide agent chats.

     *Recommend A.* It keeps the feature visible and honest about delay.
  2. Do testers get agent chats, or only you? *Recommend only you at launch.* It's unproven, and it spends agent time.
- **Risk:** this is the item most likely to miss Monday.

### 5. Menus redesign (Claude Design)
- **State:** the pause menus for play and edit, from the Claude Design mock of the 24th, are live. No design exists yet
  for the other screens. Filing a bug from the play menu is broken: reports never arrive.
- **Decided:** the play and edit menus.
- **Undecided:** how far "the full redesign" reaches.
- **Questions:**
  1. Does "full redesign" mean the remaining screens testers touch (home and game list, New Game, settings and Energy,
     admin)? Or a second pass on the play and edit menus? *Recommend the remaining screens,* with home and New Game
     guaranteed for Monday and the rest best-effort.
  2. The proposal itself, phone portrait and landscape, one pick per screen. **For preview review** Friday morning.
- **Risk:** two days is tight to build a redesign. The fallback is today's menus plus the bug-report fix.

### 6. Energy budgets
- **State:** the Energy meter and admin page show provider usage today. Per-user limits exist only as an unused daily
  allowance. Nothing stops a tester from using all the agent time.
- **Decided:** an admin sets a weekly budget per user.
- **Undecided:** the unit, the default, and what happens at zero.
- **Questions:**
  1. Count in jobs or in dollars at launch? *Recommend jobs* (for example "2 new games and 20 edits a week"). Dollar
     accuracy needs per-ticket cost data that may not land by Monday.
  2. The default weekly budget for a tester? *Recommend 2 new games and 20 edits,* with your account unlimited.
  3. What happens at zero? Options:
     - A: refused until the weekly reset;
     - B: queued until the reset;
     - C: ask an admin.

     *Recommend A with a clear message and reset time.*
  4. Does voice count against the budget? *Recommend not at launch, but testers get dictation only.*
  5. The out-of-Energy screen and the ring. **For preview review.**
- **Risk:** without the budget, a few testers can starve Blobs and Dusk Helm work.

### 7. Blobs
- **State:** Endless and versus-computer play are in the game. Online two-player failed on prod: the game didn't start
  for a remote player, and the app's room create, join and start steps aren't connected yet. About 25 small look issues
  are filed, and 7 are picked as most visible.
- **Decided:** Endless, versus computer and two-player online, all tested.
- **Undecided:** what ships if online isn't ready; which polish counts.
- **Questions:**
  1. If online isn't proven on two real phones by Sunday noon, launch without it, or hold the invites? *Recommend
     launch with Endless and versus computer, with Online marked Coming Soon.* Testing creation matters more than
     testing netcode.
  2. Is the computer opponent's difficulty right? Options: easy, medium and hard as now, or one default. *Recommend
     keeping three.*
  3. The polish set: the round-start "GO" overflowing, the opponent board floating, tiny back buttons, the pause button
     on menus, the missing character in portrait, and the tablet signs. **For preview review** (before and after
     stills).
- **Risk:** a separate change moving all touch controls into the app could break Blobs input days before launch. It
  waits until the Blobs checks pass.

### 8. Dusk Helm "Coming Soon"
- **State:** not built. Games can only be listed or private today.
- **Decided:** only your account plays Dusk Helm until you release it; Dusk Helm work continues at reduced pace (the
  input fix and the combat arena only).
- **Undecided:** what others see.
- **Questions:**
  1. Do testers see a Dusk Helm card with a Coming Soon badge, or nothing? *Recommend the badge.* It shows what's
     coming without letting anyone in.
  2. Should the short link (makeopen.games/duskhelm) show a Coming Soon page to others? *Recommend yes.*
  3. Can you grant early access to a named tester? *Recommend yes, from admin.* It's the same mechanism.
  4. The badge and the Coming Soon page. **For preview review.**
- **Risk:** low. This is a small change.

### 9. Tester readiness
- **State:** invites and sign-in links work. Bug reports from the app are broken. There's no first-run screen. Phone
  load speed hasn't been measured on a mid-range Android.
- **Decided:** testers play Blobs and create games.
- **Undecided:** who, how many, and how they give feedback.
- **Questions:**
  1. How many testers and who, on Monday? *Recommend 3–5 first, then a second wave mid-week.*
  2. Where should feedback go? Options:
     - A: in-app "File a bug" only;
     - B: also a group chat;
     - C: a short survey after day 2.

     *Recommend A plus C.*
  3. Do testers' reports stay private, or can they see each other's? *Recommend private.*
  4. The invite email and the first-run screen. **For preview review.**
- **Risk:** the bug-report fix and first-run screen are small but must land before invites.

### 10. Marketing site and docs
- **State:** makeopen.games is live. You approved design B to move to prototype this morning. The hero copy, "Get your
  hands dirty", "Support Every Device" and the per-section animations still need building. The docs page doesn't
  exist yet: its first attempt was blocked and it's now being built as real pages. The short game links aren't built.
- **Decided:**
  - design B (Assembly Line), yellow;
  - "assets", never "packs";
  - the hero line and the two section names;
  - a two-phone multiplayer section;
  - human and agent docs with a toggle.
- **Undecided:** the multiplayer section without a real recording; how deep the agent docs go for Monday.
- **Questions:**
  1. If there's no real two-phone recording by Sunday, should the multiplayer section show versus-computer play, or be
     hidden? *Recommend versus-computer play.* Don't stage a fake online session.
  2. Docs for Monday: human docs complete and agent docs as a shorter reference? *Recommend yes.* Testers read the
     human docs.
  3. Should the site link to weaver sign-up, or stay invite-only? *Recommend invite-only,* with a "request access"
     note.
  4. The finished site sections and animations, and the docs pages. **For preview review.**
- **Risk:** the site can deploy at most once an hour and not overnight, so changes are batched. The multiplayer
  section depends on online Blobs.

### Cross-cutting risks for Kevin
- **Agent chats** and **online Blobs** are the two items most likely to miss Monday. Both have fallbacks.
- **The Executor (Claude) is nearly out of weekly budget until Friday 01:00 PT.** Thursday is filing and monitoring
  only. The menus design work starts after the reset.
- **The last app and site deploys before launch** are Sunday before 23:00 PT and Monday 05:00–09:00 PT.

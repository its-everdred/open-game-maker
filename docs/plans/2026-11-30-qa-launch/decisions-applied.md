# QA launch: Kevin's 2026-11-26 evening decisions applied to tickets

Applied 2026-11-27 ~03:30Z. Kevin's voice decisions came in on the evening of 2026-11-26 (Pacific) and supersede the D1–D6 recommendations in `plan.md` where they conflict.

**Where the changes are:**
- Each updated ticket's body ends with a section "Update 2026-11-26 evening: Kevin's voice decisions", which holds the new requirement and any open questions.
- New Monday tickets carry `priority:1` and `launch:2026-11-30`. They are native sub-issues of their epic, members of the matching aiur feature and lane, and members of the matching launch queue.
- Deferred tickets carry `priority:3`, `deferred` and `agent:parked`, and are filed without `agent:todo`. They stay in the backlog without dispatching.

Refs: `core #N` is its-everdred/open-game-maker, `og #N` is its-everdred/open-games.

## Work areas

| Work area | Ticket(s) | When | Status |
|---|---|---|---|
| Testing: no QA repo or daily prod create/delete job; headless system/E2E tests in temp local folders | core #1402 re-scoped and retitled (`agent:error` removed, re-queued); #1423 and #1404 drop prod mutations | Monday | updated |
| System-test audit, coverage gaps, flakes fixed at the cause | core #1445 (new) | Monday | filed, launch-qa |
| Agent browser play/inspect with a legitimate reusable QA session | core #1446 (new) | Monday | filed, launch-qa |
| Auto-publish after reliable checks, with a test record; never undo an unpublish | core #1447 (new) | Monday (see Ambiguous) | filed, launch-qa |
| New Game: extend the planning skill (ingest, interview gaps, build order, never re-ask) | epic core #1424; #1412, #1418 | Monday | updated; execution limit OPEN |
| Voice: both modes for all users within permissions | epic core #1425; #1403, #1413 (retitled) | Monday | updated; D6 superseded, cost OPEN |
| Review: in-app parity; background updater always on | epic core #1426; #1415, #1416 | Monday | updated; Saturday app-only day OPEN (Q15) |
| Agent conversations: editor and bug-report chats start individual aiur agents, Executor notified | epic core #1427 (retitled); core #1450 (new); #1110, #1417 updated | Monday | filed, launch-chats; needs aiur ask 1 |
| Development activity: embedded build order, with the activity-page fallback required | core #1451 (fallback, new), core #1452 (embed, new) | Monday | filed, launch-chats; embed needs aiur ask 2 |
| Full Claude Design redesign from the existing prototype (newest Design format) | epic core #1428 (retitled); #1411 re-scoped; #1419–#1421 now Monday | Monday | updated; Friday review OPEN (Q16) |
| Shared component library, tokens and visual checks | core #1449 (new, blocked by #1411) | Monday | filed, launch-menus |
| Minerals/Gas replace Energy (actual usage via aiur, aiur's SVG icons) | epic core #1429 (retitled); #1404, #1414 (retitled), #1220, #1421 | Monday (scope OPEN) | updated; allocations OPEN; 2 games / 20 edits is a labelled interim only |
| Dusk Helm Coming Soon: card, page, Admin grants | epic core #1430; #1405 | Monday | updated (approved as filed) |
| Testers: the two brothers by Admin email; normal flow; no survey or group chat | epic core #1431; #1407 | Monday | updated; contacts not supplied |
| Player-only access, promotion to game maker, permission switching | core #1448 (new) | Monday | filed, launch-qa |
| Bug reports: capture (state, logs, recent screenshots), debugging skill, issue evidence | core #1334 (re-scoped, unparked), #1333 (unparked), #1408, #1450 | Monday | updated; authority and payment for fixes in others' games OPEN |
| Site: live Sun before 20:00 PT; logo change; invite-only | epic core #1432; #1355, #1410, #1362 | Monday | updated |
| Docs: human and agent docs complete; agent-readable homepage; AGENTS.md discovery tested | core #1361, #1410 | Monday | updated |
| Blobs: garbage send/receive/land/cancel, chain scaling research, CPU regression | og #1087 (new); og #1063 asserts garbage | Monday | filed, launch-blobs |
| Blobs: two-session real-app online QA, then two phones | og #1025 | Monday | updated |
| Blobs polish queue | og #711, #710, #663, #698, #657, #819, #881 | Monday | unchanged; added to launch-blobs |
| Blobs character carousel | og #480 (re-labelled priority:3, deferred) | after Monday | updated |
| Numbered-collection asset review format | core #1461 (new); og #994 told to re-present this way | after Monday | deferred |
| Map builder: browse by type, tags, search and pack | core #1459 (new) | after Monday | deferred |
| Consistent pixel treatment for 3D assets | core #1460 (new, research) | after Monday | deferred |
| Dusk Helm pixel-art UI variants and pixel-tool comparison | og #1088 (new) | after Monday | deferred |
| Publish/unpublish for creators | core #1456 (new) | after Monday (see Ambiguous) | deferred; default publish state OPEN |
| Keep 1–2 versions playable | core #1453 (new) | after Monday | deferred |
| Cloud saves and named snapshots | core #1454 (new, research) | future (direction) | deferred |
| Forks and contributions | core #1455 (new) | future | deferred |
| Intake placement and milestone backlog reviews (skill change) | core #1457 (new) | after Monday | deferred |
| Model/effort info and settings button | core #1458 (new) | fast follow | deferred |
| External games | core #1378–#1386 | future | untouched, stay parked |
| aiur side (on-demand agents, embeddable views, per-user usage, model/effort) | one consolidated brief for the aiur session | Monday / fast follow | written, not yet sent |

## Queues after the change (read back)
- **Core:**
  - launch-voice: 1087, 1403, 1413
  - launch-qa: 1333, 1448, 1445, 1446, 1447, 1407, 1408, 1422, 1409, 1423
  - launch-chats: 1110, 1417, 1451, 1450, 1452
  - launch-menus: 1334, 1449, 1419–1421
  - launch-site (new, rank 9, start on `pr_opened`): 1410, 1361, 1355, 1362
- **Open-Games:** launch-blobs: 1062, 1063, 1087, 1025, 711, 710, 663, 698, 657, 819, 881

Several existing launch tickets had been missing from their lists. They were added in the same pass.

## Ambiguous (Executor's reading; Kevin can overturn)
- **Auto-publish (#1447):** treated as Monday work, because it sits in the testing decisions. The retained versions, snapshots and saves are what the decisions call directions.
- **Publish/unpublish (#1456):** deferred. Kevin says creators can unpublish, but no date is given, and the default publish state of a new game is unreconciled.
- **Energy budget PR (#1404):** already in human-review. Its job-unit budget is now the labelled interim under Minerals/Gas, and the PR still needs the rename and the 95% admin email.

## Open questions (recorded in the ticket bodies, not answered)
- **Minerals/Gas** (#1429):
  - the Monday scope and the allocations;
  - Kevin's exemption;
  - how voice, retries and in-flight work are charged;
  - Gas carry-forward.
- **New Game:** the initial execution scope for testers' plans (#1424, #1412).
- **Review timing:**
  - Q15, the Saturday app-only day (#1415);
  - Q16, the Friday design review (#1428).
- **Bug fixes in other creators' games:** who authorizes them and who pays (#1408, #1431).
- **One job per tester** vs parallel work (#1422).
- **Request access** for the invite-only site (#1407, #1432).
- **Default publish state** of a new game (#1456).

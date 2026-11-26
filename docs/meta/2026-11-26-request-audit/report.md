# Request audit, 2026-11-12 → 2026-11-26

Kevin, 2026-11-26: "this makes me suspicious that many of my requests in this convo haven't gone through standard development channels … review of our convo logs the last two weeks and find my request, see which were added as issue tickets and queued … we are looking to codify development and review cycle practices so less is up to the whims of shifting context windows."

**Nothing was filed, edited, relabelled, linked or commented during this audit.** Every ticket change below is a proposal for you to approve one at a time.

## 0. Coverage and method

| Source | Login | Messages kept |
|---|---|---|
| NUC Executor session `40d2abe5` | its.everdred (`~/.claude-2`), before the 2026-11-24 15:39Z switch | 506 |
| NUC Executor session `40d2abe5` | [Kevin login] (`~/.claude`), after the switch | 149 |
| NUC aiur-fixes session `e1691bf0` (`~/github/aiur`) | split at the same time | 15 + 4 |
| PC sessions `4d01474b` (home) and `5cd5799c` (`~/github/everdred/aiur`), over SSH | PC everdred | 28 |
| **Total** (`messages.jsonl`) | | **702** |

- On the NUC, `~/.claude-2/projects` is a symlink to `~/.claude/projects`, so both logins write to one transcript per session. The login split above is by timestamp. Identical messages are deduplicated by timestamp and text.
- Excluded:
  - aiur worker workspaces, whose "user" turns are aiur prompts;
  - the Zomboid-server sessions;
  - task notifications and agent-to-agent messages;
  - hook and skill boilerplate;
  - the Executor's own relays to the aiur session.
- Pastes over 2k characters keep their first 300 characters. Voice handoff documents keep their first 2,500 characters in `messages.jsonl`. I read the Nov 22 and Nov 25 handoffs in full from the transcript, and the Nov 26 dump only for the tickets it produced.
- Emails, Khala invite links and IP addresses are scrubbed from `messages.jsonl`. **This repo is public**, so the file publishes your raw messages, scrubbed. See question 1.
- Matching was scripted:
  1. Each request's 5-word shingles were matched against every issue and PR body and comment since 11-08 on core, Open-Games and aiur.
  2. Title keywords were matched within a 7-day window.
  3. I checked each match against the issue's real state, labels and comments.
  4. Where the match was unclear, I read the Executor's reply after the request.

## 1. Summary

I extracted **174 distinct work requests** after merging repeats and refinements. Questions, picks, status pings and ops chatter (SSH, logins, Humble redemption, VNC) are not counted.

| Intake | Count | Meaning |
|---|---|---|
| ticketed+queued | 128 | its own ticket, labelled `agent:queued` |
| appended | 22 | a comment, rework note or decision on another ticket |
| done-by-hand | 15 | the Executor did it itself (script, artifact, skill edit) |
| rule-only | 5 | written only into CLAUDE.md, memory or a skill |
| PR-only | 4 | an aiur or khala PR with no issue or queue entry |
| dropped (no trace) | 0 | |

| Outcome | Count |
|---|---|
| done | 129 |
| open, moving | 36 |
| **closed "done" but not working for you** (voice, in-app review) | 2 |
| **rule bypassed by a parallel PR** (touch icons) | 1 |
| **half dropped** (map-maker round trip: the game half was never queued) | 1 |
| **follow-ups dropped in triage** (the 11-18 "dozen visual issues") | 1 |
| stalled (aiur sandbox, todo for 8 days) | 1 |
| filed but never queued (aiur resource shares) | 1 |
| held or parked as you asked | 2 |

**The headline: intake mostly works, and the failures come after it.** Nearly every request reached a ticket and none vanished. What goes wrong afterwards:
- one concern gets split across tickets with no owner;
- preferences are broadcast as comments instead of enforced by a check;
- tickets close at merge, not when you've accepted the result;
- follow-ups that workers file sit in `needs-triage`;
- finished rounds don't reach your review page.

The icons case shows all of these at once (§4.A).

## 2. Request → ticket table

Statuses were checked against issue state, labels and comments on 2026-11-26 around 09:30Z. For "appended" rows, the ticket column names the ticket that received the comment.

| Date | Kevin asked | Intake | Outcome | Tickets |
|---|---|---|---|---|
| 11-12 | Simplify Blobs title and every menu, mock each | ticketed | done | [og#322](https://github.com/its-everdred/open-games/issues/322) |
| 11-12 | Rename game Blobs VS Blocks | ticketed | done | [og#320](https://github.com/its-everdred/open-games/issues/320), [og#723](https://github.com/its-everdred/open-games/issues/723) |
| 11-12 | Blobs logo ticket | ticketed | done | [og#321](https://github.com/its-everdred/open-games/issues/321) |
| 11-12 | Push latest assets to prod | done-by-hand | done | (Executor publish) |
| 11-12 | GM title screen keeps playing in background | ticketed | done | [core#731](https://github.com/its-everdred/open-game-maker/issues/731) |
| 11-13 | Agents ask for review without merging main | ticketed | done | [core#739](https://github.com/its-everdred/open-game-maker/issues/739) |
| 11-13 | Recreate the Oct 31 prototype design; + New Game icon | ticketed | done | [core#740](https://github.com/its-everdred/open-game-maker/issues/740) |
| 11-13 | Build pill: short phrase; map builds to active workers | appended | done | [core#740](https://github.com/its-everdred/open-game-maker/issues/740) (comment) |
| 11-13 | Prototype colours, not Gruvbox | appended | done | [core#740](https://github.com/its-everdred/open-game-maker/issues/740) (comment) |
| 11-13 | Fake prototype games incl. playable Goblin Cellar | ticketed | done | [og#330](https://github.com/its-everdred/open-games/issues/330) |
| 11-13 | Edit mode: no nav, green play button, larger game | appended | done | [core#740](https://github.com/its-everdred/open-game-maker/issues/740) (comment) |
| 11-13 | Editor mode = reusable scenery map maker | ticketed | done | [core#742](https://github.com/its-everdred/open-game-maker/issues/742) |
| 11-13 | Meta-improve must fix problems and file aiur tickets | rule-only | done | skills repo meta-improve |
| 11-13 | Codify prototype phases; tickets per phase | ticketed | done | [core#768](https://github.com/its-everdred/open-game-maker/issues/768), [core#830](https://github.com/its-everdred/open-game-maker/issues/830) (later) |
| 11-13 | 5 gameplay snippet prototypes | ticketed | done | [og#367](https://github.com/its-everdred/open-games/issues/367)–#370 |
| 11-14 | Remove waits each pass; never be a blocker | rule-only | open | memory; aiur A1 request (#7974 open, unqueued) |
| 11-15 | Thumbnail + trailer standard tickets per game | ticketed | done | [core#793](https://github.com/its-everdred/open-game-maker/issues/793) |
| 11-15 | Sort games list (recent play; 11-20: recent created) | ticketed | done | [core#794](https://github.com/its-everdred/open-game-maker/issues/794), [core#1043](https://github.com/its-everdred/open-game-maker/issues/1043) |
| 11-15 | Builds panel real data, Completed modal, Needs Review button | ticketed | done | [core#796](https://github.com/its-everdred/open-game-maker/issues/796) |
| 11-15 | Remove mushrooms; bigger board | ticketed | done | [og#443](https://github.com/its-everdred/open-games/issues/443) |
| 11-15 | Game card expands in place | ticketed | done | [core#800](https://github.com/its-everdred/open-game-maker/issues/800) |
| 11-15 | Total redesign, far less on screen | ticketed | done | [core#803](https://github.com/its-everdred/open-game-maker/issues/803) |
| 11-15 | Mode menu: Blobs / Blocks / Both | ticketed | done | [og#447](https://github.com/its-everdred/open-games/issues/447) |
| 11-15 | Music on game select (asked 11-15, 11-17, 11-18) | ticketed | done | [og#458](https://github.com/its-everdred/open-games/issues/458), [core#907](https://github.com/its-everdred/open-game-maker/issues/907) |
| 11-15 | Trash: later, telegraphed, falls between turns | ticketed | done | [og#459](https://github.com/its-everdred/open-games/issues/459) |
| 11-15 | Pop/splash on clear | ticketed | done | [og#461](https://github.com/its-everdred/open-games/issues/461) |
| 11-15 | Haptics by combo | ticketed | done | [core#810](https://github.com/its-everdred/open-game-maker/issues/810), [og#462](https://github.com/its-everdred/open-games/issues/462) |
| 11-15 | Centre invisible button rotates | ticketed | done | [og#463](https://github.com/its-everdred/open-games/issues/463) |
| 11-15 | No merge while falling | ticketed | done | [og#464](https://github.com/its-everdred/open-games/issues/464) |
| 11-15 | Voice per character; ElevenLabs skeleton voice | ticketed | done | [og#465](https://github.com/its-everdred/open-games/issues/465) |
| 11-15 | Wood grain vs grid lines | ticketed | done | [og#467](https://github.com/its-everdred/open-games/issues/467) |
| 11-15 | 5 trash looks | ticketed | done | [og#466](https://github.com/its-everdred/open-games/issues/466) |
| 11-15 | Sound on level end | ticketed | done | [og#468](https://github.com/its-everdred/open-games/issues/468) |
| 11-15 | Cohesive forest logo art; 3D squish buttons | ticketed | done | [og#469](https://github.com/its-everdred/open-games/issues/469), [og#470](https://github.com/its-everdred/open-games/issues/470) |
| 11-15 | Stays blurred after app switch | ticketed | done | [og#471](https://github.com/its-everdred/open-games/issues/471) |
| 11-15 | Telegraph shapes, grid lines, 5 face sets | ticketed | done | [og#472](https://github.com/its-everdred/open-games/issues/472), [og#473](https://github.com/its-everdred/open-games/issues/473) |
| 11-15 | Character bottom right, P2 overlap, no hold, CPU char | ticketed | done | [og#474](https://github.com/its-everdred/open-games/issues/474), [og#475](https://github.com/its-everdred/open-games/issues/475) |
| 11-15 | Logo replaces title; blur bg; genre icon | ticketed | done | [core#811](https://github.com/its-everdred/open-game-maker/issues/811), [core#812](https://github.com/its-everdred/open-game-maker/issues/812) |
| 11-15 | Loading bar animates truthfully | ticketed | done | [og#478](https://github.com/its-everdred/open-games/issues/478) |
| 11-15 | Delete score mode | ticketed | done | [og#479](https://github.com/its-everdred/open-games/issues/479) |
| 11-15 | Add tester to allow list | done-by-hand | done | (Executor) |
| 11-15 | Character select: 5 mocks | ticketed | open | [og#480](https://github.com/its-everdred/open-games/issues/480) (paused since 11-15) |
| 11-15 | Blocks L turns into T | ticketed | done | [og#492](https://github.com/its-everdred/open-games/issues/492) |
| 11-16 | Board max size, never covered (asked 3x) | ticketed | done | [og#547](https://github.com/its-everdred/open-games/issues/547), [og#635](https://github.com/its-everdred/open-games/issues/635), [core#829](https://github.com/its-everdred/open-game-maker/issues/829) |
| 11-16 | Needs Review: one button, every row actionable | ticketed | done | [core#819](https://github.com/its-everdred/open-game-maker/issues/819) |
| 11-16 | Prototype review stays in its ticket until approved | appended | done | [core#768](https://github.com/its-everdred/open-game-maker/issues/768) (comment) |
| 11-16 | Thumbnail is a scene; never the logo | ticketed | done | [og#548](https://github.com/its-everdred/open-games/issues/548), [core#835](https://github.com/its-everdred/open-game-maker/issues/835) |
| 11-16 | Logo/thumbnail slow; caching; keep old cache (asked 4x) | ticketed | done | [core#820](https://github.com/its-everdred/open-game-maker/issues/820), [core#1069](https://github.com/its-everdred/open-game-maker/issues/1069) |
| 11-16 | Every image in many sizes / aspect sets (asked 2x) | ticketed | open | [core#1071](https://github.com/its-everdred/open-game-maker/issues/1071) (queued since 11-20) |
| 11-16 | Standard loading screen per game | ticketed | done | [core#821](https://github.com/its-everdred/open-game-maker/issues/821), [og#549](https://github.com/its-everdred/open-games/issues/549) |
| 11-16 | Mode screen squishy-button rerender | appended | done | [og#469](https://github.com/its-everdred/open-games/issues/469) (comment) |
| 11-16 | gm-prototype skill + native effort switch | ticketed | done | [core#830](https://github.com/its-everdred/open-game-maker/issues/830) |
| 11-16 | aiur sandboxing spike → plan → build order | ticketed | stalled | [aiur#8047](https://github.com/aiur-team/aiur/issues/8047) (todo since 11-18; no build order, no PR) |
| 11-17 | In-app review UX (swipe, MC, media), OGM + aiur | ticketed | not-accepted | [core#843](https://github.com/its-everdred/open-game-maker/issues/843), [core#1124](https://github.com/its-everdred/open-game-maker/issues/1124), [core#1133](https://github.com/its-everdred/open-game-maker/issues/1133) closed; Kevin 11-26 still on the artifact |
| 11-17 | Never stretch images (enforced) | ticketed | done | [core#837](https://github.com/its-everdred/open-game-maker/issues/837) |
| 11-17 | impeccable skill | ticketed | done | [core#840](https://github.com/its-everdred/open-game-maker/issues/840) |
| 11-17 | Tags covered by nav | ticketed | done | [core#844](https://github.com/its-everdred/open-game-maker/issues/844) |
| 11-17 | Trailer on select; trailer skill; 16:9 gameplay only | ticketed | done | [core#845](https://github.com/its-everdred/open-game-maker/issues/845), [core#846](https://github.com/its-everdred/open-game-maker/issues/846), [core#867](https://github.com/its-everdred/open-game-maker/issues/867), [og#644](https://github.com/its-everdred/open-games/issues/644) |
| 11-17 | Vertical phone: numbers top row, character in gap | appended | done | [og#635](https://github.com/its-everdred/open-games/issues/635)/#632 (comment) |
| 11-17 | Multiplayer pause for both players | ticketed | done | [core#847](https://github.com/its-everdred/open-game-maker/issues/847) |
| 11-17 | Character quotes, expressions, win/lose | ticketed | done | [og#645](https://github.com/its-everdred/open-games/issues/645) |
| 11-17 | Layers guide for the next Executor | done-by-hand | done | docs/layers.md |
| 11-17 | Move all conversation into the app | ticketed | open | [core#854](https://github.com/its-everdred/open-game-maker/issues/854) closed; [aiur#8034](https://github.com/aiur-team/aiur/issues/8034) todo, [aiur#8087](https://github.com/aiur-team/aiur/issues/8087) human-review |
| 11-17 | Both mode = PPT Fusion; playtest gates | ticketed | done | [og#674](https://github.com/its-everdred/open-games/issues/674), [core#866](https://github.com/its-everdred/open-game-maker/issues/866) |
| 11-17 | One detail view for every game | ticketed | done | [core#868](https://github.com/its-everdred/open-game-maker/issues/868) |
| 11-17 | aiur ticket detail from the hammer | ticketed | open | [core#873](https://github.com/its-everdred/open-game-maker/issues/873) closed; [aiur#8043](https://github.com/aiur-team/aiur/issues/8043) todo |
| 11-17 | Pause survives app switch | ticketed | done | [core#874](https://github.com/its-everdred/open-game-maker/issues/874) |
| 11-17 | Revert blob faces from glow change | ticketed | done | [og#678](https://github.com/its-everdred/open-games/issues/678) |
| 11-18 | Bigger P2–4 boards landscape | ticketed | done | [og#687](https://github.com/its-everdred/open-games/issues/687) |
| 11-18 | Find and fix the dozen visual issues | ticketed | dropped-backlog | [og#629](https://github.com/its-everdred/open-games/issues/629)–#711: 18 follow-ups left needs-triage, never queued |
| 11-18 | No text overlays for updates | ticketed | done | [core#878](https://github.com/its-everdred/open-game-maker/issues/878) |
| 11-18 | One- and two-way voice (asked 11-18, 19, 20, 24) | ticketed | not-accepted | [core#879](https://github.com/its-everdred/open-game-maker/issues/879), #930, #1325 closed; #932 agent:error; Nov 25 doc: still not working for Kevin |
| 11-18 | anymachine; external skill library | ticketed | done | [core#899](https://github.com/its-everdred/open-game-maker/issues/899) |
| 11-18 | Hammer popover + N need review filter | ticketed | done | [core#900](https://github.com/its-everdred/open-game-maker/issues/900), [core#910](https://github.com/its-everdred/open-game-maker/issues/910) |
| 11-18 | Dusk Helm via New Game, attach researched tickets | ticketed | done | [core#904](https://github.com/its-everdred/open-game-maker/issues/904), [core#906](https://github.com/its-everdred/open-game-maker/issues/906) (registered by hand 11-20) |
| 11-18 | Game select fixes (VS icon, X, icons, pencil) | ticketed | done | [core#905](https://github.com/its-everdred/open-game-maker/issues/905) |
| 11-18 | Sound-button badge; loading text | ticketed | done | [core#907](https://github.com/its-everdred/open-game-maker/issues/907) |
| 11-18 | Title town: townsfolk in a line, tower clipping | ticketed | done | [core#908](https://github.com/its-everdred/open-game-maker/issues/908) (reopened 11-19) |
| 11-18 | Dusk Helm music-player artifact | done-by-hand | done | scratchpad dusk-music artifact |
| 11-19 | Blob faces: mocks, then A in engine, faces only | appended | open | [og#512](https://github.com/its-everdred/open-games/issues/512) (ci-wait since 11-15) |
| 11-19 | Trailer/menu music crossfade | ticketed | done | [core#929](https://github.com/its-everdred/open-game-maker/issues/929) |
| 11-19 | Edit page chat + composer + voice + orientation | ticketed | open | [core#930](https://github.com/its-everdred/open-game-maker/issues/930) done; [core#932](https://github.com/its-everdred/open-game-maker/issues/932) agent:error; [aiur#8048](https://github.com/aiur-team/aiur/issues/8048) done |
| 11-19 | Mossy ledge: rerender background as one image | appended | done | [og#688](https://github.com/its-everdred/open-games/issues/688) (relayed to the menus worker) |
| 11-19 | Skills never copied into Open-Games | appended | done | [core#936](https://github.com/its-everdred/open-game-maker/issues/936) (comment + test), memory rule |
| 11-19 | aiur resource shares (70/30) | ticketed | unqueued | [aiur#8050](https://github.com/aiur-team/aiur/issues/8050) (no agent label) |
| 11-19 | Dusk Helm mocks: title, loading, class select, biomes | appended | done | [og#752](https://github.com/its-everdred/open-games/issues/752) + PRs on researched tickets #1–#44 |
| 11-19 | Townsfolk voiced, heroes silent | appended | open | [og#29](https://github.com/its-everdred/open-games/issues/29) (human-review) |
| 11-19 | Music picks per screen | ticketed | open | [og#753](https://github.com/its-everdred/open-games/issues/753) (ci-wait since 11-19) |
| 11-19 | Town mocks, real models, Diablo 2 vibe | appended | done | [og#3](https://github.com/its-everdred/open-games/issues/3), [og#8](https://github.com/its-everdred/open-games/issues/8), [og#17](https://github.com/its-everdred/open-games/issues/17) (comments) |
| 11-19 | Root cause: restart dropped tickets | done-by-hand | done | CLAUDE.md rule; aiur session |
| 11-19 | Root cause: 16 decisions never delivered | done-by-hand | done | executor/decide.sh; [aiur#8062](https://github.com/aiur-team/aiur/issues/8062) |
| 11-19 | Mocks must use the real packs | ticketed | done | mock-broker (Executor script), [core#999](https://github.com/its-everdred/open-game-maker/issues/999), [core#1106](https://github.com/its-everdred/open-game-maker/issues/1106) |
| 11-19 | 3D→2D sprite pipeline + rebuild review lane | ticketed | done | [core#1005](https://github.com/its-everdred/open-game-maker/issues/1005)–#1014, [core#1094](https://github.com/its-everdred/open-game-maker/issues/1094) |
| 11-20 | Vegetation variations; terrain height | ticketed | done | [core#1028](https://github.com/its-everdred/open-game-maker/issues/1028) |
| 11-20 | Review-loop timeline + metric | done-by-hand | done | scripts/meta/review-loop-metric.py |
| 11-20 | Market stall; variation matrix; thumbs/pencil cards | ticketed | done | [core#1011](https://github.com/its-everdred/open-game-maker/issues/1011), [core#1033](https://github.com/its-everdred/open-game-maker/issues/1033), [core#1127](https://github.com/its-everdred/open-game-maker/issues/1127), [core#1132](https://github.com/its-everdred/open-game-maker/issues/1132) |
| 11-20 | Pipeline tools generalized + provenance | ticketed | done | [core#1036](https://github.com/its-everdred/open-game-maker/issues/1036) |
| 11-20 | Delete Adventure ghost; fewer fake games | ticketed | done | [core#1040](https://github.com/its-everdred/open-game-maker/issues/1040), [core#1042](https://github.com/its-everdred/open-game-maker/issues/1042) |
| 11-20 | Dusk Helm transparent logo + thumbnail | ticketed | done | [og#836](https://github.com/its-everdred/open-games/issues/836) |
| 11-20 | Playable builds arrive as prototype reviews; decision inventory | ticketed | done | [core#1055](https://github.com/its-everdred/open-game-maker/issues/1055)–#1057 |
| 11-20 | Varied stalls (shields, rugs) | appended | done | [core#1011](https://github.com/its-everdred/open-game-maker/issues/1011) (comment) |
| 11-20 | Games CI per game; core runs affected tests | done-by-hand | done | executor/og-merge.sh, og-batch.sh |
| 11-20 | 3D too low poly; try more tools | ticketed | done | [core#1094](https://github.com/its-everdred/open-game-maker/issues/1094), [core#1118](https://github.com/its-everdred/open-game-maker/issues/1118) |
| 11-20 | Creative vs clone lanes enforced by process | ticketed | done | [core#1106](https://github.com/its-everdred/open-game-maker/issues/1106) |
| 11-20 | PC: Executor answers human_required with verbal authority | ticketed | open | [aiur#8070](https://github.com/aiur-team/aiur/issues/8070) (human-review) |
| 11-21 | fal key; try fal models | ticketed | done | [core#1118](https://github.com/its-everdred/open-game-maker/issues/1118) |
| 11-21 | Victory screen = logo door to sunny valley | appended | done | [og#27](https://github.com/its-everdred/open-games/issues/27) → [og#836](https://github.com/its-everdred/open-games/issues/836) (comments), PRs [og#875](https://github.com/its-everdred/open-games/issues/875), [og#846](https://github.com/its-everdred/open-games/issues/846) |
| 11-21 | Use Kevin's own images for thumbnail/title/loading | appended | done | [og#836](https://github.com/its-everdred/open-games/issues/836), [og#30](https://github.com/its-everdred/open-games/issues/30) (comments), PRs [og#874](https://github.com/its-everdred/open-games/issues/874), [og#903](https://github.com/its-everdred/open-games/issues/903) |
| 11-21 | Review through direct agent chat (+voice) | ticketed | open | [core#1110](https://github.com/its-everdred/open-game-maker/issues/1110) (human-review since 11-21), [aiur#8082](https://github.com/aiur-team/aiur/issues/8082) todo |
| 11-21 | Clone RestoreBound into Open-Games | done-by-hand | done | [core PR #1113](https://github.com/its-everdred/open-game-maker/pull/1113) (no issue) |
| 11-21 | Dusk Helm genre icons + description | ticketed | done | [og#917](https://github.com/its-everdred/open-games/issues/917) (+ PR [og#934](https://github.com/its-everdred/open-games/issues/934)) |
| 11-21 | Trailer for the playable game (RestoreBound); exciting trailer skill | ticketed | done | [og PR #876](https://github.com/its-everdred/open-games/pull/876), [core PR #1122](https://github.com/its-everdred/open-game-maker/pull/1122) |
| 11-21 | Khala timeout off by default | PR-only | done | khala PR #1425 |
| 11-21 | Review cards show metadata + original | ticketed | done | [core#1128](https://github.com/its-everdred/open-game-maker/issues/1128), [core#1132](https://github.com/its-everdred/open-game-maker/issues/1132) |
| 11-21 | Pipeline view incl. walk animations | appended | open | [core#1282](https://github.com/its-everdred/open-game-maker/issues/1282) |
| 11-21 | sprite-stacking skill | ticketed | done | [core PR #1141](https://github.com/its-everdred/open-game-maker/pull/1141) |
| 11-21 | Phase advance as a review option | ticketed | done | [core PR #1317](https://github.com/its-everdred/open-game-maker/pull/1317) |
| 11-21 | HD-2D lighting, focus, particles spikes → prototypes | ticketed | open | [core#1145](https://github.com/its-everdred/open-game-maker/issues/1145)–#1149, #1171, #1225 |
| 11-21 | Clone a mock image into an in-engine scene | ticketed | done | [core#1154](https://github.com/its-everdred/open-game-maker/issues/1154) |
| 11-21 | Class sprites: full expressive animation set | ticketed | open | [core#1202](https://github.com/its-everdred/open-game-maker/issues/1202) (parked + human-review), [core#1203](https://github.com/its-everdred/open-game-maker/issues/1203) |
| 11-22 | Six base bodies in undergarments | appended | open | [core#1202](https://github.com/its-everdred/open-game-maker/issues/1202) (comment), [core#1282](https://github.com/its-everdred/open-game-maker/issues/1282) |
| 11-22 | Larger logo; never grey Play/Edit; branded loading | ticketed | done | [core#1261](https://github.com/its-everdred/open-game-maker/issues/1261) |
| 11-22 | Dusk Helm / Blobs won't play ("Try again", asked 9x 11-22→24) | ticketed | done | [core#1250](https://github.com/its-everdred/open-game-maker/issues/1250) (P0), [core#1318](https://github.com/its-everdred/open-game-maker/issues/1318), [core#1321](https://github.com/its-everdred/open-game-maker/issues/1321) |
| 11-22 | Deploy time limit 90 min + longer-term fix | ticketed | done | [core#1264](https://github.com/its-everdred/open-game-maker/issues/1264) |
| 11-22 | Autotile spike + approval gate (Nov 22 doc) | ticketed | done | [core#1200](https://github.com/its-everdred/open-game-maker/issues/1200), [core#1204](https://github.com/its-everdred/open-game-maker/issues/1204) |
| 11-22 | Map maker round trip with agents (Nov 22 doc) | ticketed | dropped-half | [core#1191](https://github.com/its-everdred/open-game-maker/issues/1191) closed; game half [og#909](https://github.com/its-everdred/open-games/issues/909) needs-triage since 11-22 |
| 11-23 | Pixel mask: fewer shades | ticketed | open | [core#1338](https://github.com/its-everdred/open-game-maker/issues/1338) (rework) |
| 11-23 | Remove vert/horiz editor buttons | ticketed | done | [core#1269](https://github.com/its-everdred/open-game-maker/issues/1269) |
| 11-23 | Editor messages wired to agent chat | ticketed | done | [core#1270](https://github.com/its-everdred/open-game-maker/issues/1270) |
| 11-23 | Build links stay in the editor page | ticketed | done | [core#1278](https://github.com/its-everdred/open-game-maker/issues/1278) |
| 11-23 | RestoreBound playable; no settings cog | ticketed | done | [og PR #920](https://github.com/its-everdred/open-games/pull/920) |
| 11-23 | Animation research spike; warrior walk+attack | ticketed | open | [core#1282](https://github.com/its-everdred/open-game-maker/issues/1282) (human-review, no open Command) |
| 11-23 | Playable slices in reviews | ticketed | done | [core#1281](https://github.com/its-everdred/open-game-maker/issues/1281) |
| 11-23 | One row of unique icons | ticketed | done | [core#1287](https://github.com/its-everdred/open-game-maker/issues/1287) |
| 11-23 | Batch merges like aiur | done-by-hand | done | executor/og-batch.sh |
| 11-23 | One shared hamburger menu for every game | ticketed | done | [core#1294](https://github.com/its-everdred/open-game-maker/issues/1294) |
| 11-23 | Game fills each aspect ratio in the editor | ticketed | done | [core#1295](https://github.com/its-everdred/open-game-maker/issues/1295) |
| 11-23 | Editor chat behind a bubble | ticketed | done | [core#1295](https://github.com/its-everdred/open-game-maker/issues/1295) / PR #1300 |
| 11-23 | Editor shows only this game's tickets | ticketed | done | [core#1296](https://github.com/its-everdred/open-game-maker/issues/1296) |
| 11-23 | Meta-improve always hourly | rule-only | done | CLAUDE.md, listen.sh |
| 11-24 | Health + mana liquid orbs | ticketed | open | [og#16](https://github.com/its-everdred/open-games/issues/16) (PR #763 open since 11-19), [og#962](https://github.com/its-everdred/open-games/issues/962), [og#972](https://github.com/its-everdred/open-games/issues/972) |
| 11-24 | Free/OSS animation packs; link sources | appended | done | [core#1282](https://github.com/its-everdred/open-game-maker/issues/1282) (comment), research report |
| 11-24 | Safe day, dusk journey, torch light | ticketed | open | [og#969](https://github.com/its-everdred/open-games/issues/969) (human-review) |
| 11-24 | Crash + app-open listeners | ticketed | done | [core#1318](https://github.com/its-everdred/open-game-maker/issues/1318) |
| 11-24 | New play/editor menus via Claude Design | ticketed | done | [core#1326](https://github.com/its-everdred/open-game-maker/issues/1326) |
| 11-24 | Settings conversation (which settings to keep) | done-by-hand | done | listed in chat; led to [core#1326](https://github.com/its-everdred/open-game-maker/issues/1326) |
| 11-24 | Weapon/armor packs, rarity tiers, per-group cards | ticketed | open | [og#994](https://github.com/its-everdred/open-games/issues/994), [core#1375](https://github.com/its-everdred/open-game-maker/issues/1375), [core#1392](https://github.com/its-everdred/open-game-maker/issues/1392) (parked) |
| 11-24 | Pixel mask in engine beside characters | ticketed | done | [og#976](https://github.com/its-everdred/open-games/issues/976) |
| 11-24 | Controller icons, never letters | ticketed | bypassed | [core#1320](https://github.com/its-everdred/open-game-maker/issues/1320), [og#988](https://github.com/its-everdred/open-games/issues/988), [og#989](https://github.com/its-everdred/open-games/issues/989) done; [og#16](https://github.com/its-everdred/open-games/issues/16) PR #763 draws its own letter pad |
| 11-24 | aiur kanban board | PR-only | open | [aiur PR #8111](https://github.com/aiur-team/aiur/pull/8111) |
| 11-24 | switch-login: agents may run it | done-by-hand | done | skills repo 8f5decc |
| 11-24 | River banks; rocky cliffs | ticketed | open | [og#979](https://github.com/its-everdred/open-games/issues/979) (ci-wait), [og#980](https://github.com/its-everdred/open-games/issues/980) (human-review) |
| 11-24 | Humble watch (daily) | done-by-hand | done | ogm-humble-watch.timer |
| 11-24 | Humble packs: redeem, intake, scene comparisons | ticketed | open | [core#1343](https://github.com/its-everdred/open-game-maker/issues/1343)–#1353, [og#1001](https://github.com/its-everdred/open-games/issues/1001) |
| 11-24 | Pixel finish crisp (finish C) | ticketed | open | [core#1338](https://github.com/its-everdred/open-game-maker/issues/1338) |
| 11-24 | Iterate the mask on the fountain | appended | open | [core#1338](https://github.com/its-everdred/open-game-maker/issues/1338) (comment) |
| 11-24 | Playtest: no walk anim, 2 buttons, talk view tiny, globes, no sound | appended | open | [og#22](https://github.com/its-everdred/open-games/issues/22), [og#16](https://github.com/its-everdred/open-games/issues/16) (comments) |
| 11-24 | Pack trailers camera-only; New Game splits style and camera | ticketed | open | [core#1351](https://github.com/its-everdred/open-game-maker/issues/1351), [core#1340](https://github.com/its-everdred/open-game-maker/issues/1340) (on hold) |
| 11-24 | Fire: flicker, embers, crackle, clarity | appended | open | [og#22](https://github.com/its-everdred/open-games/issues/22) (comment) |
| 11-24 | Cave dungeon + encampment from map library | ticketed | open | [og#1008](https://github.com/its-everdred/open-games/issues/1008), [og#1009](https://github.com/its-everdred/open-games/issues/1009), [og#1010](https://github.com/its-everdred/open-games/issues/1010), [core#1352](https://github.com/its-everdred/open-game-maker/issues/1352) |
| 11-24 | Hourly meta reads logs for mismatches (no hard-coded check) | rule-only | done | meta-improve skill |
| 11-25 | Workers always use the newest gm | done-by-hand | done | executor/gm-latest-shim.sh (Executor-only, no core ticket) |
| 11-25 | Use finish C2 for every Dusk Helm render | appended | done | same comment on [og#22](https://github.com/its-everdred/open-games/issues/22), #16, #890, #1001, #1008, #1009, [core#1282](https://github.com/its-everdred/open-game-maker/issues/1282) |
| 11-25 | RestoreBound 2D refresh; door spawn; battle clarity | ticketed | open | [og#1011](https://github.com/its-everdred/open-games/issues/1011), [og#1012](https://github.com/its-everdred/open-games/issues/1012) |
| 11-25 | Marketing site (sections, animations, copy) | ticketed | open | [core#1355](https://github.com/its-everdred/open-game-maker/issues/1355), [core#1362](https://github.com/its-everdred/open-game-maker/issues/1362) (+ comments) |
| 11-25 | Docs (Human/Agent toggle) | ticketed | open | [core#1361](https://github.com/its-everdred/open-game-maker/issues/1361) |
| 11-25 | Reserved voice+review slot | PR-only | open | [aiur PR #8115](https://github.com/aiur-team/aiur/pull/8115); slot:voice-review on #932 (error), #1087 (pc:todo), #1349 |
| 11-25 | Don't delete until I confirm | rule-only | done | memory |
| 11-25 | aiur usage meter uses reset time | PR-only | open | [aiur PR #8118](https://github.com/aiur-team/aiur/pull/8118) |
| 11-26 | Neo Tokyo mobile demo (don't prioritise) | ticketed | held | [core#1372](https://github.com/its-everdred/open-game-maker/issues/1372) |
| 11-26 | Nov 26 dump: tickets for codex, park the rest | ticketed | parked | [core#1375](https://github.com/its-everdred/open-game-maker/issues/1375), #1376–#1392 |
| 11-26 | Pixel effects tool bake-off | ticketed | open | [og#1044](https://github.com/its-everdred/open-games/issues/1044) |
| 11-26 | Tools watchlist | done-by-hand | done | research commit 1de082648 |
| 11-26 | Review-frequency slider | ticketed | open | [core#1393](https://github.com/its-everdred/open-game-maker/issues/1393) |

## 3. Proposed ticket changes (none made; approve each)

Proposals are ordered by impact. Labels follow the file-ticket convention. Each "Kevin" line is the quote the body would carry.

**P1. Core: the touch-icon rule covers games that draw their own controls (owner of the icons concern).**
- Repo: core. Labels: `agent:queued role:web priority:1 model:medium`.
- Kevin, 2026-11-24: "controller buttons on screen should always use icons. not letters". Kevin, 2026-11-26: "a single ticket should have even filed to update icons, then we don't waste resources enforcing preferences and checking PRs out of band."
- Do:
  - `touchIconWarnings()` returns early when `inputs.touch === "self"` (`packages/gm-cli/src/touch-icons-check.ts`) and only warns. Make it an error in `gm check` and `gm build`.
  - For self-drawn pads, require the game to render through a shared core `TouchPad` icon component, or to declare `inputs.icons` for each pad button, and run the same check on that.
  - Add a capture check: no single-letter glyphs on touch buttons.
- Links: owner of [core#1320](https://github.com/its-everdred/open-game-maker/issues/1320) (follow-up). Open-Games [og#16](https://github.com/its-everdred/open-games/issues/16) / [PR #763](https://github.com/its-everdred/open-games/pull/763) **blocked_by** this. [og#962](https://github.com/its-everdred/open-games/issues/962) and [og#972](https://github.com/its-everdred/open-games/issues/972) blocked_by it too, since they touch the same HUD.

**P2. Open-Games: queue [og#909](https://github.com/its-everdred/open-games/issues/909) "Dusk Helm: load the goblin cave from its scene document".**
- Relabel: add `agent:queued priority:1 role:gameplay`, drop `needs-triage`, then `--todo`.
- It is the game half of the map-maker round trip. It has sat in `needs-triage` since 11-22, while the epic [core#1191](https://github.com/its-everdred/open-game-maker/issues/1191) closed as done. Its core dependency (core PR #1249) merged on 11-22. The core PRs #1305 and #1209 workpad both say "Play doesn't show the edits … needs triage".
- Kevin, Nov 22 handoff §6: "Demonstrate the end-to-end loop: approved mock → agent-built engine scene → HD-2D treatment → user opens scene in map maker and edits → agent resumes using the updated scene → playable result."

**P3. Core: one outcome ticket "Voice and in-app review work on Kevin's phone" (owner of `slot:voice-review`).**
- Repo: core. Labels: `agent:queued slot:voice-review priority:1 role:web`.
- Acceptance: your own phone session (dictation, two-way call, a review card answered in the app), not merge.
- Kevin, Nov 25 handoff §5: "one agent slot should always be working on it … until both features work for him."
- Children: [core#932](https://github.com/its-everdred/open-game-maker/issues/932) (agent:error), [core#1087](https://github.com/its-everdred/open-game-maker/issues/1087), [core#1349](https://github.com/its-everdred/open-game-maker/issues/1349), [core#1110](https://github.com/its-everdred/open-game-maker/issues/1110), [core#1223](https://github.com/its-everdred/open-game-maker/issues/1223), plus aiur PR #8115 for the reserved slot.
- Fix [core#1087](https://github.com/its-everdred/open-game-maker/issues/1087): it still carries `pc:todo` despite "no more claude or aiur work at all on PC" (11-23).
- Today the slot label sits on three tickets with no owner, and the closed [core#843](https://github.com/its-everdred/open-game-maker/issues/843), [#1124](https://github.com/its-everdred/open-game-maker/issues/1124), [#1133](https://github.com/its-everdred/open-game-maker/issues/1133), [#879](https://github.com/its-everdred/open-game-maker/issues/879), [#930](https://github.com/its-everdred/open-game-maker/issues/930) and [#1325](https://github.com/its-everdred/open-game-maker/issues/1325) each claimed the outcome.

**P4. Open-Games: two owners for your 11-24 playtest notes.** Today they are comments on [og#22](https://github.com/its-everdred/open-games/issues/22) (in `ci-wait`, which takes no turn) and [og#16](https://github.com/its-everdred/open-games/issues/16).
- **P4a: "Dusk Helm: the hero walks with the pack walk cycle in game".** Labels: `agent:queued game:dusk-helm role:gameplay priority:1`. Kevin, 11-24: "1. no walk animations, he just glides". Related: [core#1282](https://github.com/its-everdred/open-game-maker/issues/1282) (attack animations).
- **P4b: "Dusk Helm: prototype audio pass (music, ambience, footsteps, swings, campfire crackle)".** Labels: `agent:queued game:dusk-helm role:audio priority:2`. Kevin, 11-24: "5 no sound". Also: "i like the orange glow or the fire but it needs flickering lights, ember particles, crackling sounds … i want full clarity". The visual half (flicker, embers, clarity) could go to the HD-2D owner [core#1171](https://github.com/its-everdred/open-game-maker/issues/1171) as a sub-item.
- The button cut ("just 2, attack can double as talk, then block and run") stays on [og#16](https://github.com/its-everdred/open-games/issues/16), which owns controls, after P1.

**P5. Core: make pixel finish C2 the default.** Today the instruction is a per-ticket comment.
- On 11-25 20:09Z the same comment ("Use #1338's newest iteration …") went to [og#22](https://github.com/its-everdred/open-games/issues/22), [og#16](https://github.com/its-everdred/open-games/issues/16), [og#890](https://github.com/its-everdred/open-games/issues/890), [og#1001](https://github.com/its-everdred/open-games/issues/1001), [og#1008](https://github.com/its-everdred/open-games/issues/1008), [og#1009](https://github.com/its-everdred/open-games/issues/1009) and [core#1282](https://github.com/its-everdred/open-game-maker/issues/1282).
- Proposal: add to [core#1338](https://github.com/its-everdred/open-game-maker/issues/1338)'s acceptance that `pixel_preview.py` and `gm sprite from-model` default to the approved preset per game (read from the game's manifest or style card), so new tickets inherit it.
- Kevin, 11-25: "ensure we use the latest reviewed pixel mask with the sharper lines for all future in engine dusk helm screenshots."

**P6. Core: workers always run the current gm (move `executor/gm-latest-shim.sh` into core).**
- Repo: core. Labels: `agent:queued role:infra priority:2`.
- Kevin, 11-25: "these are all old old clients, ensure agents are always using newest".
- The fix today is an Executor-only shim in an unversioned directory (§4.F). Proposal: `gm` checks its own build against the host's core main at start and refuses or self-updates, with a test.

**P7. aiur: decompose [aiur#8047](https://github.com/aiur-team/aiur/issues/8047) (sandbox) into a build order, as you asked.**
- Kevin, 11-18, aiur session: "break into a builder order queue feature". The ticket has been todo since 11-18, with no children and no PR.
- This goes to the aiur session, not a new ticket. First see question 4.

**P8. Cleanups (label-only).**
- [og#27](https://github.com/its-everdred/open-games/issues/27) closed but still `agent:human-review`.
- [core#1202](https://github.com/its-everdred/open-game-maker/issues/1202) is both `agent:parked` and `agent:human-review`.
- [og#480](https://github.com/its-everdred/open-games/issues/480) has been `agent:paused` since 11-18; your character-select pick moved on to og#688.
- [core#1197](https://github.com/its-everdred/open-game-maker/issues/1197) is open, P1 and unqueued, and looks fixed by [core#1250](https://github.com/its-everdred/open-game-maker/issues/1250): verify, then close.

## 4. Suspicious patterns, with evidence

**A. Preferences are enforced by hand in PR review, not by an owner plus a check (the trigger case).**
- [core#1320](https://github.com/its-everdred/open-game-maker/issues/1320) merged on 11-24 ("icons, never letters"). Its gate exempts any game that draws its own pad (`if (manifest.inputs.touch === 'self') return [];`) and only warns.
- [og#16](https://github.com/its-everdred/open-games/issues/16)'s [PR #763](https://github.com/its-everdred/open-games/pull/763) (open since 11-19, 12 commits) switched Dusk Helm to `inputs.touch: "self"` with its own glyph pad. So the rule never applied, and the Executor had to catch the letters in review on 11-26 08:57.
- The same thing happened with pixel finish C2 (one comment pasted to 7 tickets, P5) and with SmallScaleInt-first and KayKit-for-gear (memory entries plus comments on [og#976](https://github.com/its-everdred/open-games/issues/976)).

**B. Mega-tickets act as inboxes, and asks sent to tickets that take no turn sit unread.**
- Comments quoting you since 11-12:
  - [og#16](https://github.com/its-everdred/open-games/issues/16): 53;
  - [og#41](https://github.com/its-everdred/open-games/issues/41): 42;
  - [og#836](https://github.com/its-everdred/open-games/issues/836): 33, including the victory screen after the ticket closed;
  - [og#40](https://github.com/its-everdred/open-games/issues/40): 32;
  - [og#30](https://github.com/its-everdred/open-games/issues/30): 32;
  - [og#22](https://github.com/its-everdred/open-games/issues/22): 22.
- Your 11-24 playtest notes went to [og#22](https://github.com/its-everdred/open-games/issues/22) while it was in `ci-wait`. CLAUDE.md already records that a `ci-wait` ticket "takes no turn at all". The Executor's own 11-24 retro found the result: "every ticket shipped its own piece, and no ticket owned wiring the pieces into the real game."

**C. "Done" means merged, not working for you.**
- Two-way voice: [core#879](https://github.com/its-everdred/open-game-maker/issues/879), [#930](https://github.com/its-everdred/open-game-maker/issues/930) and [#1325](https://github.com/its-everdred/open-game-maker/issues/1325) are closed. You asked for its ETA 11 times; the Nov 25 handoff says one- and two-way voice still fail in the real app.
- In-app review: [core#843](https://github.com/its-everdred/open-game-maker/issues/843), [#1124](https://github.com/its-everdred/open-game-maker/issues/1124) and [#1133](https://github.com/its-everdred/open-game-maker/issues/1133) are closed. On 11-26 you said the artifact page stays "until we have working in app review parity".
- Map maker: epic [core#1191](https://github.com/its-everdred/open-game-maker/issues/1191) closed while its game half [og#909](https://github.com/its-everdred/open-games/issues/909) was untriaged.
- [aiur#8052](https://github.com/aiur-team/aiur/issues/8052) "Keep a ticket open after merge until the Executor confirms its post-deploy step" exists but was never queued.

**D. Follow-ups that workers file die in `needs-triage`.**
- Open tickets since 11-12 with no `agent:queued` or `agent:todo` (excluding the parked external-games set): 16 core, 23 Open-Games and 45 aiur.
- 18 Blobs visual follow-ups (plus og#881 from 11-21) ([og#629](https://github.com/its-everdred/open-games/issues/629)–[og#711](https://github.com/its-everdred/open-games/issues/711)) were filed by workers on 11-17/18, around when you said "find and fix the dozen or so visual issues" (11-18 03:20Z). None was queued.
- [og#909](https://github.com/its-everdred/open-games/issues/909) is P2. No hourly pass lists `needs-triage` age.

**E. Finished rounds don't reach you.**
- At 09:22Z today, 19 tickets were in `agent:human-review`: 7 core, including [core#1282](https://github.com/its-everdred/open-game-maker/issues/1282) (your stated top priority, animations) and [core#1110](https://github.com/its-everdred/open-game-maker/issues/1110) (since 11-21); and 12 Open-Games, including [og#945](https://github.com/its-everdred/open-games/issues/945) (since 11-23).
- `aiur-main commands --filter open` returned **no open Commands** on either daemon.
- The review page's last publish (11-25 23:16Z) carried **zero cards**. You said "i don't see any new review artifact questions" (06:24) and "i'm surprised there's been nothing for me to review in hours" (08:51).
- Across the two weeks you asked some form of "anything to review?" 19 times and changed the "link the review page" rule 6 times.
- The review page also carried non-asset cards (Humble *book* bundles) on 11-25, which is noise.

**F. The Executor builds fixes at its own layer, unversioned.**
- `~/.aiur/repo/its-everdred/open-game-maker-2000/executor/` holds 818 files and 38 shell scripts and **is not a git repository**. Scripts there include og-merge, og-batch, host-steps, decide.sh, mock-broker.py, gm-latest-shim.sh and file-ticket.sh.
- That is the merge queue, the mock broker that enforces "mocks use the real packs", and decision delivery: core- and aiur-shaped mechanisms with no review, no tests and no history.
- Several of your requests were "done-by-hand" here: CI per game, batch merges, newest gm, decision delivery.

**G. Rules live where workers never read them.**
- Project CLAUDE.md is 36.7 KB; memory has 124 entries. Workers load skills, not either of these.
- Five of your requests ended as rule-only, for example "don't delete until i confirm" and "hourly meta reads logs for mismatches". Many more preferences exist only as memory: SSI-first, KayKit for gear, link sources, controller icons, crisp pixel finish.

**H. You repeat yourself because nothing tracks open asks.**
- "can't play / Try again" came 10 times (11-22 → 24) before the P0 [core#1250](https://github.com/its-everdred/open-game-maker/issues/1250) landed.
- Two-way voice ETA: 11 times.
- Music on game select: 3 times. Board max size: 3 times. Logo and thumbnail caching: 4 times.
- "Link the review page": 6 rule rewrites.

**I. aiur work bypasses aiur's own queue.**
- These shipped as PRs with no issue: kanban ([aiur PR #8111](https://github.com/aiur-team/aiur/pull/8111)), reserved slots (#8115), usage reset (#8118) and khala timeout (khala PR #1425).
- Of the 45 open aiur issues since 11-10 with no `agent:queued` or `agent:todo`, many are `human:todo`. [aiur#8050](https://github.com/aiur-team/aiur/issues/8050) has no labels at all.
- On the kanban board you asked to "review and sign off before we implement" (11-24 04:32). No sign-off card is recorded; the approval exists only in chat (05:24).

**J. Context loss is structural.**
- 52 compactions ("This session is being continued") in two weeks, a login switch on 11-24, and three long voice handoffs (11-22, 11-25, 11-26) that the Executor turned into tickets by hand.
- Each listener (meta-improve, relay agent, Drive intake, Khala watch) must be re-armed by memory after every compaction.

## 5. Codification recommendations, ranked by impact (not implemented)

1. **aiur: request ledger with an intake gate.**
   - Every creator message is classified (model: request, decision, question or other). Each request gets an id and must resolve within 30 minutes to one of: an owning ticket, an append to a *running* ticket (receipt required), a rule with an enforcing check, or "no-op" with a reason.
   - Unresolved requests show in `status` and block the Executor's turn end.
   - The same ledger detects repeats, as this audit's shingle match did, and escalates the third ask.
   - Layer: aiur (any project). It removes dependence on the Executor's context for B, H and J.
2. **Core: a preferences registry that gates.**
   - `docs/preferences/<id>.yaml` holds your words, date, scope (games and roles), owning ticket and an enforcing check id.
   - `gm check` runs every check whose scope matches the change, and CI fails on a violation with no exemptions such as `touch: self`.
   - `skills.by_label` injects the matching preferences into each worker's first prompt.
   - Memory and CLAUDE.md entries for product preferences move here.
   - Fixes A and G.
3. **aiur: concern ownership and dependency checks.**
   - Tickets declare `concern:<name>` (for example `concern:touch-controls`).
   - Filing a ticket or opening a PR that touches an owned concern (by label or path) requires a `blocked_by` link to the owner, or the owner's sign-off.
   - Comments to a ticket that takes no turn (ci-wait, closed) are refused. Use rework or a new ticket instead.
   - Fixes A and B.
4. **aiur + core: outcome acceptance before close.**
   - Creator-facing tickets carry `accept:creator` or `accept:prod-check`. Merge moves them to `agent:accepting`, not done, until a prod check passes or you confirm on a card. Queue [aiur#8052](https://github.com/aiur-team/aiur/issues/8052).
   - An epic cannot close while any child or worker-filed follow-up is open or untriaged.
   - Fixes C.
5. **aiur: review-surface invariant.**
   - Every `agent:human-review` ticket must have an open creator Command with media, or a recorded reason.
   - The daemon alerts within 10 minutes and `review-loop-metric.py` fails the hourly pass otherwise.
   - The review page builder reads Commands directly, so it can't drift.
   - Fixes E.
6. **Core scripts: triage age as a metric.** `scripts/meta/triage-age.py` lists `needs-triage` older than 24 h per repo. The hourly pass must queue, merge or close each one, or raise a pick for you. Fixes D.
7. **Executor runbook and layers: version the executor toolkit.**
   - `executor/` becomes a git repo, or moves into core `executor/` with CI.
   - Anything used for more than a week (og-batch, mock-broker, decide.sh, gm-latest-shim) gets promoted to core or aiur with tests, per `docs/layers.md`.
   - Fixes F.
8. **aiur-build mode for voice handoffs.** A pasted handoff document becomes a proposed ticket diff (create, update, link, park) published as one approval card. You approve the diff, not each ticket. Fixes J and the hand parsing of 11-22, 11-25 and 11-26.
9. **aiur: no PR without an issue** on repos the Executor runs. UI or product changes that ask for your sign-off need a recorded sign-off Command before implementation. Fixes I.
10. **Listener self-healing.** One supervisor unit (systemd user) owns meta-improve, the relay agent, Drive intake and the Khala watch, so a compaction or login switch can't silently drop them. Fixes J.

## 6. Open questions for you

1. `messages.jsonl` is in a **public** repo (scrubbed of emails, invites and IPs). Keep it, or move the raw messages to a private location and keep only the report here?
2. The 18 (+og#881) untriaged Blobs visual follow-ups (og#629–#711): queue them as one "Blobs polish" ticket, queue each, or close them? Blobs sits under "everything else" in your 11-24 order.
3. [aiur#8050](https://github.com/aiur-team/aiur/issues/8050) (resource shares, 70/30): queue it now, or keep it tied to the multi-machine gateway work as you said on 11-19?
4. aiur sandbox ([aiur#8047](https://github.com/aiur-team/aiur/issues/8047)): still wanted now, behind the reliability work?
5. For aiur UI changes you want to sign off on (kanban #8111), should the aiur session stop at a mock card before building?
6. P4: should the campfire visuals go to the HD-2D owner (core) or stay a Dusk Helm ticket?

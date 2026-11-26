#!/usr/bin/env bash
# QA launch plan (Kevin 2026-11-26: approved plan recommendations): the aiur writes that were refused before the swap
# (aiur #8137 allowlist). Run section by section after the swap lands; check each verb's flags with `aiur-main <verb> --help`
# first (feature/epic argument shapes were written from the aiur-run and aiur-build skills, not from a run).
# Before any queue write on each daemon: record the previous next-up (`queue show --json`, `queue order`) and check the effective
# policy has build_queue.set_order: ranked. Read back after, and report "<new> now precedes <previous next-up>".
set -u
CORE=~/games/open-game-maker-2000; GAMES=~/games/open-games

### 1. Core daemon (run in the core checkout): epic, one feature per GitHub epic, lanes, members
cd "$CORE" || exit 2
aiur-main epic create launch-2026-11-30 --label "QA launch 2026-11-30"
# slug | GitHub epic | members (new tickets plus the existing ones the epic holds) | lanes
aiur-main feature create launch-new-game   --label "New Game launch (epic #1424)"   --lane qa=QA --lane engine=Engine --lane web=Web
aiur-main feature add launch-new-game 1402 --lane qa;   aiur-main feature add launch-new-game 1412 --lane engine;  aiur-main feature add launch-new-game 1418 --lane web
aiur-main feature create launch-voice      --label "Voice launch (epic #1425)"      --lane web=Web --lane qa=QA
aiur-main feature add launch-voice 1087 1403 --lane web; aiur-main feature add launch-voice 1413 --lane qa
aiur-main feature create launch-review     --label "In-app review (epic #1426)"     --lane web=Web --lane engine=Engine
aiur-main feature add launch-review 1349 1396 1415 --lane web; aiur-main feature add launch-review 1416 --lane engine
aiur-main feature create launch-chats      --label "Ticket chats (epic #1427)"      --lane web=Web --lane qa=QA
aiur-main feature add launch-chats 1110 --lane web;     aiur-main feature add launch-chats 1417 --lane qa
aiur-main feature create launch-menus      --label "Menus redesign (epic #1428)"    --lane design=Design --lane web=Web
aiur-main feature add launch-menus 1411 --lane design;  aiur-main feature add launch-menus 1334 1419 1420 1421 --lane web
aiur-main feature create launch-energy     --label "Energy budgets (epic #1429)"    --lane backend=Backend
aiur-main feature add launch-energy 1220 1404 1414 --lane backend
aiur-main feature create launch-comingsoon --label "Coming Soon (epic #1430)"       --lane backend=Backend --lane web=Web
aiur-main feature add launch-comingsoon 1405 --lane backend
aiur-main feature create launch-qa         --label "QA readiness (epic #1431)"      --lane qa=QA --lane web=Web --lane engine=Engine
aiur-main feature add launch-qa 1333 1407 1408 --lane web; aiur-main feature add launch-qa 1409 1423 --lane qa; aiur-main feature add launch-qa 1422 --lane engine
aiur-main feature create launch-site       --label "Site and docs (epic #1432)"     --lane web=Web
aiur-main feature add launch-site 1355 1361 1397 1362 1410 --lane web
aiur-main feature create launch-rooms      --label "Online rooms (Blobs epic og #1064)" --lane engine=Engine
aiur-main feature add launch-rooms 1406 --lane engine
for f in launch-new-game launch-voice launch-review launch-chats launch-menus launch-energy launch-comingsoon launch-qa launch-site launch-rooms; do
  aiur-main epic add launch-2026-11-30 "$f"
done

### 2. Core queues (section 4 of plan.md; ticket numbers filled in)
aiur-main queue show --json > /dev/null; aiur-main queue order      # record previous next-up first
aiur-main queue add 1087 1403 1413                                  --queue launch-voice      --rank 0
aiur-main queue add 1405                                            --queue launch-comingsoon --rank 1
aiur-main queue add 1333 1407 1408 1422 1409 1423                   --queue launch-qa         --rank 2
aiur-main queue add 1402 1412 1418                                  --queue launch-newgame    --rank 3
aiur-main queue add 1404 1414                                       --queue launch-energy     --rank 4
aiur-main queue add 1349 1416 1415                                  --queue launch-review     --rank 5
aiur-main queue add 1406                                            --queue launch-rooms      --rank 6
aiur-main queue add 1110 1417                                       --queue launch-chats      --rank 7   # 1110 waits on aiur #8082 (native blocked_by)
aiur-main queue add 1334 1419 1420 1421                             --queue launch-menus      --rank 8   # 1419-1421 wait on D1 (1411) picks
aiur-main queue add 1355 1361 1397 1410 1362                        --queue launch-site       --rank 9   # 1362 waits on og #1025's recording
aiur-main queue order
# A ticket already in a stale list is moved with `queue remove` then `queue add`.
aiur-main queue order phase-2-qa-mvp      --to 10   # review members first: move launch-relevant ones into launch-qa
aiur-main queue order phase-3-multiplayer --to 11
aiur-main queue order phase-1-assets      --to 12
aiur-main queue order phase-5-dusk-assets --to 13
aiur-main queue hold --queue phase-1-assets
aiur-main queue hold --queue phase-5-dusk-assets
# Non-launch core work in flight (#1348, #1395, #1394) keeps running; #1394 merges only after Blobs journeys 1062/1063 pass.
aiur-main queue add 1340 1282 1203 1215 1205 1225 1171 1145 1080 1071 1339 1336 1343 1393 1372 1374 --queue after-launch --rank 14
aiur-main queue hold --queue after-launch

### 3. Open-Games daemon (run in the games checkout)
cd "$GAMES" || exit 2
aiur-main epic create launch-2026-11-30 --label "QA launch 2026-11-30"
aiur-main feature create launch-blobs --label "Blobs launch (epic og #1064)" --lane qa=QA --lane polish=Polish
aiur-main feature add launch-blobs 1062 1063 1025 --lane qa; aiur-main feature add launch-blobs 711 710 663 698 657 819 881 --lane polish
aiur-main epic add launch-2026-11-30 launch-blobs
aiur-main queue show --json > /dev/null; aiur-main queue order      # record previous next-up first
aiur-main queue add 1062 1063 711 710 663 698 657 1025 819 881      --queue launch-blobs      --rank 0
aiur-main queue add 1056 1052                                       --queue dusk-helm-p0      --rank 1
aiur-main queue order phase-4-versus-puzzle --to 2   # Blobs backlog: move launch tickets out first (remove + add above)
aiur-main queue order phase-6-dusk-helm     --to 3
aiur-main queue hold --queue phase-6-dusk-helm
aiur-main queue add 1011 1012                                       --queue restorebound      --rank 4
aiur-main queue hold --queue restorebound
aiur-main queue add 996 512 992 817 784                             --queue blobs-after-launch --rank 5
aiur-main queue order

### Release points: `queue release --queue phase-6-dusk-helm` once launch-blobs is empty or Kevin asks;
### restorebound, after-launch and the two asset lists on Tue 2026-12-01.

# Review loop timeline, 2026-11-19 20:00Z to 2026-11-20 07:00Z

Kevin, 2026-11-20 06:38Z: "i'd like to close the loop of producing new sprites to review much faster. this is effectively the core loop of open game maker and it's the metric we want to continuously optimize and refine."

## Result

- **Loop time (Kevin's verdict → the next round on his page): median 59 min, worst 132 min** over the 9 loops that closed. 8 change requests had no new round on his page at 07:00Z; the oldest was 10 h old.
- **9 % of loop time is worker time; 91 % is waiting.** A rock round renders and scores in 1.4 min.
- The largest wait is the review page: a new round sits **39 min (median), 126 min (worst)** before the page is republished, which happens only when Kevin asks.
- Workers raised **274 Commands on the three rebuild tickets; Kevin judged 9.** 8 of those 9 verdicts were on a round the worker had already replaced.
- Verdicts reach a running worker in 3 min (median) but took 81 and 112 min in two cases, two never arrived, and one verdict was delivered three times.

## The loop and its stages

```
raised --S1--> on page --S2--> VERDICT --S3--> relayed --S4--> worker has it --S5--> next round raised --S6--> on page
```

| Stage | From → to | Who | Source |
|---|---|---|---|
| S1 page wait | Command created → the page publish Kevin judged it on | Executor | `decisions.json`, transcript |
| S2 Kevin | page publish → his pick | Kevin | picks (`at`) |
| S3 relay | pick → answer recorded or verdict comment | relay agent | `decisions.json`, issue comments |
| S4 delivery | relay → verdict text in the worker's thread | aiur | Codex rollouts, `decisions.ndjson` |
| S5 work | worker has it → first new Command on the ticket | worker | `decisions.json` |
| S6 page wait | new Command → first page publish after it | Executor | transcript |

Loop = S3 + S4 + S5 + S6. S2 is Kevin's own time and is reported apart.

## Timeline of 10 real iterations

Times are UTC on 2026-11-20. Durations in minutes. "Next round raised" is to the minute (receipt + S5).

| # | Ticket | Round judged | Raised | On page | Verdict | Relayed | Worker has it | Next round raised | Next on page | S3 | S4 | S5 | S6 | Loop |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | #1010 rock | 34 | 02:22:39 | 02:27:32 | 02:29:13 Needs changes | 02:31:13 | 02:31:41 | 02:34 | 04:41:14 | 2 | 0 | 3 | 126 | **132** |
| 2 | og#40 fields mock | layouts A–D | 02:20:35 | 02:27:32 | 02:31:28 Dense grove | 02:31:55 | 03:08:43 | 03:20:48 | 04:41:14 | 0 | 37 | 12 | 80 | **130** |
| 3 | #1012 knight | fitted arm | 04:39:09 | 04:41:14 | 05:06:21 Needs changes | 05:06:41 | 05:07:40 | 05:09 | 06:08:27 | 0 | 1 | 2 | 59 | **62** |
| 4 | #1010 rock | 52 | 04:37:51 | 04:41:14 | 05:06:33 Needs changes (note 05:07:26) | 05:07:14 | 06:27:51 (the note) | 06:31 | 06:40:49 | 1 | 81 | 4 | 9 | **94** |
| 5 | #1011 stall | red stall | 04:36:48 | 04:41:14 | 05:09:03 Needs changes (note 05:10:08) | 05:09:59 | 05:11:00 | 05:13 | 06:08:27 | 1 | 1 | 2 | 55 | **59** |
| 6 | og#40 fields mock | grove variety | 03:20:48 | 04:41:14 | 05:10:08 Needs changes | 05:11:26 | 05:14:21 | 05:29:03 | 06:08:27 | 1 | 3 | 15 | 39 | **58** |
| 7 | #1010 rock | 89 | 06:06:19 | 06:08:27 | 06:11:43 Matches | 06:11:56 | 06:27:51 | 06:31 | 06:40:49 | 0 | 16 | 4 | 9 | **29** |
| 8 | #1011 stall | 73 | 06:06:09 | 06:08:27 | 06:12:45 Needs changes (note 06:15:00) | 06:12:57 | not by 07:03 | – | – | 0 | 50+ | – | – | **50+ open** |
| 9 | #1012 knight | 66 | 06:06:07 | 06:08:27 | 06:15:13 Matches | 06:16:00 | 06:17:18 | 06:18 | 06:40:49 | 1 | 1 | 1 | 22 | **26** |
| 10 | og#40 fields mock | plant variants | 05:29:03 | 06:08:27 | 06:15:44 Revise variants | 06:16:09 | 06:20:41 | 06:30 | 06:40:49 | 0 | 3 | 12 | 10 | **25** |

Before the relay agent started (about 02:10Z) the relay stage alone took hours. These never closed a loop in the window:

| Ticket | Raised | On page | Verdict | Relayed | S3 | Delivered to worker |
|---|---|---|---|---|---|---|
| og#42 mini-boss | 11-19 21:42:44 | 21:49:57 | 21:50:37 | 02:20:18 | 270 | 02:20:24 |
| og#26 final boss | 11-19 21:33:06 | 21:49:57 | 21:52:35 | 02:21:15 | 269 | never (7 attempts) |
| og#14 character select | 11-19 22:01:26 | 23:59:12 | 00:21:08 | 02:23:12 | 122 | never (11 attempts) |
| og#13 Ranger | 11-19 21:18:45 | 23:59:12 | 00:22:43 | 02:25:16 | 123 | by comment |
| og#24 graveyard | 00:59:56 | 02:27:32 | 02:31:28 | 02:32:33 | 1 | 04:24:01 (112 min) |

## Duration per stage

Closed loops, 24 h (n = 9):

| Stage | Median | Worst | Kind |
|---|---|---|---|
| S3 relay | 1 | 2 (335 before the relay agent) | waiting |
| S4 delivery | 3 | 81 (112 on og#24; two never) | waiting |
| S5 work | 4 | 15 | work |
| S6 page wait | 39 | 126 | waiting |
| **Loop** | **59** | **132** | 9 % work, 91 % waiting |
| S1 raised → page (outside the loop) | 39 | 910 | waiting |
| S2 page → Kevin's pick (outside the loop) | 4 | 52 | Kevin |

A full cycle as Kevin lives it (verdict to verdict) adds S2: about 63 min median.

In the last hour of the window (three closed loops, Kevin asking every 30 min) the loop was 26 min median and S6 10 min: the loop is as fast as his asking.

## Bottlenecks, ranked

1. **The page updates only when Kevin asks (S6 39 min median, 126 worst; S1 the same again).** 8 publishes in 10 h, each after a chat message from him: 20:53, 21:49, 21:56, 23:59, 02:27, 04:41, 06:08, 06:40Z. His 03:36Z "anything new to review?" got no publish; he asked again at 04:38Z. In iteration 1 the worker had a new round 5 min after the verdict and Kevin saw one 127 min later. Nothing notifies him when a round lands.
2. **One Command per internal round (274 raised, 9 judged).** Each new Command moots the last, at a median 2.3–3.5 min apart. Kevin's page is a snapshot, so he judged rounds 6–7 behind the worker at 05:06–05:10Z and 2–4 behind at 06:11–06:15Z. A moot Command can't be answered, so the relay falls back to comment + message + rework, the slower path. The "next round" after a verdict is whatever the loop produced next (S5 1–4 min), not a round that answers his note: his 02:29Z "smaller rocks lack color" was followed at 05:07Z by "the small rocks look mostly missing". "Matches" on rock round 89 (06:11Z) did not stop the worker; it raised round 100 and he was asked again.
3. **Verdict delivery into a running worker (S4 worst 81–112 min, two never).** Comments and answers arrive at turn starts, and rebuild turns run 30–80 min. The rock note of 05:07:53Z arrived at 06:27:51Z after three turn starts without it. The stall verdict of 06:12Z had not arrived at 07:03Z (one turn since 05:41Z). og#24 waited 107 min and og#26/#14 never got their answers (`orchestrator_unavailable` ×9, `decision_dispatch_timeout` ×9 across 6 games-daemon runs).
4. **Stale redelivery.** The 02:31Z rock answer was delivered again at 05:09:44Z and 06:12:25Z; rework reasons carrying the 02:29Z and 05:07Z verdicts arrived at 06:28–06:36Z, after "Matches". The worker reworked an already-accepted rock.
5. **Pick and note are separate writes.** Kevin picks, then types. The 60 s relay sent "Needs changes." without his words on 3 of 5 noted verdicts (rock 05:06:33 → note 05:07:26; stall 05:09:03 → 05:10:08; stall 06:12:45 → 06:15:00); the worker starts on the bare verdict.
6. **Relay before 02:10Z (S3 122–335 min).** Fixed by the relay agent (S3 now 1 min median); it lives in the Executor session and dies with it.
7. **Parking after a non-blocking Command (aiur #8062).** og#40 had no turn from 02:22Z to 03:02Z with the verdict waiting 31 min.
8. **Render and scoring time: not a bottleneck today.** Rock: 1.4 min per round median (max 14); knight 0.2 min. Host load was 60–72 during the window on 12 cores. The largest gaps between knight rounds (42, 19, 17 min) are worker thinking and turn restarts, not rendering.

## Optimizations

| # | Change | Expected saving | Layer | Effort | Ticket |
|---|---|---|---|---|---|
| 1 | Review queue reads open Commands live (no publish step), one card per ticket showing the newest round | S6 39 → ≤ 2 min; S1 the same; ends stale-round verdicts | core (app, #843) | medium | core #1031 |
| 2 | Push notification when a review-lane round lands | removes "anything to review?"; Kevin's S2 is already 4 min | core | small | core #1031 |
| 3 | Stopgap now: the relay agent republishes the interim page on each new review-lane Command (at most every 5 min) and appends the time to a publish log | S6 39 → about 5 min today | Executor host | small | none (Executor action) |
| 4 | One open Command per ticket, raised at checkpoints; a verdict round that answers the note; stop on "Matches"; A/B/C variants in one round | 274 Commands → about 30; every verdict lands on a live Command; no rework after "Matches" | core (gm-sprite-forge) | small | core #1032 |
| 5 | Mid-turn delivery of answers, messages and rework reasons; retry until consumed; deliver once; accept an answer to a superseded Command | S4 worst 112 → ≤ 2 min; no lost or repeated verdicts | aiur | medium | aiur #8065 |
| 6 | Workers continue instead of parking after a non-blocking Command | up to 31–40 min per parked verdict | aiur | filed | aiur #8062 |
| 7 | Choice and note as one write (or relay waits 90 s for a note) | workers start on Kevin's words: saved 81 min on the rock | core (#1031); relay agent meanwhile | small | core #1031 |
| 8 | Round budget per turn: a turn ends (or checks its inbox) every 10 rounds or 20 min | caps S4 at 20 min until #5 ships | core (gm-sprite-forge) | small | in core #1032 |
| 9 | Relay agent as a host service (not a session agent) | keeps S3 at 1 min across session restarts | core | small | not filed |
| 10 | Hourly loop metric in the meta pass | regressions seen within the hour | core | done | this change |
| 11 | Priority slot for review-lane tickets | small today: no rebuild verdict waited on a slot | Open-Games / core config | small | not filed |
| 12 | Faster scorer or look-check | ≤ 1 min per round of a 59 min loop | core | – | not worth it yet |
| 13 | Render farm on the PC (16 cores; 14 GB of SmallScaleInt packs to sync) | ≤ 1.4 min per round today | Executor host | large | not worth it until S5 is the largest stage |

With 1, 4 and 5 in place the loop is S3 1 + S4 1 + S5 4–15 + S6 1: **about 10 min median**, set by worker time.

## Loop metric

**Review loop time** = minutes from Kevin's verdict on a round to the next round of that ticket being on his review page, where the next round is the first Command raised after the worker received the verdict.

- Reported hourly as median and worst over closed loops for the last 1 h and 24 h, with the median per stage, the slowest stage, and the change requests still open (oldest age).
- **Target: median ≤ 15 min, worst ≤ 30 min, no change request open longer than 30 min.** Today: 59 / 132 / 605.
- Second number to watch: Commands raised ÷ verdicts given per ticket (today 30; target ≤ 3).

### Computing it

```
scripts/meta/review-loop-metric.py                 # 1 h and 24 h windows; the meta pass logs this
scripts/meta/review-loop-metric.py --hours 6 --rows   # one window, one line per verdict
scripts/meta/review-loop-metric.py --no-gh         # no GitHub calls (relay time then comes from rework label events)
```

It reads only local files (the daemons' `decisions.json`/`decisions.ndjson`, the picks dump and relay ledger in the Executor scratchpad, Codex rollouts, ticket-events, and the Executor transcript for page publishes), so a slow daemon can't stall it. It took 16–28 s at host load 65; the transcript offset is cached in `~/.cache/ogm/review-loop-publishes.json`. The hourly meta pass copies the `REVIEW_LOOP` lines into its `## Review loop` section and compares them with the last pass.

Limits:

- Page publishes come from `Published …/review-all/index.html` lines in the Executor transcript. If the session or the page changes, S1/S6 go blank until a publish log exists (core #1031, stopgap 3).
- Worker receipt is read from Codex rollouts; for a Claude worker it falls back to the decision's `delivered` event.
- S5 is the first Command after receipt. While workers raise a Command per internal round it understates the time to a round that answers the verdict (iteration 1: 3 min by this measure; the small rocks were still wrong 2.5 h later).
- Verdicts Kevin gives in chat are not counted.
- Without the picks dump the answer time stands in for the pick, and S3 reads 0.

### Output at 2026-11-20 07:00Z

```
Review loop, last 1 h (to 11-20 07:00Z): 7 verdicts, 3 closed loops, 4 change requests with no new round on the page yet
  stage          median  worst   (minutes)
  S3 relay            0      1
  S4 delivery         3     16
  S5 work             4     12
  S6 page wait       10     22
  LOOP               26     29   verdict -> next round on the page
  work 23% / waiting 77% of loop time
  outside the loop: S1 raised->page median 2 worst 39; S2 page->Kevin's pick median 4 worst 7
  still open: #1011 47m (worker hasn't got it), #1010 17m (worker hasn't got it), #1011 16m (worker hasn't got it), og#40 15m (worker hasn't got it)
  rounds raised / judged by Kevin / median min between rounds: #1010 18/2/1.8; #1011 21/2/1.9; #1012 13/1/3.9
REVIEW_LOOP hours=1 n=3 open=4 median_min=26 worst_min=29 open_worst_min=47 slowest_stage="S6 page wait" slowest_median_min=10 target_median_min=15

Review loop, last 24 h (to 11-20 07:00Z): 27 verdicts, 9 closed loops, 8 change requests with no new round on the page yet
  stage          median  worst   (minutes)
  S3 relay            1      2
  S4 delivery         3     81
  S5 work             4     15
  S6 page wait       39    126
  LOOP               59    132   verdict -> next round on the page
  work 9% / waiting 91% of loop time
  outside the loop: S1 raised->page median 39 worst 910; S2 page->Kevin's pick median 4 worst 52
  still open: og#12 605m, og#11 602m, og#13 397m, og#11 397m, #1011 47m (worker hasn't got it), #1010 17m (worker hasn't got it), #1011 16m (worker hasn't got it), og#40 15m (worker hasn't got it)
  rounds raised / judged by Kevin / median min between rounds: #1010 100/4/2.3; #1011 97/3/2.8; #1012 77/2/3.5; og#11 3/2/135.5; og#12 3/1/32.4; og#14 3/1/149.3; og#16 3/0/0.4; og#21 7/1/0.2; og#40 4/4/62.2; og#42 3/1/147.5
REVIEW_LOOP hours=24 n=9 open=8 median_min=59 worst_min=132 open_worst_min=605 slowest_stage="S6 page wait" slowest_median_min=39 target_median_min=15
```

`--hours 24 --rows` (S1–S6 and loop in minutes; `+` = still open):

```
  ticket  verdict    S1   S2   S3   S4   S5   S6  loop  label
  og#12   20:54:53  181    2  329   18    -    -  605+  Needs changes
  og#18   20:55:17  197    2  335    -    -    -     -  Exclamation
  og#11   20:57:49  231    5  332   12    -    -  602+  Needs changes
  og#42   21:50:37    7    1  270    0    -    -     -  Torch chamber
  og#26   21:52:35   17    3  269    -    -    -     -  Shield bearer
  og#21   21:53:49  297    4  265    0    -    -     -  Metal set C
  og#585  21:53:59  825    4  273    -    -    -     -  Looks good
  og#634  21:54:06  910    4  274   98    -    -     -  Looks good
  og#14   00:21:08  118   22  122    -    -    -     -  Use lineup
  og#17   00:22:25  144   23  125    0    -    -     -  Mara: Like; Bram: Like; 
  og#13   00:22:43  160   24  123    0    -    -  397+  Archer: Dislike; Camo Ar
  og#11   00:22:54  163   24  127    0    -    -  397+  2D Knight: Dislike; 2D P
  #1010   02:29:13    5    2    2    0    3  126   132  Needs changes
  og#40   02:31:28    7    4    0   37   12   80   130  Dense grove
  og#24   02:31:28   88    4    1  112    -    -     -  Close grave grouping
  og#753  03:19:24  137   52    1    4    -    -     -  C
  #1012   05:06:21    2   25    0    1    2   59    62  Needs changes
  #1010   05:06:33    3   25    1   81    4    9    94  Needs changes
  #1011   05:09:03    4   28    1    1    2   55    59  Needs changes
  og#40   05:10:08   80   29    1    3   15   39    58  Needs changes
  #1010   06:11:43    2    3    0   16    4    9    29  Matches
  #1011   06:12:45    2    4    0    -    -    -   47+  Needs changes
  #1012   06:15:13    2    7    1    1    1   22    26  Matches
  og#40   06:15:44   39    7    0    3   12   10    25  Revise variants
  #1010   06:43:29    2    3    1    -    -    -   17+  Needs changes
  #1011   06:43:49    3    3    7    -    -    -   16+  Needs changes
  og#40   06:45:17   10    4    3    -    -    -   15+  Needs revision
```

## Tickets filed

- core #1031: Review queue updates live: new rounds reach Kevin within a minute, with a notification, no publish step (PC)
- core #1032: Sprite review lane: one open Command per ticket, checkpoint rounds, stop on Matches (PC)
- aiur-team/aiur #8065: Creator verdicts reach running workers late (worst 112 min), never, or twice

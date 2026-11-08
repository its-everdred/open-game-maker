---
name: gm-qa
description: Use to QA a hosted game build like a player before calling it done, after a publish, or when a creator says something "doesn't work on my phone" or "online is broken": boot it on phone and desktop, play journeys with real input, play a room across devices, look, and report pass or fail per step.
---

# QA a hosted build

`gm-verify` checks a local build through test hooks. The qa commands play the **hosted** build the creator plays, with real
keyboard, mouse and touch input and no hooks, at `https://<games-host>:10000/g/<game>/<build>/`. Every command writes
into one run directory (`--out`, default `shots/qa`) so `gm qa look` sees the whole run.

## The run

1. `gm qa open --url <build>`: boots phone and desktop. Fails on a non-2xx page (a 502 from the games host), a console
   error, no WebGL, a blank frame, or no first
   frame before `--timeout`. Read `open-phone.png` and `open-desktop.png` before going on.
2. `gm qa drive --url <build> --journey games/<name>/qa/journeys/<j>.json`: plays one solo journey and records
   `journey.mp4` and `journey.gif`. A missing expect fails the journey and stops it there, with a `fail-<n>.png`; a
   console error while it plays fails it too.
3. `gm qa room --url <build> --journey <room>.json --clients 2-4`: seat 0 (desktop) creates the room, the others
   (phone, desktop, phone) join with what it read. Checks seats, the countdown within `countdownSpreadMs` on every
   client, seat 0's move seen by the others, and the last seat dropping and rejoining. Writes `room.png` (tiled) and
   `room.mp4` (stacked). `gm qa room --local` runs this game's local build through the seeded network simulator
   (four clients, `--link bad` adds latency, loss and a drop) instead.
4. `gm qa look`: writes `look/requests.json` (at most 6 images a request) from every expect that carries `look` and
   every rule in `design/feedback.json`. Open each request's images, answer each id in `look/answers.json` with
   `{"pass": true|false, "note": "..."}`, worst defect in the note. Never answer a still you did not open.
5. `gm qa look --report`: writes `qa-report.md`, pass or fail per step. Exit 0 only when every step passed and every
   look was answered yes; an unanswered look, a look whose still changed since it was answered, or a missing clip
   reports `unchecked` (exit 1), not pass.

The Executor runs all four against a game's newest build with `ops/bin/ogm-qa <slug>` on the host.

A milestone gate (`qa/gate`) fails without a `gm look sheet` per approved screen for the build under test; capture
the signed-in app with `gm run --frame app` (storage state from `ops/bin/ogm-qa-signin` on the host).

## Journeys

A journey is JSON in `games/<name>/qa/journeys/`. Points and regions are viewport fractions, so one journey fits both
sizes. `{name}` is a value a `read` step saved; room journeys also have `{clients}` and `{seat}`.

| Step | Does |
| --- | --- |
| `{"do":"click","text":"Play"}` / `"selector"` | mouse click on visible text or a CSS selector |
| `{"do":"tap","text":"Play"}` / `"at":[0.5,0.8]` | touch tap on a phone, click on a desktop |
| `{"do":"press","key":"ArrowLeft","holdMs":80,"times":2}` | real key down and up |
| `{"do":"swipe","from":[0.6,0.4],"to":[0.3,0.4],"ms":200}` | a CDP touch swipe |
| `{"do":"expect","text":"GO","pixels":"changed","region":[x,y,w,h],"timeoutMs":10000,"look":"..."}` | waits; fails when not met |
| `{"do":"read","as":"code","selector":".code"}` / `"url":true` | saves text or the page URL for later steps |
| `{"do":"goto","url":"{link}"}`, `{"do":"wait","ms":500}`, `{"do":"shot","name":"end"}` | navigate, pause, still |

`pixels: "changed"` compares against the frame before the latest input, so put it right after the input it checks;
`nonblank` fails a flat frame. Wait on text or pixels, never on a long `wait`. Give the first expect a long
`timeoutMs`: a hosted build loads its assets first. A `look` is a player-facing question about that moment ("Did the
piece land where the buttons sent it?"), answered from its still.

Blobs' journeys (`solo-cpu`, `online-2p`, `phone-touch`, `laptop-keys`, `hud-clear`) are in `journeys/blobs/` beside
this skill: the examples to copy, and the set to keep in `games/blobs/qa/journeys/`. `laptop-keys` and `phone-touch`
prove gm-input's devices and `hud-clear` proves gm-ui-hud's clear corners. No step drives a gamepad: list it unchecked.

## Before reporting

- Name the worst visible defect first, from the stills and the clip, not from the step list.
- A room run proves rooms between browsers on one host. List WAN latency and a real phone as unchecked.
- `unchecked` in the report (no ffmpeg, an unanswered look) is not green: say what was not checked.

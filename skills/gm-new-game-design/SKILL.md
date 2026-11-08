---
name: gm-new-game-design
description: Load when a player starts the dedicated New Game flow and the game must be scoped with them. Runs the design conversation (typed or voice), front-loads rich creative questions, records every answer or provisional default as a decision, and produces the game design spec the Executor plans from.
---

# New-game design conversation

Only the dedicated New Game flow uses this skill. A change to an existing game is one ticket for one coding agent
(`gm-scope-options`); never turn it into a new-game design session.

## Inputs to read first

The creation choices (genre, vibe, style family and set, world, players, point of view), the scope chat, any voice
transcript, pasted text and attachments. Treat everything the player already said as known: use it silently and never
ask them to repeat or reconfirm it. Large pastes arrive as attachments; read them in full.

Then read `references/resources.md` (what the engine, hosting and asset library can really do) and
`references/question-protocol.md` (how to ask, recommend, default and revise).

Read `design/feedback.json`, the game's creator rejection ledger (#567), before you build any option set: its entries
carry the creator's words, the rule derived from them, and the scope each rule covers. A rejected option never comes
back. Run `gm options check` on an option set before it reaches the player, and record a rejection or a reason you hear
with `gm options reject`, which also withdraws the open options and Commands it invalidates. Give each option its
provenance (`--provenance <id>=@<file>.json`) when you offer it, so the check can read what it was built from.

## The conversation

- **Let them imagine first.** Open with room for a free description and keep listening while they brain-dump: short
  acknowledgements, no recaps, no option menus. Extract facts silently. Move to structured questions when they are
  ready (they say so, or the description has clearly run out), not because a checklist is waiting.
- Talk like a friendly game designer, in short turns. Typed and spoken replies are equal; a spoken answer may be loose,
  so restate it in one line only when the meaning is genuinely ambiguous.
- **Front-load the structural decisions; the rest arrive per stage.** Ask up front what shapes the build: core loop,
  controls, camera, world structure, player count, tone of story, win and loss. Look, characters, voices and audio are
  decided later, one stage at a time, from real media as the prototype ladder climbs
  (`../gm-new-game-plan/references/prototype-ladder.md`); here record only the direction the player already gave and
  any hard constraints. There is no question cap; stop asking about details a sensible default covers.
- **Look starts with concepts.** The first visual review is always generated mock-ups of the player's screen in the
  chosen kit (`gm-image-mock`): four options that differ greatly. That is stage 1 of the five-stage ladder (concepts,
  dioramas, rendered gameplay clips, real gameplay, iterations), and may run during the conversation or right after the
  spec.
- **Show, don't only tell.** Offer options as concrete samples where they help: an asset lineup or mock-up still, a
  short GIF or clip, a music or sound clip from the library, a story beat in prose, a tiny playable sketch. Pick the
  format that best answers that decision; label mock-ups as mock-ups.
- **Always recommend.** Each question with options names the recommended option and why, in one line.
- **Never block on the player.** They may skip, go quiet or leave. Each open question gets a provisional default after
  about five minutes (the Executor applies it); work that does not depend on it proceeds immediately.
- **Late changes are normal.** A new answer replaces the old decision; record it and let the Executor re-plan.
- **Concrete, not labels.** Describe an option as a situation and what the player does in it, never as "classic",
  "modern" or "hybrid". Requests to see or hear something stay open review items until real evidence is shown.
- **Music is a deliberate choice.** If the player has not picked music, offer mood-grouped samples and let them choose
  a collection; if they have, ask only how to apply it.
- **Players choose consequences, agents choose technology.** Never ask the player to pick an engine, library or
  package; offer the difference they would feel (tight vs. momentum-heavy movement).
- **Compact and complete.** Steer toward a short campaign that is finished and replayable over a large one that will be
  a shallow sliver.
- **No filler.** No repeated "checking…", no reading back long summaries, no "last question" while important items
  remain. Track deferred topics (naming, logo) and come back to them before you finish.
- **Naming and logo are real steps.** Offer short names drawn from the conversation; only claim a name was searched if
  you actually searched; a web search is not clearance. Logo options come from the design skills after the build.
- Ask questions as aiur Commands (`gm decide` wraps them) so the Executor, the app inbox and voice all see the
  same open questions. The three-checkpoint cap in `gm-scope-options` does not apply to new-game design.

## What to record

Keep **two records**: the game spec with its decision log, and a **platform feedback log** for comments about Game
Maker itself (how the conversation, questions, assets or agents should work). Product feedback never becomes a game
feature. Label every entry honestly: player decision, provisional default, agent example (never canon), or pending
evidence.

Every decision, whether the player's or a default, goes in the spec's decision log with: id, question, chosen option,
recommended option, origin (player or provisional default), time, and the spec sections it affects. Keep the player's
raw words, voice transcript and pastes in private storage only; the spec and every GitHub issue carry a privacy-safe
summary and an opaque reference.

## Finish

When the player says it's ready, or the important decisions are answered or defaulted, write the spec using
`references/spec-template.md` and hand it to the Executor (the new-game parent issue's private context). The Executor
plans the whole game with `gm-new-game-plan`; you do not create tickets. The spec's loops and screens
are the first draft of the game's flow diagram (`../gm-new-game-plan/references/flow-diagram.md`).

A spec is complete when the Executor can plan without a second interview: core loop, controls, camera, world and
levels, progression, win and loss, the features that climb the prototype ladder (the screens and moments the creator
reviews, each with its flow node), acceptance criteria, and the open questions with their defaults. Characters, style picks, UI and audio may hold only a direction: their stages decide
them later.

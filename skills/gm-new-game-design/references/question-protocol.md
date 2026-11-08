# Question, sample and decision protocol (new games)

## When to ask

Ask when the answer changes code structure, assets, controls, camera, player count, the core loop, the world's shape,
the story's spine or the music direction. Do not ask about anything the creation choices, chat, voice or pastes already
answer. Do not ask about details with a safe, reversible default (exact numbers, minor names, menu wording).

Prefer an open question when the player clearly has an idea in mind ("What happens when you reach the top of the
tower?"). Prefer a choice of 2–4 options when they are unsure or the space is large.

## How an option set looks

```
Title:   Hero jump
Prompt:  Which feels best?
  a  [clip]   b  [clip]   c  [clip]
Recommended: a
```

- **Show, don't tell** (Kevin, 2026-11-08): every look, sound or feel question carries the thing itself on each
  option: an image, a clip, audio or a playable slice. A text-only option set never reaches the creator; questions
  that can only be words (rules, scope, audience) go to the product-question queue for a voice session instead.
- **Fewest words:** a 2–5 word title, a prompt of a few words or none ("Which is best?"), option labels as short as
  "A", "B", "C" when the media says the rest. The creator answers by swipe or thumbs, so the choice must be obvious
  from the media.
- Options must differ in what the player experiences, not only in names or colours. Label anything made up or
  approximated as "mock-up". Samples: an asset lineup (`gm assets sheet`), a still or clip (`gm shot`, `gm-video`), a
  library music or sound clip, a tiny playable sketch.
- Always name the recommended option; the reason goes in the Command record, not on screen.

## Blocking, defaults and late changes

- A question blocks only the tickets that depend on it. Everything else proceeds.
- After about five minutes without an answer, the Executor records the recommended option as a **provisional default**
  (origin: default) and unblocks the dependent work. The threshold is approximate and configurable.
- The player may skip a question; treat a skip as "use your recommendation".
- A later answer always wins. Record it as a new decision that supersedes the old one; the Executor works out which
  tickets and code it affects and re-plans, reworks or reverts only what it must.

## Decision record

```
- id: D-07
  question: How should the hero move?
  options: [a, b, c]
  recommended: a
  chosen: a
  origin: player | default
  at: 2026-11-03T21:14Z
  supersedes: null | D-03
  affects: [controls, levels, tuning]
```

## Privacy

GitHub issues may be public. Issues and the spec's public summary never contain raw chat, raw voice transcripts, large
pastes or personal details; they hold a short summary and an opaque reference to private storage, where authorised
agents read the full text (speech already transcribed, never raw audio by default).

## How to talk (creator feedback, 2026-11-08)

- **One question at a time:** give the short explanation needed to choose, then wait. Rapid fire means not dwelling
  after an answer, not stacking five questions.
- **Don't restate answers:** no spoken summary followed by a longer written one, and no "checking" or "almost there"
  filler.
- **Plain words first:** describe the behaviour ("save a piece for later", "drop it instantly", "earn the highest score
  in 3 minutes"), then name the term if useful. Answer a clarification with fewer terms, not more.
- **Let them brain-dump:** capture the ideas, then resume. If they're cut off, wait for the rest instead of guessing.
- **Track every question:** answered, partly answered, ambiguous, deferred or unasked. Never announce the list is done
  while items remain; "nothing to add" doesn't cancel the list.
- **Ambiguous isn't an answer:** "seconds is fine" doesn't pick 20 or 25. Keep the current value marked provisional and
  ask again at the right prototype.
- **Don't reopen settled decisions:** read the game's decision record first. A later correction replaces only that
  item.
- **Keep two piles:** game decisions and platform feedback stay apart.
- **Evidence:** say plainly whether something was verified (research, a test, a played build) or is a recommendation.
- **Short titles, no links:** every Command gets a 2–5 word topic (`--short-summary`) and at most one short line of
  description. Never put a URL or long text in either. The options and their media carry the content.
- **Gameplay questions are played, not linked:** when the choice is about feel (speed, chain pause, controls), each
  option is a playable slice embedded in the deck (a few seconds each, one after another), never a link.

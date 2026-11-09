---
name: gm-scope-options
description: Load when a creation brief is vague or a choice could materially change the game.
---

# Scope and options

## Recover the source of truth

Read the job's scope ticket, current Agent Workpad, and `gm.lock.json` before proposing anything. The scope ticket
carries genre, vibe, world, and players; the lock records the chosen template, family, set, and point of view. Treat
the creator's own words as the quality bar. Never replace a specific request with a generic interpretation.

Start with the five-line plan and "defaults I'd reach for" pass from `gm-core`. Drop every default that is not
supported by the brief, or state why it is necessary to deliver an accepted item.

## Read what the creator already rejected

`design/feedback.json` is the game's rejection ledger (#567): the creator's words, the rule derived from them, and the
scope each rule covers. Read it before proposing anything and keep its rules in front of you. A rejected option never
comes back, so run `gm options check` on an option set first; when you hear a rejection or a reason, record it with
`gm options reject`, which also withdraws the open options and Commands it invalidates.

## Decide whether a choice is needed

A creation brief is vague when it names no playable mechanic or has fewer than three concrete game nouns. A narrow
edit stays narrow: use the existing acceptance list plus the requested delta, and do not reopen the whole game.

Ask only when the answer materially changes code, assets, tests, player count, point of view, or the core loop. Keep
working when a sensible reversible default does not change those things.

## Offer one bounded choice

For a vague creation brief, offer three clearly different takes in one question. Give each take one line with its
core verb, short loop, and boundary; recommend one. Different palettes or names are not different takes.

Record each option's provenance first (the packs and assets it used, its generator, and when it was built) as a JSON
file per option, post a still or clip of each with `gm chat post`, then run the ledger check and ask one blocking
question:

```text
gm options check --option "a=Gather and craft" --option "b=Race and deliver" --option "c=Defend and repair" --provenance a=@provenance/a.json --provenance b=@provenance/b.json --provenance c=@provenance/c.json
gm decide --topic "Core game loop" --question "Which game loop should I build?" --option "a=Gather and craft" --option "b=Race and deliver" --option "c=Defend and repair" --media a=<msg> --media b=<msg> --media c=<msg> --recommend a --reason "Fits the cozy pitch" --provenance a=@provenance/a.json --provenance b=@provenance/b.json --provenance c=@provenance/c.json --blocking
```

Open at most three checkpoints during an edit or a single-ticket build. A new game from the New Game flow follows `gm-new-game-design` instead (no cap). Pass `--blocking` on every creator Command: aiur retires a
non-blocking one 5 minutes after the ticket has no running agent, so the creator's pick expires unseen (`gm decide`
and `gm checkpoint open` raise it blocking regardless). Revert this to non-blocking once aiur #7872 is deployed.
Continue independent work either way.

## Lock the agreed scope

Record the chosen direction under `## Acceptance` in the ticket's Agent Workpad with observable keep and kill criteria:
what the player can do, what evidence proves it, and which tempting mechanics remain excluded. Preserve
unchosen ideas separately instead of quietly blending them into the build.

For a scope ticket, encode the same agreement in `.gm/scope/<session-id>.json`, including explicit included and
excluded lists plus ticket acceptance criteria, then run
`gm scope done --file .gm/scope/<session-id>.json`. Do not start game implementation until the agreed scope is filed.

---
name: gm-prototype
description: Use on every creator-request ticket (a screen, art, sound, gameplay or feature the creator asked for), i.e. any ticket labelled phase:mock, phase:prototype, phase:build or phase:polish. Climb from a cheap mock to the full in-game build one rung at a time, each rung reviewed by the creator, the effort raised by the system on approval.
---

# Fidelity ladder

A creator request climbs rungs of rising fidelity on **one ticket**. Each rung ends in the creator's review. A
"needs changes" verdict is another round on the same rung. Approval moves the ticket up a rung, and the system
raises your reasoning effort. Lessons and evidence: `references/lessons.md`. Rung media rules:
`../gm-new-game-plan/references/prototype-ladder.md`.

Every `lane:creative` ticket (towns, settings, UI screens, HUD, menus, title, loading and end screens, logos,
thumbnails) starts at `phase:mock` with pure image-generated mocks (gm-image-mock), and no rung is skipped: a
prototype needs the creator's approved mock, a build needs the approved prototype.

| Rung (label) | Effort | Deliver | Never |
|---|---|---|---|
| `phase:mock` | low | The cheapest thing the creator can judge: image mocks (imagegen), rough sound takes, a clip or paper mock of the gameplay. Each one is built from the real concept, cast and screen. | Production code, hand-coded SVG logos, generic stand-ins |
| `phase:prototype` | medium | The approved mock, in context: rendered in the real scene, sound on its event, a playable greybox slice, a clickable screen in the shell | Polishing; drifting from the approved mock |
| `phase:build` | xhigh | The real thing in the game, at every screen size, carrying the approved rung over exactly | Re-designing; dropping any approval note |
| `phase:polish` | high | Rounds on the live build until the creator approves | Re-asking for a build he already judged |

## Every turn
1. **Read your rung** from the `phase:*` label and the review ledger. Build only what that rung delivers. Your
   effort is set by the `model:<effort>` label. Never change it, never ask for more, and never pretend to have more.
   On the first turn, raise the ticket's `open` inventory decisions (the ids under `## Creator decisions`; when the
   ticket lists none, first add the feature's decisions to `docs/<slug>/decisions.json` and the section to the
   ticket), one non-blocking Command each, and record answers back: `../gm-core/references/decision-inventory.md`.
2. **Start from the last approved output.** That is the approved round's sha and media, not your own last trial
   and not a model-made mock. Score against the creator's real target (his concept crop or the approved media).
3. **Fold in every note.** An approval that carries a note ("looks good, but add X") is a change request first:
   do X as the next round on this rung. Carry earlier notes forward. Never close one while it's still unmet.
4. **Show, don't tell.** Each option gets its own media, a one-line caption saying what it decides, and readable
   close-ups (each item at least 150 px). Motion goes up as MP4 or GIF, sound as audio. Options must differ on what
   matters. Each must be a visible step toward the concept, never a near-copy of the current screen. For a look
   he dislikes, give five rendered options (A–E), starting from other games' screens. A round that mocks several
   screens gives each screen its own option set; never one option that bundles screens together.
5. **Verify in the real game before posting:** app-shell stills of a fresh production build at all four sizes
   (390x844, 844x390, 820x1180 and 1180x820). Every in-game still must show the board filling the screen. For
   motion or sound, a `gm run` scenario clip. Never post estimates, fixture tests or a still that stopped short of
   the screen. From `phase:prototype` on (not `phase:mock`), `gm qa playtest <game> --all-modes` must pass before you
   post (gm-verify step 8): the ticket's mode is not the only one the creator plays (#866).
6. **Post one round and one question per screen, then end the turn** in human-review. Raise picks non-blocking,
   with media on every option (one Command per screen, or one Command with a question per screen), and build your recommendation meanwhile. Never re-polish and re-ask before his verdict, and
   never ask the same question twice.
7. **Ship each round that beats prod.** Mark the PR ready with `Refs #<ticket>`, so it merges and publishes, and
   keep iterating on a new branch. The ticket stays open until the creator approves the last rung. A playable
   round that changes what the creator can do or see carries its prototype review in the round and the PR body:
   play link, phone clip, works now, known limitations (checked in that build), 3–6 decisions to weigh in on.
8. **Decide engineering yourself.** Only taste and product choices go to the creator, and every one of those
   does: never settle an inventory decision silently. Ship, scope, retries and tooling are yours, or the
   Executor's for host-only steps.

## On approval (automatic)
The reconciler swaps `phase:*` and `model:<effort>` to the next rung on this same ticket and reworks it with
the rung's template. Earlier rungs' throwaway code is replaced, not polished. Approved assets on main win over
anything baked into a mock. After the last rung is approved, the close gate allows the close.

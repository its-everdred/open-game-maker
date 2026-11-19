# Fidelity ladder: lessons from building Blobs (docs/meta, 2026-10-30 to 11-16, 192 hourly logs)

Ranked by recurrence. Each lesson gives the rule, the creator's words or the evidence, and where it lives in SKILL.md.

1. **Rounds sit unseen; verdicts sit unrelayed (~30 logs).** Picks expired unseen (11-08). A mock redesign went
   unshown for 23 h (#803), and rounds sat 3–42 h. Kevin: "decisions from the user shouldn't expire"; "gm should be
   built such that me deciding … automatically unblock[s] and kick[s] off any deps"; "i still have never been able to
   review anything in the app". → On approval the system moves the rung. Every round reaches review the same hour
   (step 6, "On approval").
2. **Verify in the real game at every size (~25 logs).** Kevin: "nothing like renders once again"; "not seeing a lot of
   parity between screenshots and real functionality"; "again always maximize board size at all resolutions". Failures:
   one-still readies with phone portrait broken, fixture-test merges, stills stopped on the wrong screen, unplayable
   clips. → Step 5.
3. **Ship rounds that beat prod; don't polish forever (~15 logs).** Kevin: "agents should be opening PRs and
   improving prod along the way"; "i still see all old blobs and chars" (merged, not published). #384 ran 11 rounds and
   never shipped. → Step 7.
4. **Options must be legible, separate and meaningful (~13 logs).** Kevin: "multiple options in a single image so i
   can't … choose a winner"; "i have no idea what i'm reviewing". Failures: "Option A: Liam" with no media; faces too
   small to compare; all options failing for the same reason. → Step 4.
5. **Approved work degrades in the real build (~10 logs).** A note was dropped ("put blocks around the scene too").
   A mock's placeholder logo overwrote the approved logo C. A fitted goo look was clipped at cell edges. Approved
   music had no implementing ticket. Kevin: "keep the design we landed on in the prototype". → Steps 2–3 and "On
   approval".
6. **One question per round (~10 logs).** #366 asked Kevin 6 times in 90 min. Text-only Commands ran until
   `require_option_media` was enforced. → Step 6.
7. **Mocks from the real concept and packs, at mock cost (~8 logs).** Kevin: "those logos are bad" (hand-coded SVG). Imagegen
   round 3 "looks right". A generic knight, ranger and wizard were built instead of the cast. Kevin: "we don't need to
   start these from scratch". Near-copies of current screens were sent back. → Rung table, step 4.
8. **Effort must match the rung, and it sticks to a thread (~8 logs).** Kevin: "way too many claude tokens". xhigh
   workers burned 24% of the week in 7.5 h. A resumed thread kept its old effort until a fresh thread started. →
   Low on mock and prototype, xhigh only for the build. The label sets effort natively each turn (aiur per-turn
   effort; verified live in aiur #8025).
9. **Score against the creator's target, the best result so far and the top gap (~8 logs).** Workers scored against a
   model mock instead of Kevin's crop, compared against their last trial instead of their best, and drifted 20
   iterations on the wrong gap. Judge scores are noisy, so take the median of several runs. → Step 2.
10. **Stopping wrong in both directions (~8 logs).** Some workers looped "no work remains" instead of handing off,
    while #333 idled with Kevin's notes unmet. A draft parked a priority look ticket. → Steps 3 and 6.
11. **Only taste goes to the creator (~6 logs).** Workers asked him engineering and billing questions, and asked
    things already answered in decisions or tests. → Step 8.
12. **Fold mid-round tweaks into the running round (~4 logs).** Three sprite corrections arrived in minutes, and
    recordings were abandoned when the design changed mid-record. → Treat a new note as part of the current round;
    don't restart it.

Reversals (the later rule wins):
- Review follow-up tickets became the same ticket until approved.
- Blocking picks became non-blocking picks with media, shipping the recommendation meanwhile.
- Three variations per step became five rendered options (A–E) when he dislikes a look.
- Options bundling several screens (Blobs #688: each of A–E held the title, mode and character screens) became one
  option set per screen. Kevin: "first multiple choice set should be per screen, no need to couple screens together".
- Executor-only stills became the worker's own `gm look shell`, with host stills as a fallback.
- A losing arm stopping after one or two tries became a scored plateau rule (best-so-far, then a technique change,
  then escalation).

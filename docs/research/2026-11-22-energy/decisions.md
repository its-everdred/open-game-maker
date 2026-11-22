# Energy: picks for Kevin (#1218)

Five picks. Each lists options with their consequence; the first is the recommendation. Without an answer, the
follow-ons (#1219, #1220, conservation) proceed with the recommendation. Background: [report.md](report.md).

## D1. What the top-right Energy ring shows

- **A. Status plus the binding constraint (recommended).** Healthy / Limited / Critical / Unknown, with the ring
  filled to what is left of whatever binds next (e.g. "Codex weekly, 38 % left, resets Tue"). Tapping opens one line
  per source. Unknown is never drawn as full.
- **B. Status only.** Colour and word, no fill. Simplest, but the player can't see how close the next limit is.
- **C. One converted number** (e.g. "$31 of $46 this week"). Looks precise, but for subscriptions the dollar figure
  is an estimate that moves with the model mix. This answers #598's open question with a number it can't back.

## D2. Do voice and images drive the ring?

- **A. No, they become badges (recommended).** The ring covers what a build needs: coding capacity (aiur, best
  available source) and the instance day/week/month caps. Voice (ElevenLabs) and images (fal) show as separate
  badges that block only their own work.
- **B. Yes, as today.** Any exhausted service turns the whole ring Critical, even though builds still run.

## D3. One USD cap across all spend, or per owner?

- **A. Per owner for now (recommended).** OGM's instance caps cover OGM spend (builds, fal, ElevenLabs overage).
  aiur's caps cover coding spend (OpenRouter). The admin dashboard shows both. No aiur change needed.
- **B. One cap in aiur.** OGM reports fal and other spend to aiur (gap A2), so aiur's global monthly limit covers
  everything and dispatch respects it. Needs an aiur ticket first.

## D4. What Save / Balanced / Best does as Energy falls

- **A. OGM asks; aiur routes (recommended).** The preference changes effort, model hints and whether paid
  generation (fal, ElevenLabs) asks first. At Limited, Balanced lowers effort a step and proposes scope cuts through
  `gm decide`. At Critical, new builds wait for the reset. aiur alone picks the provider (Codex first, Claude
  reserve for the Executor, OpenRouter last).
- **B. Push it all into aiur.** aiur maps the preference to provider and model choice. One place, but aiur would
  need a per-player preference it doesn't have, and players would end up choosing providers.
- **C. Display only.** Keep the preference as a label agents may read (as today).

## D5. Dollar figures for subscriptions on the admin dashboard

- **A. An estimated weekly share with a range (recommended).** For example, $200/month shows as a $46.15 weekly
  budget (12/52 of a month, not ÷4), with "used ≈ $21–25", labelled estimate.
- **B. Percent only.** No dollars for subscriptions anywhere.
- **C. API-equivalent value.** Tokens × list price from aiur's usage aggregate. Shows what the work would cost
  metered, often several times the plan fee.

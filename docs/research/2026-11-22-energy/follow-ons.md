# Energy follow-on ticket bodies (#1218)

Refined from [report.md](report.md), assuming the recommended picks in [decisions.md](decisions.md). The
"Refined by #1218" sections below were appended to #1219 and #1220. The conservation ticket is new.

## #1219 Energy admin dashboard: refined by #1218

**Depends on:** #1217 (real readings) for the OGM sources. aiur rows use `aiur.usage` until #1220 lands, then
`aiur.capacity`.

**Build**
- Extend `EnergyResource` to the v2 shape in report §3 (`id`, `account`, `kind` incl. `subscription_window`,
  `quota`, `prepaid_balance`, `metered_spend`, `cap`; `serves`, `unit`, `used`/`limit`/`left`, `range`,
  `basis`, `resetsAt`, `observedAt`, `ageMs`, `freshness`, `origin`, `editable`, `state`). Bump
  `energy.admin-view` to v2 and leave the player view alone.
- Add an `energy_samples` table with one row per resource per poll, kept 30 days, written by the 60 s cached
  snapshot.
- Admin page sections: pool header (level, binding constraint, reset, freshness); one row per provider (Claude per
  account and window, Codex per account and window plus credits, OpenRouter balance and key limit with aiur state,
  fal ledger vs cap plus balance if readable, ElevenLabs characters, Netlify deploys × 15 credits vs an entered
  allotment); caps (OGM caps editable, aiur caps read-only with their config layer); 7- and 30-day history
  (reported as lines, estimates as bands, unknown as gaps); subscription weekly USD estimate with range (D5);
  recent aiur dispatch reasons when aiur exposes them.
- No new provider key. fal balance stays `unknown` unless Kevin approves a `billing:usage:read` key.

**Done**
- Tests: unknown and stale never render as 0 or 100; estimate rows always show a range or "estimate"; nothing is
  labelled billed; a non-admin gets 403; aiur caps aren't editable.
- Phone and desktop stills with real data.

## #1220 Energy reads aiur.capacity: refined by #1218

**Build (additions)**
- Map `aiur.capacity` sources and accounts to `EnergyResourceV2` (`origin: aiur.capacity`, `state` and `reason`
  passed through, `limits[]` as `cap` resources).
- Ring = `min(aiur energy.level, instance day/week/month)`. aiur's level is the max over its sources, because coding
  sources stand in for each other. Voice and images become badges and no longer drive the ring (D2).
- A null `energy.level` with `state: unknown` reaches the UI as Unknown. Test it with aiur's
  `capacity-unknown.v1.json` fixture.
- aiur `limits[].spent_usd` may be null until aiur gap A1 is fixed: show it as unknown, not 0.

**Keep OGM-side:** instance caps and build ledger, fal ledger (and balance if keyed), ElevenLabs, Netlify estimate.

## New: Energy conservation by preference (Save / Balanced / Best)

**Problem.** The preference is stored per player and printed by `gm energy`, but nothing acts on it beyond the
prose in `skills/gm-core/SKILL.md`. As Energy runs low, agents and the Executor have no shared rule.

**Build**
- Write the table from report §5 into `skills/gm-core/SKILL.md` (Energy section) and the Executor's
  ticket-cutting skill (`gm-new-game-plan`): effort and model hints per preference × ring level, paid generation
  (fal, ElevenLabs) asks first under Save and at Limited, scope cuts only through `gm decide`, Critical waits for
  the reset.
- `gm energy --json` gains `binding` (resource id and reset) and `services` badges so agents can quote the
  reason.
- Unknown: model choice as Balanced, but no paid generation without a known cap.
- No provider choice in OGM: aiur keeps Codex first, the Claude reserve and OpenRouter last resort.

**Done**
- A skill test (fixture bundles at each level × preference) checks the rule an agent reads.
- One real job run under Save at Limited that asks before a fal call.

**Depends on:** #1217.

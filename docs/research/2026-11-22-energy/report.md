# Energy: development spend across providers (#1218)

Research spike for Kevin's 2026-11-22 brief. Energy is one user-facing view of what Game Maker can still spend on
development: provider API charges (fal, ElevenLabs, OpenRouter …) and agent capacity (Claude, Codex subscriptions).
It is not a gameplay currency. No product code here. The picks are in [decisions.md](decisions.md), and the
follow-on ticket bodies are in [follow-ons.md](follow-ons.md).

**Recommendation in one paragraph.** Keep Energy as a **status ring plus per-source detail**, not one converted
number. The ring fill is the headroom of whatever binds next (a percent of a window or of a cap), and it is never a
dollar sum. Coding capacity comes from aiur (`aiur.capacity` once #7893 merges). aiur already decides which source
an agent uses, and those sources can stand in for each other, so OGM takes aiur's `energy.level` as is. OGM's own
caps (instance day/week/month USD, fal, ElevenLabs) all have to fit, so they combine with it by the tightest one.
fal and ElevenLabs stay OGM-side for now because aiur's policy is scoped to coding work. Each figure carries a basis
tag (`reported` / `estimate` / `unknown`, `billed` only for invoices), `observed_at` and freshness. Subscriptions are
shown as percent of their window, and dollar figures for them are admin-only estimates with a range.

## What exists (checked 2026-11-22)

| Piece | Where | State |
|---|---|---|
| Energy service | `services/api/src/energy/{source,view,store,routes}.ts` | `localSource` only: the build ledger and admin-entered day/week/month/voice/images limits. Voice and images are `null`. One "Builds" resource row |
| Ring rule | `view.ts` `energyLevel` | Tightest known limit across windows **and** services; below 25 % left is `limited`, 0 is `critical`, nothing known is `unknown` |
| Contract | `packages/contracts/src/energy.ts` | `EnergyResource { label, provider, kind: subscription\|prepaid\|metered, spentMicroUsd, remainingMicroUsd, resetsAt }`. No basis, freshness or observed-at fields |
| Preference | `energy_preferences`, `gm energy`, `skills/gm-core/SKILL.md` "Energy" | Per user. Only effect today: agents read it through the job bundle and pick model/effort in prose. Nothing enforces it |
| fal ledger | `skills/gm-sprite-forge/scripts/fal3d.py` | Books fal's **listed** unit price before each call. Cap is `OGM_FAL_STOP_USD` (9.00). The path is `OGM_FAL_LEDGER` with no default |
| First real readings | #1217 (in rework) | aiur `aiur.usage`, the fal ledger and ElevenLabs `/user/subscription` behind `energySource()` |
| aiur policy | aiur `docs/plans/2026-11-08-7881-provider-capacity-policy.md`; #7886–#7892, #7958 merged | Reserve, last resort, billing class, hard USD limits, reservation ledger, reason codes |
| `aiur.capacity` | aiur #7893, PR #7949 (open) | `GET /api/v1/capacity`, `aiur capacity --json`. In the PR, USD limit figures are still `spent_usd: null` and `balance` is null |
| Live config | `open-game-maker-2000/.aiur/config` | `agent.priority: [codex, claude]`, `accounts.claude: [default, second]` (`second` is the Executor's login). `capacity.sources.claude.reserve.percent: 30` is a temporary Codex bridge until the 2026-11-25 reset (was 5). `~/.aiur/machine` has no `capacity` block |

The NUC's `aiur` CLI (0.0.9) has no `usage` subcommand, so this spike took no live reading. #1217 recorded one from
the API on the NUC: Codex weekly 97 % used, Claude `seven_day` 53 % (worst of two accounts), OpenRouter no reading.

## 1. Provider signals

Every claim is cited in [Sources](#sources). Probes were docs only: no keys and no paid calls. "Unofficial" means
the field comes from third-party code, not provider docs.

| Provider | Billing kind | Reported (endpoint, fields) | Window / reset | Freshness | Only estimable | How we read it today |
|---|---|---|---|---|---|---|
| **Claude subscription** (Pro $20, Max $100, Ultra $200) | Subscription windows | Claude Code status line `rate_limits.five_hour` / `seven_day` `used_percentage`, `resets_at` (official, after the first response) [S5]. `GET /api/oauth/usage` `five_hour`, `seven_day`, `seven_day_opus`, `seven_day_sonnet`, `extra_usage` with `utilization`, `resets_at` (**unofficial**) [U1][U2] | 5 h session plus a weekly limit at a fixed reset time per account; Ultra has no 5 h limit [S1][S3] | aiur polls every 300 s, stale after 2 intervals. `/usage` may serve a cache up to 60 min old [S4] | Dollar cost (status-line `total_cost_usd` is a local list-price estimate) [S5]. Model weighting (Opus vs Sonnet burn; no published ratio) [S4]. Executor vs worker share of one login | aiur `usage_api` → `aiur.usage` → `aiur.capacity` |
| **Codex / ChatGPT** (Plus $20, Pro $100/$200/$500) | Subscription windows + credits | App-server `account/rateLimits/read`, `account/rateLimits/updated`: `primary` / `secondary` `usedPercent`, `windowDurationMins`, `resetsAt`, `planType`, `credits`. `account/usage/read` daily buckets [S8] | Plus: 5 h + weekly ("may apply"). Pro: no 5 h limit now [S7] | Only when a session starts or the probe runs, so an idle Codex keeps an old reading (aiur plan §3) | Credit amount (aiur sees only `hasCredits`) [S8]. Fast mode 2–2.5×, image generation 3–5×, cloud tasks cost more [S7]. Dollar value per task | aiur `codex_app_server` → `aiur.usage` |
| **OpenRouter** | Prepaid balance (+ optional per-key cap) | `GET /api/v1/key` (inference key): `limit`, `limit_remaining`, `limit_reset`, `usage_daily/weekly/monthly` [S10]. `GET /api/v1/credits` (**management key**): `total_credits − total_usage` = balance [S11]. Per response `usage.cost` [S12] | None for the balance. Key limit resets per `limit_reset` | Not documented | Nothing material; cost is exact per call | aiur meter (balance needs the management key; key limit not yet polled, aiur PCP-2). Currently out of credit and out of `agent.priority` |
| **fal** | Prepaid balance | `GET api.fal.ai/v1/account/billing?expand=credits` `current_balance` (key scope `billing:usage:read`) [S14]. `GET /v1/models/usage` `cost_total` per endpoint, labelled estimate [S15]. `GET /v1/models/pricing` unit price, no special scope [S16] | None | Usage: "estimate" source is the fast one; "tagged-estimate" lags [S15] | Pre-call cost = unit price × expected units (what `fal3d.py` books) | OGM `fal3d.py` ledger only (estimate). Balance not read |
| **ElevenLabs** | Subscription quota (+ overage) | `GET /v1/user/subscription`: `character_count`, `character_limit`, `next_character_count_reset_unix`, `character_refresh_period`, `current_overage`, `next_invoice` [S17] | Monthly character period | Not documented | Dollar value of a character; whether `character_count` now means credits is not documented | `qa-voice-e2e.ts`; #1217 adds it to Energy. aiur reads quota in `eleven_labs/quota.ex`, outside its policy |
| **Netlify** (credit plans) | Subscription credits + auto-recharge | **No API.** Dashboard balance, breakdown, daily chart; email/in-app alerts at 50/75/(90)/100 % [S21][S22] | Monthly allotment (Free 300 hard cap, Personal 1,000, Pro 3,000+) [S20] | Dashboard only | Production deploy = 15 credits, compute 10/GB-h, bandwidth 20/GB, 2 per 10k requests [S20]. Running out **pauses all projects** [S21] | aiur `aiur.usage` lists Netlify (per #1218 brief). OGM could count its own `deploy.sh` runs × 15 |
| **Anthropic API** (metered, not used now) | Metered | Admin Usage & Cost API (admin key, ~5 min lag; legacy, replaced by the Analytics API) [S6] | Daily cost buckets | ~5 min | Balance (no endpoint) | Not used: no key, and `PAID_HOSTS` blocks it in games |
| **OpenAI API** | Metered | `/v1/organization/usage/*`, `/v1/organization/costs` (admin key) [S23] | Daily | Not documented | Balance | aiur voice/vision only: local `daily_minutes_cap` |
| **Gemini / Google TTS** | Metered | Per-call `usageMetadata` tokens only [S24] | – | – | All spend (count × price) | aiur voice: local minutes cap |
| **Deepgram** | Prepaid | `GET /v1/projects/{id}/balances`, `/usage/breakdown` [S32] | – | – | – | Not used |
| **Together** | Prepaid | `GET /v1/billing/usage` (beta, opt-in) [S31] | Monthly | – | Balance (402 at $0) | Not used |
| **Mistral** | Metered | `GET /v1/admin/usage` monthly (admin key) [S28] | Monthly | – | Balance | Not used |
| **Replicate, Stability, Cohere, Groq, AssemblyAI, Perplexity** | Prepaid / metered | Dashboard only. Replicate returns per-prediction `predict_time` [S25]. Groq blocks at the cap with a 400 [S30] | – | Groq 10–15 min, AssemblyAI 2 min [S30][S33] | All spend: count × published price | Not used |

What this means for Energy:

- **Exact and machine-readable:** OpenRouter (balance, per-call cost), fal (balance with a billing-scoped key),
  Deepgram. These can be `reported`.
- **Reported as percent of a window, never dollars:** Claude and Codex. The percent is `reported`; any dollar
  figure for them is an `estimate`.
- **Dashboard only:** Netlify and the other hosts. Count our own calls × published price, tagged `estimate`, or show
  `unknown`.
- None of these returns an invoice line, so `billed` stays unused until someone imports invoices (no plan to).

## 2. Subscriptions to budgets

Kevin's example: $200/month is about four $50 weekly budgets. Two corrections, then the mapping.

- A month is 52/12 ≈ 4.33 weeks, so $200/month is **$46.15 a week**. Four $50 weeks overstate it by 8 %, and a
  31-day month holds 4.43 weeks. Monthly USD caps must convert by 12/52, not ÷4.
- The $200 tiers are not one-window budgets. Claude's $200 tier ("Ultra") now has **no 5-hour limit** and a
  weekly limit, plus a separate Fable weekly limit on Max [S1][S3]. ChatGPT Pro has no 5 h limit now, Plus has one
  [S7]. The binding window differs by plan and changes with the provider's terms.

**Mapping.** A subscription is a set of windows. Each window is its own Energy resource:

| Field | Value | Basis |
|---|---|---|
| Used / left | `used_percent` of that window | `reported` |
| Reset | `resets_at` | `reported` |
| Binding window | the window with least left, per account; the worst account when several share a backend (aiur's rule) | derived from reported |
| Weekly budget in USD (admin only) | plan price × 12/52, e.g. $46.15 for $200 | `estimate` (a nominal share of the fee you already paid, not a marginal cost) |
| USD used this week (admin only) | `used_percent` × weekly budget, shown as a range ±(model-mix uncertainty) | `estimate` |
| API-equivalent value (admin only, optional) | aiur's usage aggregate: tokens × list price | `estimate`; usually several times the plan fee, so useful only as "what this would cost metered" |
| Hours left (agents, optional) | projected left ÷ learned burn per agent-hour (aiur ledger EWMA) | `estimate` as a range, e.g. "6–10 agent-hours"; `unknown` until burn is learned |

Why no single precise number: the percent is the only reported quantity, and its dollar meaning moves with model
(Opus burns faster than Sonnet, Codex fast mode 2–2.5×, image generation 3–5×) and with the provider's terms.
Spending subscription headroom costs nothing extra until the window runs out. So the honest unit for a subscription
is "percent of the binding window left, resets at T". Dollars appear only as an admin-side estimate.

**Settling the open #598 question.** One numeric meter that converts mixed resources is **not** recommended. Show
**a status (Healthy / Limited / Critical / Unknown) plus per-source detail**. The ring may still show a fill, but
only as the headroom of the binding constraint (a percent of something real), labelled with that constraint. This
is what `view.ts` and the aiur capacity view already do; the change is in what feeds them (section 3). Decision D1.

## 3. Data model

One pool per hosted instance. Underneath it, each provider's caps, windows and balances are separate resources and
are never summed across kinds.

### Resource kinds

| Kind | Meaning | Unit | Has reset | Example |
|---|---|---|---|---|
| `subscription_window` | Percent of a provider window | percent | yes | Claude `seven_day`, Codex `primary` |
| `quota` | Count against a provider allowance | characters, credits | yes | ElevenLabs characters, Netlify credits |
| `prepaid_balance` | Money left at the provider | USD | no (no fake expiry) | OpenRouter, fal balance |
| `metered_spend` | Money spent by us in a period | USD | period | fal ledger, OGM build ledger |
| `cap` | A limit we set over metered spend | USD | period | instance day/week/month, fal 9 USD, aiur `limits.daily_usd` |

`subscription_window` and `quota` replace today's `subscription`. `prepaid` and `metered` keep their meaning.

### One resource

```ts
type EnergyResourceV2 = {
  id: string;                 // 'claude/default/seven_day', 'fal/ledger', 'instance/week'
  provider: string;           // 'claude' | 'codex' | 'openrouter' | 'fal' | 'elevenlabs' | 'netlify' | 'ogm'
  account: string | null;     // aiur account name; null when the provider has one
  kind: 'subscription_window' | 'quota' | 'prepaid_balance' | 'metered_spend' | 'cap';
  serves: ('coding' | 'images' | 'voice' | 'deploy')[];   // what work this resource gates
  unit: 'percent' | 'usd' | 'characters' | 'credits';
  used: number | null;        // null = unknown, never 0
  limit: number | null;       // null = no limit known
  left: number | null;
  range: { low: number; high: number } | null;   // estimates only: the honest spread of `left`
  basis: 'reported' | 'estimate' | 'unknown' | 'billed';  // billed only for invoice lines
  resetsAt: string | null;
  observedAt: string | null;
  ageMs: number | null;
  freshness: 'fresh' | 'stale' | 'unknown';      // aiur's values, same thresholds
  origin: 'aiur.capacity' | 'aiur.usage' | 'ogm.ledger' | 'provider' | 'admin';
  editable: boolean;          // an admin cap OGM owns; aiur caps are read-only with their config layer
  state: 'available' | 'last_resort' | 'reserved' | 'limited' | 'held' | 'exhausted' | 'unknown';  // aiur source state, or derived
};
```

Rules (tests must fail if any is broken):

1. `unknown` or `stale` never reads as 0 or 100. A stale figure is shown with its age and does not drive the ring
   as healthy. It may drive it toward Limited if it already shows little left.
2. An `estimate` always carries a `range` or the word "estimate". It is never labelled `billed`.
3. A missing fal ledger file means no fal spend recorded, so `used: 0`, `basis: reported` (by us). It is not
   unknown, as #1217 already says. A missing ElevenLabs key or a 401 means `unknown`.
4. USD never sums across kinds. Instance caps cover `metered_spend` in USD only (fal ledger, build ledger,
   OpenRouter spend). Subscriptions are never converted to fill a USD cap.

### Pool and level

```
coding     = aiur.capacity.energy.level     (largest headroom among allowed, non-last-resort sources; null = unknown)
needs(job) = coding ∧ instance caps ∧ the service caps the job uses (images → fal; voice → ElevenLabs)
ring       = level of needs(build): the tightest of {coding, instance day/week/month}
services   = per-service badges (voice, images, deploy), each its own tightest-known
```

**Conflict to settle (Rule 7):** aiur's `energy.level` is the **max** over sources: a worker can start while any
source has headroom. OGM's `energyLevel` is the **min** over everything, including voice and images. Both are right
for their own question. Coding sources stand in for each other, so take the max. Caps all have to fit, so take the
min. OGM's ring should be `min(aiur coding level, instance caps)`, with voice and images as separate badges. Then an
empty ElevenLabs quota no longer shows a build as blocked. Decision D2. The current rule, where services drive the
ring, should be flagged for change in #1220.

## 4. aiur integration

**Moves to `aiur.capacity` once #7893 merges and the NUC runs it (#1220):** Claude and Codex windows per account,
OpenRouter balance and key limit, reserve and hold state, aiur's per-period USD limits and spend, the reason code per
source, and `energy.level`. OGM stops mapping raw `aiur.usage` windows for these providers, so dispatch and Energy
cannot disagree.

**Stays OGM-side:**

| Source | Why it stays | Read how |
|---|---|---|
| Instance day/week/month caps + build ledger | OGM's own admission (402); a game-player-facing limit aiur has no concept of | `localSource` (exists) |
| fal ledger | fal is called by OGM skills on the host, not by aiur dispatch. The 9 USD stop is OGM's | Ledger file (default path from #1217) |
| fal balance | Same owner. Needs a key scoped `billing:usage:read`; **do not add a key** without Kevin. Unknown until then | Optional: `GET /v1/account/billing` |
| ElevenLabs quota | Voice is out of aiur's coding policy (plan "Scope out") | `GET /v1/user/subscription` (#1217) |
| Netlify credits | No API; OGM owns `deploy.sh` | Count production deploys × 15 credits, `estimate`; admin enters the allotment |

**Should fal and ElevenLabs become aiur sources so the Executor's choice sees them?** Not as dispatch sources.
Neither one is an alternative to a coding backend, so adding them to `agent.priority` would change nothing the
Executor chooses. Two narrower things are worth it later:

- aiur's global `capacity.limits.<period>_usd` is meant to cover "all metered and prepaid sources together". It
  can't do that while fal spend is invisible to aiur. If Kevin wants **one USD cap across everything**, aiur needs
  a way to ingest external spend (gap A2). Otherwise OGM's instance caps stay the all-in cap. Decision D3.
- The Executor plans generation tickets (sprites, voice). Today it learns the fal and ElevenLabs state only by
  reading Energy. That is enough: the ring and service badges reach agents through `gm energy` and the job bundle.

### aiur gap drafts (for the NUC Executor to file through the PC liaison)

**A1. `aiur.capacity`: expose observation time for period USD spend.** PR #7949 leaves `limits[].spent_usd: null`
and `freshness: unknown` because `PeriodSpend` lacks `observed_at`. Clients then show every aiur USD limit as
unknown even though dispatch acts on it. Acceptance: limits carry `spent_usd`, `observed_at`, `age_ms` and
`freshness`, and a fixture with recorded spend validates.

**A2. Accept external metered spend into the usage aggregate (optional, after D3).** `POST /api/v1/usage/external`
(client write token) records `{provider, usd, basis: estimate|reported, observed_at, ref}` so
`capacity.limits.<period>_usd` covers non-coding spend (fal, ElevenLabs overage). It records spend only; it adds no
dispatch source. Acceptance: a global monthly limit is reached by external spend alone, and the capacity view shows
it.

**A3. Poll OpenRouter `GET /api/v1/key` (PCP-2 follow-up).** The per-key `limit_remaining` and `usage_*` need only
the inference key [S10], so the balance stops being unknown without a management key. Check whether this is already
filed from PCP-2 before filing.

**A4. Codex credit amount.** `aiur.usage` reports only `hasCredits`. The app server returns `credits` and
`rateLimitResetCredits` [S8]. Expose the amount when present, `unknown` otherwise.

**A5. NUC `aiur` CLI lacks `usage`/`capacity`.** `aiur 0.0.9` on the NUC answers `unknown command: usage`. Agents
can't read Energy from the CLI there. Either ship the CLI with the engine version, or document that the API is the
only reader.

## 5. Balanced conservation

**Who decides what:**

| Decision | Owner | Mechanism |
|---|---|---|
| Which backend/account a worker uses; Claude reserve for the Executor; Codex first; OpenRouter last resort; hard USD stops | **aiur** | `agent.priority`, `capacity.sources.*` (reserve, `last_resort`, limits), reason codes |
| What work is requested and how big (scope, optional generation, model/effort hints) | **OGM** | Ticket labels the Executor writes (`complexity:N`, `model:`), `gm-core` Energy rule, admission 402 |
| The player's own choice of cost vs quality | **Player** | Save / Balanced / Best |

OGM does not add a second provider chooser. The Executor preference "Claude for the Executor, Codex for coding
workers, OpenRouter last" is already aiur config: `priority: [codex, claude]`, `claude.reserve.percent` on the
Executor login, and OpenRouter `last_resort: true` once it has credit again.

**What the preference changes as Energy falls** (proposal; the rule lives in `gm-core` and the Executor's
ticket-cutting, not in aiur):

| Ring | Save | Balanced | Best |
|---|---|---|---|
| Healthy | Lower effort; cheaper model hint; optional paid generation (fal, ElevenLabs) asks first | Default effort/model; paid generation within caps | Strongest model, high effort |
| Limited (< 25 % left in the binding constraint) | Defer optional work; no paid generation without a `gm decide` | Lower effort one step; paid generation asks first; propose scope cuts via `gm decide` | Keep model; ask before paid generation |
| Critical (0 left) | Admission refuses (402) new builds until reset; show reset time | same | same |
| Unknown | Work as Balanced/Healthy for model choice, **but** do not start paid generation without a known cap | same | same |

Never cut scope silently, never lower a quality gate, and never route around an aiur hold. When aiur marks
every source held, the ticket waits with aiur's reason and OGM shows it. OpenRouter stays aiur's last resort. OGM
never asks for it by name. Decision D4.

## 6. Admin dashboard

Data sources: `GET /api/v1/energy/admin` (OGM, composed from `aiur.capacity` + OGM sources), history from a new
OGM sample table (one row per resource per poll, 60 s cache, kept 30 days).

Contents (detail in [follow-ons.md](follow-ons.md), #1219):

1. **Pool header:** ring level, binding constraint, its reset time, freshness.
2. **Provider rows:** Claude (per account, 5 h / weekly / model windows), Codex (per account, primary /
   secondary, credits), OpenRouter (balance, key limit, last-resort state), fal (ledger spend vs 9 USD cap, balance
   if readable), ElevenLabs (characters used/limit, reset, overage), Netlify (deploys × 15 vs entered allotment,
   `estimate`). Each row shows used/left, reset, basis tag, age, aiur state and reason (`reserve`, `last_resort`,
   `limit_weekly` …).
3. **Caps:** instance day/week/month and per-service caps (editable). aiur caps are read-only and name their config
   layer (`machine` / project `.aiur/config`), per `aiur config explain`.
4. **History:** 7- and 30-day lines per resource. Estimates are drawn as bands, reported as lines, unknown as gaps.
5. **Subscription USD (estimate):** weekly share of plan fee and the used share, as a range.
6. **Recent holds:** the last aiur dispatch decisions with reason codes (aiur #7892).

Non-admins get 403. Players never see dollar figures.

## Sources

S1 https://claude.com/pricing · S2 https://support.claude.com/en/articles/11145838-using-claude-code-with-your-pro-or-max-plan ·
S3 https://support.claude.com/en/articles/11049741-what-is-the-max-plan · S4 https://code.claude.com/docs/en/costs ·
S5 https://code.claude.com/docs/en/statusline · S6 https://platform.claude.com/docs/en/api/usage-cost-api ·
S7 https://learn.chatgpt.com/docs/pricing · S8 https://learn.chatgpt.com/docs/app-server ·
S9 https://learn.chatgpt.com/docs/developer-commands?surface=cli · S10 https://openrouter.ai/docs/api-reference/limits ·
S11 https://openrouter.ai/docs/api-reference/get-credits · S12 https://openrouter.ai/docs/use-cases/usage-accounting ·
S13 https://openrouter.ai/docs/api-reference/get-a-generation · S14 https://fal.ai/docs/platform-apis/v1/account/billing ·
S15 https://fal.ai/docs/platform-apis/v1/models/usage · S16 https://fal.ai/docs/platform-apis/v1/models/pricing ·
S17 https://elevenlabs.io/docs/api-reference/user/subscription/get · S18 https://elevenlabs.io/docs/api-reference/usage/get ·
S19 https://elevenlabs.io/docs/api-reference/authentication ·
S20 https://docs.netlify.com/manage/accounts-and-billing/billing/billing-for-credit-based-plans/how-credits-work/ ·
S21 https://docs.netlify.com/manage/accounts-and-billing/billing/billing-for-credit-based-plans/billing-faq-for-credit-based-plans/ ·
S22 https://docs.netlify.com/manage/accounts-and-billing/billing/billing-for-credit-based-plans/monitor-usage-for-credit-based-plans/ ·
S23 https://developers.openai.com/api/reference/resources/organization/subresources/audit_logs/subresources/usage ·
S24 https://ai.google.dev/gemini-api/docs/tokens · S25 https://api.replicate.com/openapi.json ·
S26 https://replicate.com/docs/topics/billing · S27 https://docs.stability.ai/api-reference ·
S28 https://docs.mistral.ai/admin/admin-api/usage-metrics · S29 https://docs.cohere.com/docs/cohere-faqs ·
S30 https://console.groq.com/docs/spend-limits · S31 https://docs.together.ai/reference/billing-usage ·
S32 https://developers.deepgram.com/reference/manage/billing/list · S33 https://www.assemblyai.com/docs/account-management ·
S34 https://docs.perplexity.ai/docs/getting-started/api-groups

Unofficial: U1 https://gist.github.com/monperrus/3ac4b303a84946bbeaf2b1123ee99491 ·
U2 https://github.com/anthropics/claude-code/issues/34348

aiur: `docs/plans/2026-11-08-7881-provider-capacity-policy.md` (§3 telemetry, §6 view); PR #7949
`packages/aiur-contracts/fixtures/capacity.v1.json`.

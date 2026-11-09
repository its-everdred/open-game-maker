# Open Game Maker 2000: v0.5 decision log

This file is the input for spec v0.5. It records the owner's decisions since v0.4 (2026-10-21 → 2026-10-22), the research recommendations still waiting on him, and the open questions. It is not a full spec; the full spec is v0.4 plus these changes.

What ships in each version (V1 = MVP, V2, V3) is in `release-plan.md`, derived from this log.

Sources:
- Kevin's chat messages and comments on the decision page (claude.ai artifact "Game Maker v0.4 Decisions").
- Research reports B1–B10 in `docs/research/v0.4/`.

## Positioning (owner direction)

- **A general game maker for everyone, with parental controls.** The product is not kid-focused. Child rules live in one parental-controls module that applies only to child accounts. (Kevin, 2026-10-22; restates spec §1.1.)
- **All child-account and parental-control scope moves to V3** (Kevin, 2026-10-25). That covers child accounts, guardian consent, parental controls, child-specific voice and vendor rules, and COPPA work. V1 and V2 are for creators who aren't children. Family roles that aren't about children stay in V1: admins, spending limits and invite-only play.
- **V1 is adults only (18+)** (Kevin, 2026-10-25: "adults only"). This removes every vendor rule for minors from V1, including ElevenLabs approval. Teens (13–17) come later, when vendor approvals arrive.
- **V1 sign-in has no age check** (Kevin, 2026-11-03: "remove the age check"). The instance operator's allow-list admits the intended adults, so the birth-date screen, server attestation and age cookie are removed. This supersedes the V1 age-screen parts of B3, B9 and B10; unrelated family roles and spending limits remain.
- **Name:** Open Game Maker 2000. The repo is `its-everdred/open-game-maker-2000`. (Kevin, 2026-10-21.)
- *Recommended, not yet confirmed (V3 only):* legally, build as **mixed audience by design**, per B9. A neutral age screen comes first when child accounts ship. Under-13 users go to a parent-created child account. COPPA duties apply to child accounts only.
- *Recommended:* three age bands.
  - **Adult (18+).**
  - **Teen (13–17):** an ordinary creator, but counted as a minor when choosing vendors.
  - **Child (under 13):** parental controls are always on.

## Decided by Kevin

| Area | Decision | Changes |
|---|---|---|
| Sign-in | Email is **mandatory** on every account and is the recovery path. Options under consideration: passkey only, Google only, or both. | §4.4 |
| Repos | No multi-repo setup and no games monorepo owned by the platform. At setup, the user connects GitHub, Game Maker creates the repo, and the user picks public or private in GitHub. | §3.5, §9.2; bring-your-own GitHub moves from V3 to V1 |
| Voice | Voice is an **aiur package** regardless. Providers: ElevenLabs first, OpenAI second. | §5.14, §7.2 |
| Art and audio | ~~V1 starts with skills and code tools only.~~ **Superseded 2026-10-25:** V1 assets come from three tiers, strongly preferred in order: (1) installed packs, (2) online free sources reachable by API, git or npm, used when the creator clearly asks for something the packs lack, then (3) agent-made assets. Paid generators are still a later optimization. See B11. | §5.3, §11.1, §12 |
| Asset packs | One pack library per instance, in the instance's S3-compatible bucket (Railway bucket by default). It is never in GitHub. A game repo holds only the assets it uses, plus a lockfile with license data. The engine repo is open source and ships no packs; Kevin's game repos are closed. The first packs are Kenney (CC0) and Synty (personal license, Kevin's instance only). The license policy is enforced when an asset is added to a game. (2026-10-25, B11) | §5.3, §9.6, §10.7 |
| AI funding | Hosted builds use **aiur with API-key profiles**. Build nothing new for this. | §8.1 |
| Spending | **Admins configure all spending limits.** The plan sets only the starting defaults. | §8.3–8.4 |
| Stack | **TypeScript only**, frontend (React) and backend (Node on Railway). Rust was considered and set aside (2026-10-23). Reconfirmed 2026-10-25 after comparing Godot, Lua (Defold, LÖVE), C#, C++, Rust and Haxe: browser load size, agent fluency in TS, and in-page editor and test hooks favour TS. Keep the engine–editor contract (manifest, design overrides, test hooks) message-based so a second runtime stays possible. The only Elixir is aiur and the thin voice_converse host. | §3 |
| aiur dependencies | aiur consumed as modular packages: voice_converse (git dep pinned to tags), the voice wire contract (JSON Schema), a TS voice client (npm), and hosted aiur over HTTP with versioned schemas. All tracked in Aiur-NUC's lane, including #5936 releases, #5937 per-job scoping (post-v1) and #5938 multi-repo hosting (v1). | §7 |
| Build analytics | **V1.** Surface aiur's built-in analytics to admins in Game Maker with fine-grained detail. Game Maker adds the game-making context aiur lacks (time on animation, playtesting, level building and so on). (2026-10-26, C2) | Admin UI |
| Style families | **V1.** The style picked at game creation (low poly, fidelity levels, 2D styles) maps to specific packs; one style family per game. (2026-10-26, C1, C2) | §5.3 |
| Point of view | Chosen at game creation: isometric, first person, third person, and others that fit the chosen style and genre. **V1 assumed**, alongside the other creation choices. (2026-10-26, C2) | §5.3, B7 camera gap |
| Budget-aware voice | The two-way voice agent knows the creator's remaining resources. For a change too large for what's left, it says so and offers to queue it for tomorrow or reduce the scope to fit today. **V1 assumed.** (2026-10-26, C2) | §7.2, §8.3–8.4, B8 §5 |
| Multiplayer | **V1, first-class** (supersedes "V1 reserves interfaces only"). Single player or multiplayer chosen at creation, convertible later. Invite links: friends sign in and drop straight into the game. Non-editors watch editor changes exactly as they happen and join play when Play is pressed. Each networked player has their own controller and point of view. (2026-10-26, C2 §6; design from A7 R12 and B7 §9) | §5.8, R12 |
| Drive watch folder | **V1.** An admin-configured Google Drive folder is watched for new asset files. After a debounce, an agent with a dedicated skill organizes each drop and makes it available, as a creation option or as agent material. Drops can be any size (pack, SFX set, a few models), not forced into packs tied to player choices. (2026-10-26, C2 §7) | §5.3, B11 |
| Branching | **Under consideration (Kevin, 2026-10-26).** A branch covers both a Git branch and a branch of the editor state. Play any branch; merge back with voice-guided conflict resolution. Recommended: branch-aware data model plus basic UI in V1 (C2 §8) | B7 §4, §9.2 |
| Map inspiration (D-MAPS-AGENT-ONLY) | **In scope and agent-only.** Upload D&D-style tabletop level designs as inspiration for any level. The map skill searches all inspiration resources by biome, feature and scale, derives a new layout, and renders it with the game's already-chosen visual set. Creators are never shown a map-source, map-pack or tileset choice. Images stay private; games get derived layouts. **Sources:** a purchased ProFantasy bundle first, used for inspiration only; its images and symbols are never used in games. (2026-10-26, C2 §9; clarified 2026-11-09) | §5.3, B11, C2 §7 |
| Asset tagging | **V1 asset pipeline.** Every asset gets rich metadata (environments, uses, objects, description and more) when it's organized, so agents choose without loading assets. **Usage rights are part of the card** (allowed uses such as in-game or inspiration only, audience, redistribution, attribution), set from the license and Kevin's decisions, strict by default, and enforced by code at search, build and publish. (2026-10-26, C2 §10) | §5.3, B11 §4.7 |
| Device-tiered assets | **V1.** Assets and textures get pre-processed mobile-friendly variants that load only on mobile. (2026-10-26, C2) Built into every game's asset use: a build step packs, compresses and tiers each asset with a manifest carrying its licence; the runtime picks the tier (Kevin, 2026-10-31; research and pipeline in C4). | §5.3, §10.7, C4 |
| Build chat | **V1.** The bottom loading bar becomes a full agent chat for the job being built: text, one-way voice (dictate) and two-way voice conversation. While building, the agent posts screenshots and short clips at each visible step so the creator can weigh in mid-build, the way Claude works with Kevin in this repo. The agents' design skill tells them to do this. (Kevin, 2026-10-31) | §5.5 progress board, §7.2 |
| Process | No tickets or aiur build order yet. aiur's in-flight build order will be split across two machines, with Game Maker components first (`docs/handoff/aiur-executor-split-prompt.md`). | — |

## Picked by Kevin on the decision page (2026-10-22, 17:45–18:00)

Picks marked **(V3)** concern child accounts and are deferred with them. They stay recorded for V3 planning.

| Card | Pick | Note |
|---|---|---|
| Consent method | Signed form plus confirmation email **(V3)** | As recommended |
| What admins can turn on for a child | Anything the guardian has pre-approved **(V3)** | Not the recommendation ("stricter only"), but COPPA-compatible |
| Child voice input | Always the self-hosted provider; ElevenLabs and OpenAI for adults only **(V3)** | Stricter than the recommendation |
| Narration | ElevenLabs once approved; Kokoro until then | As recommended |
| aiur voice component | aiur package, plus a self-hosted provider and a no-transcript mode | As recommended |
| Paid art generators | None in V1 | Matches his comment |
| Drawing photos | Allow AI restyling through OpenAI after zero-retention approval and parent consent | Later feature. Adults need only the zero-retention approval; parent consent is V3 |
| Audio | Code-composed audio and free packs | — |
| GPU server | None | — |
| CDN | None in V1 | — |
| Bucket | Railway | — |
| Deleted uploads that forks reuse | Forks keep their copy | The COPPA conflict is moot until V3, since V1 has no child data. Revisit with child accounts |
| Claude path | "Build Agent SDK worker now" | **Superseded** by his later comment: use aiur with API keys and build nothing new |
| Coding agent in the sandbox | aiur's own tool loop (Kimi, DeepSeek or OpenRouter models) | **Confirm.** This drops Claude Code and Codex from hosted builds, and these vendors' terms haven't been checked |
| Sandbox network | E2B with an allowlist | — |
| Games and the microphone | Games may use the mic directly | The child-account question is deferred to V3 |
| Games domain | Separate custom domain | — |
| Who starts repairs | Reproducible crashes auto-repair | — |
| Repair slots | Share the edit slots | — |
| Repair attempts | Decide after measurement | — |
| Edit takeover | Either side takes over instantly | — |
| Lawyer | Before any outside family joins | — |
| Controller library | Allow Norigin as an exception | — |
| Platform listener | Dedicated accounts | — |
| aiur gaps | Work around for V1, then file upstream | — |
| All research spends | **Not yet** (models, voice, sandbox, art, domain) | No spending approved |
| Sign-in | "passkey" (the original option) | **Stale.** It was picked before the card was reworked into passkey only / Google only / both |

## Recommended, awaiting Kevin

- **(V3)** **Positioning:** mixed audience by design. Ask a neutral age question at signup; children get a parent-created child account (B9).
- **(Post-V1)** **Teens (13–17):** ordinary creators who count as minors when picking vendors; supervision is optional.
- **Sign-in:** passkey and Google on every account, never Google alone. **(V3)** Child accounts use a passkey the guardian sets up, with Google off until a test on a real Family Link device passes.
- **(V3)** **Child games' repo:** a separate repo per child in the guardian's GitHub, private by default.
- **Launch order:** adults only in V1; teens after vendor approvals; child accounts in V3, after the COPPA document set is drafted.
- **Admin takeover of an adult member's game:** not allowed. Takeover applies only to supervised accounts.
- **Gemini/Vertex generative AI and fal.ai:** stay excluded until each confirms in writing.

## Open questions for Kevin

1. ~~Do the free CC0 art kits count as "tools" for V1?~~ Answered: yes, packs are the default (B11). New questions: may family accounts use personal-license packs; which licenses tier 2 allows; and Poly Haven's API terms (B11 §6).
2. Does "admin" for spending limits mean any family admin, or only Kevin as operator? If any family admin, should a platform-wide ceiling sit above them?
3. Email Anthropic to confirm whether aiur's Claude Code can run on Kevin's API key for family jobs, given the hosting clause in Claude Code's terms.
4. All research spends are "not yet". Should any run before planning, Voice accuracy for child accounts no longer blocks V1.
5. Resolve the conflicts flagged in the picks table: deleted uploads vs forks, the coding agent in the sandbox, games and the microphone, and the stale sign-in pick.

## Action items only Kevin can do (free)

- Email Anthropic sales about the Claude Code hosting clause.
- Apply for ElevenLabs written approval and for OpenAI zero data retention.
- Optionally, ask Google and fal.ai in writing whether a mixed-audience product may use them for adult features.

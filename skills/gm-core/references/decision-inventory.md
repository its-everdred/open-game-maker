# Decision inventory and prototype review

Deciding is the creator's fun; hunting for what to decide is not (Kevin, 2026-11-20: "agents should think of the
questions and decisions so the user doesn't have to"). Agents list every product decision a game holds, put each one
in front of the creator with media, and build the recommendation meanwhile. A decision made silently in a ticket is a
defect, and so is a playable build the creator was never shown.

## The inventory

One per game, in the instance repo: `docs/<slug>/decisions.json` (an array) and `docs/<slug>/decisions.md`, rendered
from it in the same commit (grouped by area; one row per decision: id, question, options, recommendation, status,
answer, ticket). Never edit the `.md` alone.

| Field | Holds |
|---|---|
| `id` | Stable, `<area>-<short-name>` (`enemies-first-biome`). Never reused or renumbered. |
| `area` | `enemies`, `town`, `classes`, `combat`, `inventory-ui`, `loot`, `upgrades-progression`, `world-biomes`, `bosses`, `hud-controls`, `audio`, `story-townsfolk`, `meta-run-structure`, `look`. Add areas the genre needs (a puzzle game: `pieces`, `modes`, `scoring`). |
| `question` | What the creator decides, in player words, a few words long. |
| `why` | What it changes in play, one line. |
| `options[]` | `{label, media}` or `{label, media_needed}`: `media` is a path or URL to the still, clip, audio or playable; `media_needed` says what to make before it can be asked. |
| `recommendation` | The option label the agent would ship, and why in one line. |
| `sources[]` | Where it came from: a New Game form field, a privacy-safe summary of the conversation (never the raw words), a ticket, a doc path. |
| `ticket` | The ticket that builds it; `null` until one exists. |
| `phase` | The approval rung represented by a `review/decisions.json` screen target or answered ticket decision: `mock`, `prototype`, `build`, or `polish`. Creative prototype PRs require `mock` or later; build PRs require `prototype` or later. |
| `status` | `open` (not yet asked) → `asked` (a Command is raised) → `answered` (the creator picked) or `defaulted` (the recommendation stands after silence; a later answer still wins). |
| `answer`, `answered_at` | The picked label plus any note; ISO time. `null` until then. |

```json
{ "id": "enemies-first-biome", "area": "enemies", "question": "Which enemies in the first biome?",
  "why": "Sets the first ten minutes of combat", "options": [
    { "label": "Goblins and wolves", "media": "review/enemies/lineup-a.png" },
    { "label": "Skeletons and bats", "media_needed": "lineup of the pack's undead sprites" } ],
  "recommendation": "Goblins and wolves: the pack has full walk and attack sheets for both",
  "sources": ["form: genre", "conversation: wants a forest opening", "ticket #14", "docs/spec/enemies.md"],
  "ticket": 14, "status": "open", "answer": null, "answered_at": null }
```

What belongs in it:

- **Anything a player would notice and a creator would enjoy choosing:** which enemies, town buildings, classes,
  loot and treasure, upgrades, inventory and HUD layouts, bosses, biomes, music, townsfolk, run structure, rules.
- **Fine-grained.** One entry per thing judged by itself: "which three enemies", "what the chest drops", "the
  inventory grid", never "combat design". A new game holds dozens.
- **Product only.** Nothing about engines, libraries, file layout, tooling, budgets or CI.
- **Real assets first.** When the packs already hold candidates (enemies, buildings, items, tracks), the options are
  a lineup of those real assets (`gm assets search`, `gm assets sheet`), never a generated mock of them.
- **Always a recommendation,** so work never waits.

Other records stay what they are: `design/decisions.json` (the Commands `gm decide` has asked), `review/decisions.json`
(approved look targets), `design/feedback.json` (rejections) and the spec's decision log (what the design conversation
settled; each settled item enters the inventory as `answered`).

## Who writes it

1. **Planning.** For a new game the Executor writes the inventory from the form, the conversation and every ticket's
   spec before queueing tickets (`gm-new-game-plan`). For a feature on an existing game, whoever scopes it adds the
   feature's decisions first (`gm-scope-options`). Each ticket body lists its ids under `## Creator decisions`.
2. **Building.** At the start of a ticket, raise each of its `open` decisions as a non-blocking Command with media on
   every option: one decision per Command, or one multi-question Command when the creator judges each option
   separately (like or dislike each enemy). Set `status: asked`, build the recommendation, and continue. A decision
   you discover while building goes into the inventory first, then is raised the same way.
3. **Answers.** The worker that receives the answer writes `answered`, `answer` and `answered_at` in its next PR. The
   Executor writes `defaulted` when it applies a provisional default.

## Prototype review

Every playable build that changes what the creator can do or see reaches them as a prototype review, raised by the
worker as a non-blocking review Command (the first walk-around demo counts). Its body:

```md
## Prototype review
Play: <play link>   Clip: <phone-playable MP4>
**Works now:** move with the stick, enter the shop, open the chest
**Known limitations:** no attacking, no walk animation, no setting yet
**Weigh in on:** enemies-first-biome, town-shop-building, inventory-ui-grid
```

- **Works now** and **Known limitations** are checked in that build, not copied from the ticket. A limitation the
  creator would hit in the first minute is always listed.
- **Weigh in on** names 3–6 inventory ids this build makes judgeable, each raised as its own decision.
- Put the same section in the PR body; a PR with no creator-visible change writes `Prototype review: none`.
- Ship the recommendation meanwhile. The build is not delivered until its review is raised.

# Game Command inbox

The Commands inbox lists the open aiur Commands of one game's tickets and answers them through the same path as the
build chat. Aiur owns Command persistence, revisions and answer validation; Open Game Maker owns the mapping from a
game to its ticket identifiers and never receives aiur supervisor credentials.

## Reading the inbox

`GET /api/v1/games/:gameId/commands` returns the open Commands of every job in the game that the caller may edit:

```json
{
  "commands": [
    {
      "job_id": "j_...",
      "ticket": "478",
      "title": "Build the moon gate",
      "command_id": "cp_...",
      "decision_id": "d_...",
      "version": 3,
      "question": "Which gate should the courtyard use?",
      "options": [
        { "id": "stone", "label": "Stone arch", "media": { "url": "...", "width": 640, "height": 360 } },
        { "id": "wood", "label": "Wooden door" }
      ],
      "recommend": "stone",
      "blocking": true,
      "opened_at": "2026-11-04T10:00:00.000Z"
    }
  ]
}
```

Commands are newest first. A Command appears only once aiur's decision is correlated, so `decision_id` and `version`
are always present; answered, moot and uncorrelated Commands are left out. `summary` is the decision's short topic (aiur's
`short_summary`) when it has one; a builder's Command keeps its job's title instead, since `gm command request` sends
the same placeholder topic for every question. `media` is a signed blob URL, the same one the build chat renders for an
option that carries an image, GIF, video or audio.

### Player-facing only

The inbox lists only Commands meant for the player. Engineering and operations questions go to the Executor and never
reach a creator view. Aiur has no audience field yet, so a decision aiur holds counts as the player's only when it
carries Game Maker's creator marker (`CREATOR_AUDIENCE_MARKER`, which `gm decide` writes) or a gm command marker;
any other decision is left out. A builder's own `command.request` question is the player's by construction.

## The menu's decision inbox

`GET /api/v1/me/commands` returns the signed-in creator's open player-facing Commands across every game they may edit,
in the same shape plus `game_id` and `game_title`. Commands that block their build come first, then the longest
waiting. The top-right menu badge counts them, lists their topics, and opens each in a decision modal that offers
the next one after an answer. Each answer goes through its game's route, as below. A game whose aiur instance does not
answer within 5 seconds, or that fails to list, is left out of that read rather than failing the others.

### Product questions

A product question is a creator Command in plain words with no media (rules, scope, audience). `gm ask` raises one with
Game Maker's creator marker and its text-only marker (`CREATOR_TEXT_ONLY_MARKER`); a look, sound or feel question is a
review-deck decision (`gm decide`) and carries the thing itself on every option. Product questions carry
`text_only: true` and are never shown one by one: both inboxes leave them out of `commands`. When a game has at least
`OGM_VOICE_QUESTIONS_AT` (default 5) queued, `GET /api/v1/me/commands` lists it once in `question_sessions`
(`game_id`, `game_title`, `count`), and the menu shows that game as one entry offering a quick voice chat. It is never
pushed or opened on its own.

Opening the entry starts two-way voice on the `questions` target (`{ kind: "questions", game_id, creator_id }`). The
agent is briefed with the queued questions, oldest first, and the game's decision record, and asks them one at a time.
A clear spoken answer is saved to its Command at once, through the job's command when a build owns it and as the
creator's own aiur answer otherwise. An ambiguous answer, a skip or a stop leaves the question queued.

## Answering

Answer through the job's command route, not the inbox route:
`POST /api/v1/jobs/:jobId/commands/:commandId/answer` with `{ "option_id": "stone" }`. It validates the option
against the job's Command and calls aiur's canonical Decision API with the Command's `version`, so an answer
from the inbox, from the job conversation modal and from an inline Command card are the same operation. A `409`
means another writer answered first and the returned status is the winner's.

## Preview reviews

A game's Review view also lists workspace previews sent with `gm preview`. Each preview plays in its card and offers
Looks right or Needs work with an optional note of up to 3,900 characters. The answer is delivered to the ticket that uploaded the build; the
card leaves the queue after delivery and a later upload opens a new one. Preview files and assets use a short-lived,
revocable access URL issued to a game editor and an isolated frame, and never change the live build or share its asset cache.
After a verdict, the editor can still show the latest preview for its game branch while the build remains unmerged;
the previous review URL is revoked. Editors can retrieve retained builds through `GET /api/v1/games/:gameId/editor/preview-history`; the response issues short-lived access links for the prior rounds. Single-choice Commands can also be
answered from the queue using their letter buttons and an optional note; opening a row still shows its media deck.

## Skipping a question

`POST /api/v1/jobs/:jobId/commands/:commandId/skip` takes the Command's recommended option without the player
choosing, and records the decision as skipped. A Command without a recommendation cannot be skipped (`409`
`command_recommendation_missing`).

## Design decisions

Every answered New Game Command — in the creation chat's `scope` ticket or on the New Game request's own ticket — is a
design decision. Each records the decision id (`D-01`, `D-02`, …), the question, the options, the recommended option,
the answer that now stands, whether the player answered or a provisional default did, whether the player skipped, what
it affects and what it superseded. An answer on an edit's feature ticket is not a design decision.

- **Provisional default.** An open design Command with a recommendation that goes unanswered for
  `OGM_DESIGN_DEFAULT_MS` (default five minutes) is answered with that recommendation. The default is provisional: it
  unblocks the tickets waiting on the Command, and the Executor is messaged on the New Game parent issue so it can
  re-plan the Build Order.
- **Late change.** A later answer to the same Command is a new decision whose `supersedes` names the earlier one. Aiur
  keeps the answer the Command was first given; the decision history carries the later choice, and the Executor is
  messaged with the decision id and affected tickets so it can re-plan with `gm-new-game-plan`. The answer route returns
  `200` with `status: "superseded"` and the earlier decision's id in `supersedes`.
- A repeat of the same answer for the same Command records nothing and answers `200` with the answer already standing.

`GET /internal/games/:gameId/design-decisions` returns the whole history, oldest first, to the shared internal secret
(`x-ogm-internal`) or to a design agent's scoped `ngc1` request token whose game is this one — the private read the
Executor and the design agent use. A token minted for another game's request is `403`; a user session reads neither.

```json
{
  "decisions": [
    {
      "id": "D-01",
      "game_id": "g_...",
      "job_id": "j_...",
      "ticket": "42",
      "command_id": "cp_...",
      "decision_id": "d_...",
      "question": "Which door?",
      "options": [
        { "id": "wood", "label": "Wooden" },
        { "id": "iron", "label": "Iron" }
      ],
      "recommended": "iron",
      "chosen": "iron",
      "origin": "default",
      "skipped": false,
      "affects": ["42"],
      "supersedes": null,
      "at": "2026-11-04T18:06:00.000Z"
    }
  ]
}
```

`GET /api/v1/games/:gameId/design-decisions` returns the player's readable summary — the question, the chosen label and
whether the choice was theirs or a default — to a signed-in member who may play the game. The options and the aiur
decision id stay in the private history.

## Embedding

The browser renders the inbox and every job conversation through aiur's embeddable components (aiur#7487, #7488) when
they are installed, and through Open Game Maker's own markup until then. That covers the per-job modal opened from the
menu, the editor's feature scoping dock and New Game creation, whose scope session is job-backed. The adapter in
`apps/web/src/features/aiur/embed.tsx` hands each element a scope (`game`, the game's aiur `tickets`, and Open Game
Maker's proxy URLs for `commands`, `conversation` and `stream`) plus its features, and reads answers back from the
element's `aiur-answer` event. Every URL in that scope is an Open Game Maker route: the browser never calls aiur.

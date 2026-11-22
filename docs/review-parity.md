# In-app review parity (#1133)

The Needs Review deck checked against the review page, #1124 items 1–9, on a 390×844 phone.
Run: `pnpm --filter @ogm/web exec playwright test e2e/review-parity.spec.ts --project=phone` (5 tests, all pass;
the desktop project skips them).

Each row says what the spec proves in the app. The page column is Kevin's side-by-side look with the same cards
open on the page, which retires the page (#1124's Done).

| # | Item | App | Evidence | Page side by side |
|---|------|-----|----------|-------------------|
| 1 | Like/dislike per option, None of these, note-only, a note on any card | Pass | [command card](review-parity/parity-command-card.png); the spec checks the exact answer bodies: likes, a dislike with its reason, a note on the liked option, a card note; a note-only inventory answer; None of these | Kevin |
| 2 | Matrix cards: inline 👍/👎/✎, enlarged view with the same buttons and a per-cell note, ≥96 px cells, sideways scroll | Pass | [matrix](review-parity/parity-matrix.png), [enlarged](review-parity/parity-matrix-enlarged.png) | Kevin |
| 3 | Clips autoplay muted and looped, inline on iOS; audio tap-to-play | Pass | [clip](review-parity/parity-clip.png); the clip's time advances muted with `loop` and `playsinline`; the sound is still paused after a second | Kevin |
| 4 | Answered cards collapse to the title and the saved answer; tap to reopen | Pass after fix | [collapsed](review-parity/parity-collapsed.png) | Kevin |
| 5 | Metadata under every image | Pass | Under every option, matrix cell (originals too) and round clip: kind · model · cost or free · skill · tool · time · AI | Kevin |
| 6 | The original beside each candidate; pipeline rows | Pass | The original leads each row and carries no vote; a pipeline row reads Original, 3D, 2D pixel whatever order it arrives in; the enlarged view shows the original beside the candidate | Kevin |
| 7 | Prototype cards: play link, clip, works now, known limitations, weigh in | Pass after fix | [prototype](review-parity/parity-prototype.png) | Kevin |
| 8 | Phone-first at 390×844; the Recommended line at the top | Pass | Recommended sits under the question, above the options; nothing scrolls sideways; every button is at least 32 px tall | Kevin |
| 9 | Commands from the NUC games daemons, the NUC core daemon and the PC core daemon, plus inventory decisions, in one deck; answers reach the worker in Kevin's words within about a minute | App side passes; the minute is not timed yet | [all sources answered](review-parity/parity-sources-answered.png); all five sources list in one deck; each answer posts in Kevin's exact words to its own route (game, `/core/commands`, `/core/commands?daemon=pc`) within a second of the tap. The time from the server to the worker's ticket needs a live answer on a real Command | Kevin, with a live timing |

## Fixed here

- **Item 4:** tapping a collapsed answer whose Command had closed jumped to the next open card instead of showing
  the saved answer (`ReviewInbox.tsx`).
- **Item 4:** a core or PC Command's collapsed row said "Answer saved in this session". Only games have a review
  ledger, so the row now keeps the likes, dislikes and note the deck sent (`useAnsweredReviews.ts`;
  `CommandReviewCard.tsx` passes the sent review to `onAnswered`).
- **Item 7:** every prototype card showed "No media; asking the agent…", which never cleared, because a
  prototype round always has a build and nothing asks for its media (`ReviewInbox.tsx`).

## Not covered

- The phase strip and the advance-phase answer Kevin asked for in a #1124 comment on 2026-11-21 are not in items
  1–9, so this check leaves them out. No ticket covers them yet.
- The per-card link to the ticket's agent chat is #1110.

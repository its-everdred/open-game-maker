# Launch system-test coverage audit

Baseline: `ed58582f20b103ba01029899819256c31d9ca947`. This table distinguishes browser UI tests using mocked routes from system tests that exercise the real host. A UI fixture is not evidence of a complete host workflow. Both 390×844 and 844×390 mobile interactions and a deliberate failure for each path remain acceptance requirements.

| Workflow | Existing evidence | Gap at baseline |
| --- | --- | --- |
| Sign-in and permissions | `apps/web/e2e/auth.spec.ts` covers sign-in screens and protected-route navigation with route fixtures. | Real authentication and authorization across the host are not established by those fixtures. |
| New Game | `apps/web/e2e/new.spec.ts` covers UI admission with fixture routes. | Real-host creation through planning and first playable is assigned to #1402; coordinate rather than duplicate. |
| Chat and voice | `apps/web/e2e/build-chat.spec.ts` covers text, attachments and voice errors using fixtures. | Real-host chat and voice journeys and both mobile orientations need system evidence. |
| Reviews and responses | `apps/web/e2e/review-deck.spec.ts` covers voting and answers using fixtures. | Real-host review and response persistence need system evidence. |
| Manual editing | `apps/web/e2e/game-editor.spec.ts` covers cross-origin editor transactions and undo. | A journey against real host state in temporary folders needs evidence. |
| Launch, play and pause | `apps/web/e2e/host-pause.spec.ts` covers pause controls; `app-switch-pause-blobs.spec.ts` requires an optional real Blobs dist. | Real-host launch and pause at both mobile orientations need evidence. |
| Bug reporting | `services/api/test/reports-route.test.ts` covers server routing and authorization; the launch plan records broken UI reports (#1333) and additional capture work (#1334). | A real-host submission and resulting report need system evidence. |
| Minerals/Gas | `services/api/test/budget/routes.test.ts` covers budget status and job refusal at the API; the launch decisions describe ongoing work on budgets (#1404, #1414, #1220). | Real-host exhaustion and refusal need system evidence against the delivered interface. |
| Blobs CPU and online | The separate Open Games checkout has `games/blobs/tests/cpu-match.spec.ts` for all three CPU levels at both sizes, but it runs the game standalone. The launch plan records a failed online hosted run; `app-switch-pause-blobs.spec.ts` skips without `OGM_BLOBS_DIST`. | CPU and two-client online gameplay require real-game system evidence. |

## Failure history

- #350 records a 500 ms room phase transition timeout in CI run 41532661946. The desktop case remains quarantined in `apps/web/e2e/room.spec.ts`; the underlying timing failure still needs investigation.
- #1260 reports a duplicate blob request in CI run 45067049457. The service worker returns the fetched response while its cache write continues under `waitUntil`; the browser test previously navigated to the next build as soon as the response rendered, before that write necessarily finished.
- Local post-deploy logs contain 14 New Game runs. The latest, `ed58582f20b1`, exited 1 with missing API, repository, internal token or QA session configuration. The launch plan records earlier timeouts and a 502. The later decisions replace production create/delete checks with local temporary-folder tests (#1402).
- The latest voice log, `2f4c0698b837`, exited 1 after truncated dictation; two-way audio passed. The preceding `aa7366ad9abe` run passed both. An earlier `fe5db11dc45b` run timed out in both paths.
- The latest review log, `328c6688e4ea`, exited 0; `df2f74c14f91` exited 1 when the review-note fill timed out at 820×1180. These historical production observations do not prove local system coverage.

This baseline audit is incomplete until the missing system journeys and deliberate breaks are recorded with their actual results.

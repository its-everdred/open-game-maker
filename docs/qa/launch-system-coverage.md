# Launch system-test coverage audit

Baseline: `ed58582f20b103ba01029899819256c31d9ca947`. This table distinguishes browser UI tests using mocked routes from system tests that exercise the real host. A UI fixture is not evidence of a complete host workflow. Both 390×844 and 844×390 mobile interactions and a deliberate failure for each path remain acceptance requirements.

| Workflow | Existing evidence | Gap at baseline |
| --- | --- | --- |
| Sign-in and permissions | `apps/web/e2e/auth-system.spec.ts` follows a real local magic link at both sizes and checks anonymous and non-admin access against the API; `auth.spec.ts` also covers screens using route fixtures. | The local test uses a private in-memory database and outbox. It does not cover external email delivery or every role and game grant. |
| New Game | `apps/web/e2e/new.spec.ts` covers UI admission with fixture routes. | Real-host creation through planning and first playable is assigned to #1402; coordinate rather than duplicate. |
| Chat and voice | `apps/web/e2e/auth-system.spec.ts` sends and stores a text chat message through the local API and exercises real browser audio capture and the local token route against a fake provider at both sizes. `build-chat.spec.ts` covers UI states using fixtures. `packages/voice-client/e2e/client.spec.ts` and `services/voice-host/test/ogm_voice/e2e_fake_provider_test.exs` exercise voice with fake providers. | Agent delivery and replies, and speech recognition quality, still need evidence. The external agent relay is absent in the local chat test, and the dictation provider supplies a fixed transcript. |
| Reviews and responses | `apps/web/e2e/auth-system.spec.ts` submits a review verdict and note to the local API; `review-deck.spec.ts` covers card voting and answers using fixtures. | The local round test covers verdict persistence, not every card type or delivery to an agent. |
| Manual editing | `apps/web/e2e/auth-system.spec.ts` stages a relative-base 3D template in a temporary games host and submits a lighting edit to the real API at both sizes; `game-editor.spec.ts` covers cross-origin transactions and undo with route fixtures. | The local test does not cover every tool or a creator's own game. |
| Launch, play and pause | `apps/web/e2e/auth-system.spec.ts` opens a temporary hosted 3D build, enters play, pauses and resumes at both sizes. `packages/host/src/browser/mobile-lifecycle.spec.ts` additionally verifies touch movement and frozen game time while paused. `app-switch-pause-blobs.spec.ts` requires an optional real Blobs dist. | The local app journey uses a template, not a creator's own game. |
| Bug reporting | `services/api/test/reports-route.test.ts` covers server routing and authorization; the launch plan records broken UI reports (#1333) and additional capture work (#1334). | A real-host submission and resulting report need system evidence. |
| Minerals/Gas | `services/api/test/budget/routes.test.ts` covers budget status and job refusal at the API; the launch decisions describe ongoing work on budgets (#1404, #1414, #1220). | Real-host exhaustion and refusal need system evidence against the delivered interface. |
| Blobs CPU and online | The separate Open Games checkout has `games/blobs/tests/cpu-match.spec.ts` for all three CPU levels at both sizes, but it runs the game standalone. The launch plan records a failed online hosted run; `app-switch-pause-blobs.spec.ts` skips without `OGM_BLOBS_DIST`. | CPU and two-client online gameplay require real-game system evidence. |

## Failure history

- #350 records a 500 ms room phase transition timeout in CI run 41532661946. A local unquarantined probe reproduced the failure; a diagnostic run observed the transition after 254 ms. The test now waits for the state in the browser instead of sampling over the process boundary with a 500 ms deadline, and the desktop case has been restored.
- CI run 45929397673 failed the screen-route reservation test for `welcome`; run 45916892196 failed four database migration tests after an extra migration appeared. Both reported assertion failures; these logs alone do not establish whether either is flaky or related to a launch journey.
- #1260 reports a duplicate blob request in CI run 45067049457. The service worker returns the fetched response while its cache write continues under `waitUntil`; the browser test previously navigated to the next build as soon as the response rendered, before that write necessarily finished.
- Local post-deploy logs contain 14 New Game runs. The latest, `ed58582f20b1`, exited 1 with missing API, repository, internal token or QA session configuration. The launch plan records earlier timeouts and a 502. The later decisions replace production create/delete checks with local temporary-folder tests (#1402).
- The latest voice log, `2f4c0698b837`, exited 1 after truncated dictation; two-way audio passed. The preceding `aa7366ad9abe` run passed both. An earlier `fe5db11dc45b` run timed out in both paths.
- The latest review log, `328c6688e4ea`, exited 0; `df2f74c14f91` exited 1 when the review-note fill timed out at 820×1180. These historical production observations do not prove local system coverage.

## Deliberate breaks

- Sign-in and permissions: temporarily removing the admin authorization call in the local API made the 390×844 system test fail: the admin endpoint returned 200 instead of 403. The source was restored before the passing run.
- Reviews: temporarily rejecting the local review answer made the portrait system test fail because the verdict and note remained unset. The source was restored.
- Chat: temporarily rejecting the local API chat write made the portrait system test fail because no message was stored. The source was restored before the passing run.
- Dictation: temporarily rejecting the local dictation-token request made the portrait system test fail because no audio reached the provider. The route was restored after the probe.
- Manual editing: before the pointer-events fix, the portrait system test could not tap Night because the game iframe intercepted the lighting palette. The same test passed after the fix and stored a design transaction.
- Host launch, play and pause: temporarily dropping `lifecycle.pause` from the local host bundle made both viewport tests fail as the game clock continued. The bundle was restored before the passing run.

The remaining paths still need real-host journeys and deliberate-break evidence. The local sign-in run forwarded auth and API requests to its local server, but the preview's unrelated telemetry beacon attempted its default API port and was refused; telemetry is not covered by that result.

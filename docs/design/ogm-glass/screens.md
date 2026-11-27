# Screens, status and tickets

Canvas: https://claude.ai/artifact/2R9v9J41qPrtnay5DbbUjM. Each link opens that artboard. Status: **existing** (restyle of a shipped screen), **Monday** (new for the 2026-11-30 launch), **future** (designed now, built later). Audit: routes in `apps/web/src/routes/*/route.tsx` at core main ed58582f2, captured at 390×844 and 1280×800 with the mocked API.

| Screen | Artboard | Status | Route / code today | Tickets |
|---|---|---|---|---|
| Tokens, components | [Main](https://claude.ai/artifact/2R9v9J41qPrtnay5DbbUjM#artboard-Main), [Components](https://claude.ai/artifact/2R9v9J41qPrtnay5DbbUjM#artboard-Components) | Monday | `tokens.css`, `review-glass.css` | #1449 |
| Title + Start | [Title](https://claude.ai/artifact/2R9v9J41qPrtnay5DbbUjM#artboard-Title) | existing | `/` TitleScreen, TitleTown | #1419 |
| Sign in | [SignIn](https://claude.ai/artifact/2R9v9J41qPrtnay5DbbUjM#artboard-SignIn) | existing | `/signin`, `/login` | #1407 |
| Invite / join | [Join](https://claude.ai/artifact/2R9v9J41qPrtnay5DbbUjM#artboard-Join) | Monday | `/join/:inviteToken` | #1407 |
| Account + view-as | [Account](https://claude.ai/artifact/2R9v9J41qPrtnay5DbbUjM#artboard-Account) | Monday | none (passkey offer only) | #1448 |
| Home / game selection | [Home](https://claude.ai/artifact/2R9v9J41qPrtnay5DbbUjM#artboard-Home) | existing | `/all` GamesScreen | #1419, #1405 (Coming soon card) |
| Game sheet | [GameSheet](https://claude.ai/artifact/2R9v9J41qPrtnay5DbbUjM#artboard-GameSheet) | existing | GameDetail | #1419 |
| New Game steps | [NewGame](https://claude.ai/artifact/2R9v9J41qPrtnay5DbbUjM#artboard-NewGame) | existing | `/new` NewGameScreen | #1419, #1424 |
| New Game interview | [NewGameChat](https://claude.ai/artifact/2R9v9J41qPrtnay5DbbUjM#artboard-NewGameChat) | Monday | scope-chat | #1424, #1412, #1413 |
| Play view + touch controls | [PlayView](https://claude.ai/artifact/2R9v9J41qPrtnay5DbbUjM#artboard-PlayView) | existing | `/g/:id` GameScreen, PlatformHud | #1420, #1394 |
| Pause menu (play) | [PauseMenu](https://claude.ai/artifact/2R9v9J41qPrtnay5DbbUjM#artboard-PauseMenu) | existing | PauseMenu, game-menu (#1326) | #1420 |
| Editor | [Editor](https://claude.ai/artifact/2R9v9J41qPrtnay5DbbUjM#artboard-Editor) | existing | `/g/:id?mode=edit` EditWorkspace, features/editor | #1420 (chrome), #1449 |
| Edit menu (global menu) | [EditMenu](https://claude.ai/artifact/2R9v9J41qPrtnay5DbbUjM#artboard-EditMenu) | existing | EditMenu, StudioMenu | #1420 |
| Agent conversation | [AgentChat](https://claude.ai/artifact/2R9v9J41qPrtnay5DbbUjM#artboard-AgentChat) | Monday | build-chat, EditConversation | #1450, #1427 |
| Two-way voice | [VoiceLive](https://claude.ai/artifact/2R9v9J41qPrtnay5DbbUjM#artboard-VoiceLive) | Monday | build-chat/voice | #1413, #1425 |
| Report a bug | [BugReport](https://claude.ai/artifact/2R9v9J41qPrtnay5DbbUjM#artboard-BugReport) | Monday | BugComposer, bug-report | #1334, #1450, #1408 |
| Review question | [Review](https://claude.ai/artifact/2R9v9J41qPrtnay5DbbUjM#artboard-Review) | existing | `/game/:id/review/:cmd`, commands-inbox | #1426, #1415 |
| Activity list | [Activity](https://claude.ai/artifact/2R9v9J41qPrtnay5DbbUjM#artboard-Activity) | Monday | worker-builds BuildTracker | #1451 |
| Ticket conversation | [TicketChat](https://claude.ai/artifact/2R9v9J41qPrtnay5DbbUjM#artboard-TicketChat) | Monday | TicketConversation | #1451, #1417 |
| Build order (phone) | [BuildOrder](https://claude.ai/artifact/2R9v9J41qPrtnay5DbbUjM#artboard-BuildOrder) | Monday | features/aiur/embed | #1452 |
| Settings | [Settings](https://claude.ai/artifact/2R9v9J41qPrtnay5DbbUjM#artboard-Settings) | existing | `/settings`, SharedSettings | #1421 |
| Minerals + Gas | [Resources](https://claude.ai/artifact/2R9v9J41qPrtnay5DbbUjM#artboard-Resources) | Monday | `/settings/energy` EnergyScreen | #1421, #1429, #1414 |
| Limit reached | [LimitReached](https://claude.ai/artifact/2R9v9J41qPrtnay5DbbUjM#artboard-LimitReached) | Monday | energy refusals | #1404, #1429 |
| Publish + access | [Publish](https://claude.ai/artifact/2R9v9J41qPrtnay5DbbUjM#artboard-Publish) | Monday | releases PublishDialog | #1456, #1405, #1447 |
| Admin | [Admin](https://claude.ai/artifact/2R9v9J41qPrtnay5DbbUjM#artboard-Admin) | existing | `/admin/*` (8 sections → 4 tabs) | #1421 |
| Admin invite + access | [AdminInvite](https://claude.ai/artifact/2R9v9J41qPrtnay5DbbUjM#artboard-AdminInvite) | Monday | `/admin/invites` | #1407, #1448, #1404 |
| Versions + rollback | [Versions](https://claude.ai/artifact/2R9v9J41qPrtnay5DbbUjM#artboard-Versions) | future | `/g/:id/versions`, releases | #1453 |
| Cloud saves + snapshots | [Saves](https://claude.ai/artifact/2R9v9J41qPrtnay5DbbUjM#artboard-Saves) | future | editor/hud/saves | #1454 |
| Forks + contributions | [Forks](https://claude.ai/artifact/2R9v9J41qPrtnay5DbbUjM#artboard-Forks) | future | `/g/:id/merge` | #1455 |
| Map builder browse | [MapBrowse](https://claude.ai/artifact/2R9v9J41qPrtnay5DbbUjM#artboard-MapBrowse) | future | editor/library, map | #1459 |
| External games | [ExternalGames](https://claude.ai/artifact/2R9v9J41qPrtnay5DbbUjM#artboard-ExternalGames) | future | none | #1379, #1380, #1386 |
| Model + effort | [ModelSettings](https://claude.ai/artifact/2R9v9J41qPrtnay5DbbUjM#artboard-ModelSettings) | future | none | #1458 |
| Home desktop / landscape | [HomeDesktop](https://claude.ai/artifact/2R9v9J41qPrtnay5DbbUjM#artboard-HomeDesktop), [HomeLandscape](https://claude.ai/artifact/2R9v9J41qPrtnay5DbbUjM#artboard-HomeLandscape) | existing | `/all` | #1419 |
| Editor desktop / landscape | [EditorDesktop](https://claude.ai/artifact/2R9v9J41qPrtnay5DbbUjM#artboard-EditorDesktop), [EditorLandscape](https://claude.ai/artifact/2R9v9J41qPrtnay5DbbUjM#artboard-EditorLandscape) | existing + Monday chat | EditWorkspace | #1420, #1450 |
| Pause landscape | [PauseLandscape](https://claude.ai/artifact/2R9v9J41qPrtnay5DbbUjM#artboard-PauseLandscape) | existing | PauseMenu | #1420 |
| Build order desktop | [BuildOrderDesktop](https://claude.ai/artifact/2R9v9J41qPrtnay5DbbUjM#artboard-BuildOrderDesktop) | Monday | aiur build-order (aiur `docs/build-order/`) | #1452 |

## Layout rules for screens without their own landscape or desktop artboard

- Phone landscape (≤540 px tall): two columns; list or detail left, media or chat right; top bar 60 px; orbs 40 px.
- Tablet and desktop: content max 1280 px; sheets become centred 560 px panes; chats become a 420 px right panel beside the live view; the build order shows lanes × phases with a detail panel.

## Gaps found in the audit

- Mocked `/admin` shows "Not allowed" for a non-admin session; admin screens were designed from the source, not stills.
- Editor panels still use the cream paper look (`--editor-panel`); the design moves them to glass.
- No account screen or role switch exists yet (#1448).
- Creator review-intensity setting (#1393) and energy preference (#1253) have no place yet; both belong in Settings › Voice/Agents when built.

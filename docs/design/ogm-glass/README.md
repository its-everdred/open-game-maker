# OGM Glass

The app-wide design system for the Monday 2026-11-30 redesign (core #1428, design ticket #1411, components #1449).

- **Design canvas:** https://claude.ai/artifact/2R9v9J41qPrtnay5DbbUjM (Claude Design, current Design type). Pages: System, Entry & account, Home & New Game, Make & play, Review & activity, Settings, resources & Admin, Future, Landscape & desktop, Choices for Kevin. Each artboard title carries its status: existing, Monday or future.
- **Tokens:** [tokens.json](tokens.json). **Reference CSS:** [glass.css](glass.css), the stylesheet every artboard uses; port its classes to shared React components in `apps/web/src/components/` (core #1449).
- **Components:** [components.md](components.md). **Screens and tickets:** [screens.md](screens.md).
- **Renders:** every artboard as a still in `assets-local/review/design-ogm-glass/` (host only, not committed).

## Look

Night ground with four slow drifting glows (the shipped `GlowBackdrop`). Glossy glass orbs and pills with a hard top-half highlight, translucent panes whose 1 px edge brightens toward the bottom. Colour is subtle in panes and full only on actions and status, one meaning per colour (green go, yellow create, orange needs you, blue working, purple agents, red danger). Fredoka display over Nunito body, the Oct 31 prototype palette (Gruvbox stays retired). It extends `apps/web/src/tokens.css`; nothing there is renamed.

This is OGM's chrome only. Dusk Helm's pixel UI and any game's own art are separate scopes.

## Navigation (first principles)

1. **One corner.** Top right on every app screen: the resources chip (Minerals and Gas), then the menu orb with an orange count of things that need you. Logo (GM mark) top left goes home. No other fixed chrome.
2. **One menu.** The orb opens one sheet. In a game it starts with the game's orbs (Play or Resume, Edit, Ask for a change, Publish, Report a bug), then Needs you, Work, then places: Activity, Versions, Settings, Admin (admins only), Games, resources. Players of someone else's game see only Resume, Ask/Report a bug, sound, Settings and Games: no internal chats or queues.
3. **Agents show themselves.** While agents work, the activity banner sits under the corner and opens Activity; Activity opens each ticket's chat and the build order. Play view hides the banner and all chrome except the glass menu orb (core #688).
4. **One settings page.** Account row, sound, display and controls, voice, resources, credits, on one scroll. The old Settings tabs (Energy, Credits) and the separate Energy screen fold into it. Admin collapses its eight sections to four tabs: People (members, invites, roles, early access), Resources (allocations, budgets), Work (all agents, links to the aiur dashboard), Intake.
5. **One composer.** aiur's composer, restyled: attach, type, dictate, talk live. The same in the editor chat, bug report, New Game interview, ticket chats and review notes.

## Rules carried from Kevin

- Icon buttons carry no visible label; words go in `aria-label`. On-screen game controls are OGM's host layer and always icons (core #1394).
- No taglines, captions or helper sentences. The only explanatory sentence in the design is the limit-reached sheet, which must say when agents return and that play and hand edits stay free.
- Never stretch images: covers use `object-fit: cover` at a fixed aspect, frames are 9-slice.
- Seamless transitions: the live layer stays rendered under a sheet; only the top layer fades.
- Real screens first: the shipped play/edit menus (#1326) are the base of the pause and edit menus; the prototype's spotlight, glows, option tiles and round New game button stay.

## Open items for implementers

- **Gas icon:** Kevin named aiur's "green rocky" SVG; aiur main (2026-11-26) has only the blue mineral (`src/priv/static/claude-token.svg`, which aiur maps to Codex) and an orange blob (`codex-token.svg`, mapped to Claude). The design uses a stand-in green rock; swap it when the real file is found or made in aiur.
- **Allocations:** the invite and Resources screens show where per-user Minerals and Gas allowances go; the numbers are unanswered (voice decisions §8). Label any estimate as an estimate.
- **Build order lanes:** aiur's prototype uses Documentation/Frontend/Backend/Infrastructure; OGM shows its role lanes (Setting, Art, Gameplay, Sound). Edges clear only from the GitHub outcome, as aiur's manifest requires.

## Colour rule (Kevin 2026-11-27)
"let's choose single blue for all chat elements. and generally let's try to limit UI elements to a single color within a given context."
- Every chat element uses the one blue accent: composer buttons, mic, two-way, send, bubbles and waveform.
- In any other screen or panel, interactive elements share one accent colour.
- State (muted, error) is shown through shape, icon or opacity within that colour, not by adding new hues. Destructive actions are the only exception, and only where needed.
- Kevin 2026-11-27: dark mode is right, as long as the glassy, colourful glow background (as on the game picker / Home) sits behind it. No screen uses a flat black background.

## Button and field material (Kevin 2026-11-27, reference: the Claude app composer; image in assets-local/review/design-ogm-glass/kevin-ref-claude-app-composer.jpg)
"let's emulate this UI design language a little more closely". Replicate it exactly:
1. **Standalone buttons** (round icon buttons, chips) are glass with a THIN border: lighter along the top and bottom edges, darker along the left and right edges. They carry a soft, slight drop shadow.
2. **Form containers** (the chat input card, panels with fields) get the same thin, light-top/bottom and dark-left/right glass border and a soft shadow.
3. **Buttons embedded inside a form element** (the composer's +, model chip, mic, send) do NOT stick out: no border and no shadow, just a flat fill or icon on the container's surface.

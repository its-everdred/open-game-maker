# OGM Glass components

Class names are those in [glass.css](glass.css); the canvas's Components artboard shows each one. Build them once in `apps/web/src/components/` (core #1449) and use them everywhere.

| Component | Class | Spec |
|---|---|---|
| Glow backdrop | `.glows` | Four radial glows, 84 vw (330 px phone), drifting on 41/53/47/61 s. Shipped as `GlowBackdrop`; every app screen except play and the title town. |
| Pane | `.pane`, `.pane.strong`, `.pane.tint` | Fill `glass.fill` (.55) or `fill-strong` (.88 over a live game); blur 22 saturate 1.4; masked 1 px edge `glass.edge`; radius 20 (28 for sheets). Tint mixes 14% of a role colour and ends the edge in it. |
| Sheet | `.sheet` | Pane strong, inset 10 px, radius 28, over `.scrim`. Bottom sheets: radius 28 28 0 0 with a 44×5 grab handle. Enters with spring 600 ms. |
| Orb | `.orb` (+ `.sm` 40, `.lg` 60) | Round glass button, 48 px, gloss top half, inset white highlight. Solid only for `.go` (green), `.new` (yellow), `.rec` (red), `.live` (purple). Icon only; `aria-label` required. Badge `.dot` is always orange. Activity choice B adds a purple progress `.ring`. |
| Pill button | `.btn` (+ `.go .new .warn .info .danger .ghost .glassy`, `.sm` 44, `.lg` 68, `.block`) | 52 px, Fredoka 18. Solid role colour with gloss and a coloured glow for the one main action per view; plain glass for secondary; ghost for cancel/skip. Disabled at 45% opacity, desaturated. |
| Status pill | `.pill` (+ `.work .you .done .fail .wait .soon`) | 24 px, Nunito 800 12. Text never colour alone: always the word. |
| Tag | `.tag` | 28 px outline chip: visibility (Published, Private), version, Estimate. |
| Count | `.cnt` | 20 px chip after a section label. |
| Section label | `.cap` | 11 px caps, muted, .09em. |
| Row | `.row` | 56 px min, radius 18, glass .5. Work rows stack title + % (blue, or orange when waiting on you), 8 px bar, status pill + last step. Review rows are orange-tinted with a 60–72 px thumb and an orange Review pill. Grouped rows (`.grp`) join with 2 px gaps and outer radius 18. |
| Progress bar | `.bar` (`.thin` 6 px) | Track `rgba(15,14,22,.6)`; fill blue (working), orange (waiting), green (done), mineral or gas gradient for resources. |
| Field | `.field`, `.input` | 52 px, radius 16, dark glass, caps label above. |
| Switch | `.switch[role=switch]` | 52×32, gloss knob; on = green. |
| Segmented | `.seg` | Pill track; selected = ink with gloss and dark text. Used for mode (Play/Edit), scope, role, text size, admin tabs. |
| Slider | `.slider` | 8 px track, green fill, 26 px gloss knob, speaker icon. |
| Top bar | `.top` | 76 px phone: GM mark left, `.res` then menu orb right. Inner screens: back orb + h1 instead of the mark. |
| Resources chip | `.res` | 40 px glass pill: mineral icon + %, divider, gas icon + %. Border turns orange at ≤10% and red at 0. Opens Resources. |
| Resource meter | `.meter` | Icon, name, % right, thin gradient bar, reset or budget line. Low: orange ring; out: red ring and greyed icon. |
| Activity banner | `.banner` | 48 px purple-tinted glass pill with a pulse dot: "N agents working · <ticket> <n>%". Under the corner, never in play view. Opens Activity. |
| Chat | `.thread`, `.msg.a/.me/.sys`, `.step` | Agent bubbles glass, mine blue with gloss, system centred muted. Use shape or icon to distinguish states; media uses object-fit cover. |
| Composer | `.composer` | Glass pill: attach, text, dictate and live voice. Chat controls share one blue accent; embedded buttons have no border or shadow. |
| Live voice | VoiceLive artboard | Blurred game, blue breathing orb with waveform, my words muted above the agent's reply, three orbs: mute, end and show chat. |
| Choice card | `.choice`, `.pick` | Full-width media with a lettered orb (A, B…); selected = orange ring and glow. Every option has media. |
| Option tile | `.opt` | New Game tiles: 92 px, icon in the option's hue, near-clear fill; selected fills 14% of the hue, edge ends in the hue, hue glow. |
| Game cover | `.cover` | Fixed aspect (16:9 spotlight and desktop, 4:3 phone grid), bottom shade, Fredoka name, badges top left (Coming soon purple, Private tag). |
| New game | `.orb.new` 64 | Round yellow + at bottom right (Kevin 2026-11-13). |
| Touch controls | PlayView artboard | Translucent glass pads with action icons, never letters (core #1394). |
| Toast | Components artboard | Strong pane pill: icon, one line, one action. |

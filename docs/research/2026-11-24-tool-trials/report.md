# Tool trials: today vs tool (2026-11-24)

| Tool | Verdict | Licence | Integration effort |
|---|---|---|---|
| [Effekseer](https://github.com/effekseer/Effekseer), web runtime [EffekseerForWebGL](https://github.com/effekseer/EffekseerForWebGL) | Maybe, leaning adopt for fire and casts | MIT; sample textures CC0 | 1–2 tickets |
| [Blender Agent MCP](https://github.com/PoBruno/mcp-blender-agent) | Skip | MIT | not applicable |
| [Jiggle Physics](https://github.com/naelstrof/blender-jiggle-physics) | Skip for now | GPL-3.0 (Blender add-on) | small |

## 1. Effekseer

**How the effects were made.** A script (`source/efkgen.py`) writes the three effects as Effekseer project XML. The editor's own command-line export turns them into game files without opening the editor or a display: `Effekseer -cui -in x.efkproj -e x.efk` (Linux build 1.80.8).
- **Campfire:** flickering flame, a core glow, and sparks that rise, drift and fade.
- **Cast spark:** blue-white motes gather on the hand, then a flash, a star flare and a burst of sparks.
- **Legendary aura:** gold motes rise along the weapon, with a slow breathing glow and star glints.

**What "today" is in each comparison.**
- **Fire:** the real in-game World camp clip (Nov 22 build).
- **Cast:** the pack Wizard CastSpell frames the game plays now, with their built-in fire.
- **Legendary:** the game has no aura today, only orange tier text. The clip shows the plain KayKit greataxe beside the static gold rarity mock.

**Media**
- `fire-compare.mp4`, `cast-compare.mp4` and `legendary-compare.mp4` show three panels: today, Effekseer raw, and Effekseer after the pixel finish.
- The effect alone is in `*-effekseer-raw.mp4` and `*-effekseer-finish.mp4`.
- The still is `effekseer-today-vs-tool.png`.

**Pixel finish used.** The effect is averaged onto the game's source-pixel grid (3–5 px blocks), faint pixels are dropped, and the rest is cut to 5–6 colours with gm-sprite-forge `pixel_finish`. It is then scaled back up with hard pixels.

**Findings**
- **Fire:** much more alive than today's sprite flame, and it still reads as chunky pixel fire after the finish. The soft glow has to be left out of the finish because it turns into a hard disc. The game's existing light can do the glow.
- **Cast:** the flash and burst read at pack size and survive the finish. They stack on the pack's own built-in cast fire, so a real build would pick one or tint them to match.
- **Legendary:** motes and glints alone look weaker than the static gold outline mock. The likely best version is the mock's outline and tint plus Effekseer motes.
- **Runtime size:** `effekseer.wasm` is 1.40 MB (372 KB gzipped) and `effekseer.min.js` is 169 KB (37 KB gzipped).
  - Each effect file is 3–4 KB.
  - Their shared textures are about 60 KB.
- **Cost per frame:** the effect simulation takes a median 0.2 ms per frame per effect on the NUC. The slowest 5% of frames took 2–8 ms while the NUC's load average was around 50.
  - The phone cost is not measured: the slowed-CPU run that stands in for a phone hit its timeout and was killed. My unmeasured guess is under 1 ms.
  - Draw cost was not measured either, because the software GPU used here says nothing about a phone.
- **Authoring:** the editor is a GUI, but writing the XML by script plus the command-line export is fully scriptable. This trial did it that way.
- **Integration, about 1–2 tickets:**
  - Load the wasm only in scenes that use effects.
  - Draw through Phaser's WebGL context, or an overlay, with an isometric camera.
  - For the pixel look, draw effects at low resolution and scale up with hard pixels. A palette shader could replace the offline colour reduction.

## 2. Blender Agent MCP vs our headless script

**Task.** Attach the KayKit `axe_1handed` to the Warrior's right hand, using the #1282 rig and Attack clip, at the pack Barbarian's grip.

**Our headless script (today).**
- **Setup:** one 880-byte spec run through `render_motion.py`, copied from the #1282 branch at be824f8a.
- **Run:** 51 s for 15 frames in 2 views (Blender workbench renderer).
- **Result:** a textured axe, blade facing the camera, at 43 px.

**MCP.**
- **Setup:** I built the server and drove it with my own small stdio MCP client, against headless Blender. No Claude or MCP config was used or changed.
- **Effort:** 37 tool calls and 4 render rounds.
- **Traps:**
  - Starting a new file keeps Blender's default cube.
  - The constraint tool sets the parent offset automatically, which left the axe at the character's feet until I reset it by hand.
- **Missing:**
  - an orthographic camera (I used a long lens instead);
  - a transparent background;
  - a bounding-box query, so a grip point can't be computed;
  - textures in the workbench renderer.
- **Run Python:** its own Python tool is off by default.
- **Context cost:** its 216 tool schemas are 143 KB, about 36k tokens.
- **Result:** the axe is in the hand but edge-on, untextured and scaled by hand. See `axe-grip-pack-vs-headless-vs-mcp.png` and `mcp-raw-render-S.png`.

**Verdict:** skip. It costs more tokens, more calls and more traps than the spec we already have.

## 3. Jiggle Physics

**Setup.** There is no rigged wizard or wizard robe yet. As a stand-in, I put a dark-red robe made in code (a flared skirt on 8 chains of 3 bones) on the Meshy-rigged walking base body.
- **Without jiggle:** the robe is fixed to the hips.
- **With jiggle:** Jiggle Physics simulates it, baked into keyframes with the add-on's own bake.
- **Both:** rendered through a pack-style camera (43 px tall, S and SE views). Finish B is approximated as 14 colours, smoothed, with no cloth mask.

**Scripting notes.** It works without the GUI, with two catches. Turning jiggle on for a bone by script does nothing until the add-on's own setup functions run (`mark_jiggle_tree`, `reset_bone`). The live simulation is also lost at render time, so the motion has to be baked first.

**Result** (`robe-jiggle-vs-none-finishB.mp4` and `.png`, 4x with true size underneath):
- The jiggle robe hangs and sways, changing 55–85 outline pixels per frame.
- You can see it at 4x.
- At true size (43 px) it is a few hem pixels and mostly looks like a slightly narrower robe.
- The legs poke through the rigid robe; normal skinning to the thighs would fix that without physics.

**Verdict:** skip for now. Revisit for capes, long hair or banners on bigger sprites.

## Sources
- Effekseer: https://github.com/effekseer/Effekseer, runtime https://github.com/effekseer/EffekseerForWebGL, editor download https://effekseer.github.io/en/.
- Blender Agent MCP: https://github.com/PoBruno/mcp-blender-agent (commit a45012e).
- Jiggle Physics: https://github.com/naelstrof/blender-jiggle-physics (commit 792db09, v4.5.3).

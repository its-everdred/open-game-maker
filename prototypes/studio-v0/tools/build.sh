#!/usr/bin/env bash
# archived; the town builds from apps/web/title-town
# Assemble the publishable folder: page code + Kenney CC0 sprites (art/) + a copy of the ui-v0 dungeon (demo/) with its
# GLB models re-saved as glTF JSON (artifacts don't serve .glb). art/ and demo/ are gitignored; rebuild them with this script.
# Goblin Cellar covers (art/goblin-*.webp) come from ui-v0's tools/e2e.mjs screenshots: OUT=<dir> W=1280 H=720 node e2e.mjs,
# then crop the stage and save 960 px webp (see README).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"; HERE="$ROOT/prototypes/studio-v0"; K="${K:-$ROOT/assets-local/packs}"
PY="${PY:-$ROOT/scripts/audio/.venv/bin/python}"
A="$HERE/art"; mkdir -p "$A/packs"
cp "$K/kenney-pixel-platformer/1.2/extracted/Tilemap/tilemap_packed.png" "$A/pp-tiles.png"
cp "$K/kenney-pixel-platformer/1.2/extracted/Tilemap/tilemap-characters_packed.png" "$A/pp-chars.png"
cp "$K/kenney-tiny-town/1.1/extracted/Tilemap/tilemap_packed.png" "$A/town.png"
cp "$K/kenney-tiny-dungeon/1.0/extracted/Tilemap/tilemap_packed.png" "$A/dungeon.png"
cp "$K/kenney-pixel-shmup/1.1/extracted/Tilemap/tiles_packed.png" "$A/shmup-tiles.png"
cp "$K/kenney-pixel-shmup/1.1/extracted/Tilemap/ships_packed.png" "$A/shmup-ships.png"
cp "$K/kenney-tiny-ski/1.0/extracted/Tilemap/tilemap_packed.png" "$A/ski.png"
cp "$K/kenney-tiny-battle/1.0/extracted/Tilemap/tilemap_packed.png" "$A/battle.png"
SP="$K/kenney-space-shooter-remastered/1.0/extracted"
for f in PNG/playerShip1_blue PNG/Enemies/enemyRed1 PNG/Enemies/enemyBlack3 PNG/Enemies/enemyGreen2 PNG/Meteors/meteorBrown_big1 PNG/Meteors/meteorGrey_med1 PNG/Lasers/laserBlue01 PNG/Lasers/laserRed01; do cp "$SP/$f.png" "$A/space-$(basename $f).png"; done
cp "$SP/Backgrounds/darkPurple.png" "$A/space-bg.png"
RP="$K/kenney-racing-pack/1.0/extracted/PNG"
for f in Cars/car_red_1 Cars/car_blue_1 Cars/car_yellow_1 Cars/car_green_1 Objects/tribune_full Objects/tree_large Objects/tires_red Objects/cone_straight; do cp "$RP/$f.png" "$A/race-$(basename $f).png"; done
PZ="$K/kenney-puzzle-pack-1/1.1/extracted/PNG/Default"
for f in element_red_rectangle_glossy element_blue_rectangle_glossy element_green_rectangle_glossy element_yellow_rectangle_glossy element_purple_rectangle_glossy paddleBlu ballBlue particleStar; do cp "$PZ/$f.png" "$A/puz-$f.png"; done
"$PY" -I -c "import sys; from PIL import Image; im = Image.open(sys.argv[1]); im.thumbnail((400, 400)); im.save(sys.argv[2], quality=90)" "$ROOT/prototypes/ui-v0/site/assets/img/logo.png" "$A/logo.webp"
"$PY" -I "$HERE/tools/gm_logo.py" "$ROOT/prototypes/ui-v0/site/icons/icon-512.png" "$A/gm.webp"   # the small logo: the app icon's GM letters, no tile
"$PY" -I -c "import sys; from PIL import Image; im = Image.open(sys.argv[1]); im.thumbnail((1400, 1400)); im.save(sys.argv[2], quality=88)" "$ROOT/prototypes/ui-v0/site/assets/img/logo.png" "$A/logo-big.webp"
# sound (sound.js), all Kenney CC0 and MP3 because iPhone Safari can't decode Ogg: every Music Loops track (swap tracks in
# sound.js MUSIC), plus the effects behind each game's quiet gameplay sounds in the Games spotlight
mkdir -p "$A/music" "$A/sfx"
for f in "$K/kenney-music-loops/1.1/extracted/"{Loops,Retro}/*.ogg; do
  n="$(basename "$f" .ogg | tr 'A-Z ' 'a-z-')"; ffmpeg -loglevel error -y -i "$f" -codec:a libmp3lame -q:a 5 "$A/music/$n.mp3"; done
# menu track: Sidetrax "Camelot", cut just past its loop end (119.329 s, sound.js MUSIC). MP3 because of iPhone; LAME writes its
# delay/padding header, which decoders use to trim, so the loop points stay sample-accurate (checked in Chromium: decoded
# length and alignment match the WAV exactly)
ffmpeg -loglevel error -y -i "$K/sidetrax-loop-pack-15/v1/extracted/Camelot.wav" -t 119.9 -codec:a libmp3lame -q:a 4 "$A/music/camelot.mp3"
# title track: Sidetrax "Underground", cut the same way just past its loop end (133.898 s)
ffmpeg -loglevel error -y -i "$K/sidetrax-84-retro-music/v1/extracted/Underground.wav" -t 134.5 -codec:a libmp3lame -q:a 4 "$A/music/underground.mp3"
for s in foley-sounds/drip1 foley-sounds/drip2 foley-sounds/drip3 foley-sounds/woosh1 foley-sounds/woosh3 foley-sounds/swordMetal1 \
  foley-sounds/swordMetal2 foley-sounds/swordMetal3 impact-sounds/footstep_concrete_000 impact-sounds/footstep_concrete_001 \
  impact-sounds/impactPunch_medium_002 impact-sounds/footstep_grass_000 impact-sounds/footstep_grass_001 impact-sounds/footstep_snow_000 \
  impact-sounds/footstep_snow_001 impact-sounds/impactWood_medium_000 impact-sounds/impactWood_medium_001 impact-sounds/impactGlass_light_000 \
  impact-sounds/impactGlass_light_001 impact-sounds/impactPlate_light_000 impact-sounds/impactMetal_heavy_001 rpg-audio/footstep00 \
  rpg-audio/footstep01 rpg-audio/creak1 rpg-audio/creak2 rpg-audio/chop rpg-audio/handleCoins retro-sounds-2/jump1 retro-sounds-2/jump3 \
  retro-sounds-2/coin1 retro-sounds-2/coin3 retro-sounds-2/laser1 retro-sounds-2/laser2 retro-sounds-2/explosion2 retro-sounds-2/explosion4 \
  retro-sounds-2/engine1 sci-fi-sounds/laserSmall_000 sci-fi-sounds/laserSmall_002 sci-fi-sounds/explosionCrunch_000 \
  sci-fi-sounds/spaceEngineLow_000 sci-fi-sounds/engineCircular_000 sci-fi-sounds/slime_000 digital-audio/pepSound1 digital-audio/powerUp2 \
  interface-sounds/confirmation_001; do
  f="$(find "$K/kenney-${s%%/*}" -name "${s#*/}.ogg" | head -1)"; [ -n "$f" ] || { echo "missing sound $s" >&2; exit 1; }
  ffmpeg -loglevel error -y -i "$f" -ac 1 -codec:a libmp3lame -q:a 6 "$A/sfx/${s#*/}.mp3"; done
# paint splats for the spotlight's footage edge (Kenney Splat Pack, CC0)
mkdir -p "$A/splats"; cp "$K/kenney-splat-pack/1.0/extracted/PNG/Default (256px)/splat"{00,01,02,03,05,07,10,11,14,16,17,18,19,20,21,24,27,28,29,30,31,33,34,35}.png "$A/splats/"
"$PY" -I "$HERE/tools/previews.py" "$K" "$A/packs" kenney-1-bit-pack kenney-1-bit-platformer-pack kenney-monochrome-rpg-tileset kenney-pico-8-platformer \
  kenney-micro-roguelike kenney-tiny-town kenney-pixel-platformer kenney-tiny-dungeon kenney-toon-characters kenney-space-shooter-remastered kenney-shape-characters \
  kenney-scribble-platformer kenney-sketch-town kenney-scribble-dungeons kenney-isometric-miniature-dungeon kenney-isometric-medieval-town kenney-isometric-nature \
  kenney-mini-dungeon kenney-castle-kit kenney-nature-kit kenney-voxel-pack kenney-voxel-expansion-pack kenney-retro-fantasy-kit kenney-retro-urban-kit \
  synty-polygon-viking-realm synty-polygon-nature-biomes-alpine-mountain synty-polygon-goblin-war-camp
U="$ROOT/prototypes/ui-v0/site"; D="$HERE/demo"; rm -rf "$D"; mkdir -p "$D/assets/img" "$D/assets/models/kenney/Textures"
cp -r "$U/index.html" "$U/style.css" "$U/js" "$D/"; sed -i '/favicon\|apple-touch-icon\|rel="manifest"/d' "$D/index.html"
cp "$U/assets/img/logo.png" "$U/assets/img/paper-bg.png" "$D/assets/img/"; cp -r "$U/assets/audio" "$D/assets/"; rm -f "$D/assets/audio/music-alt.mp3"
cp "$U/assets/models/kenney/Textures/colormap.png" "$D/assets/models/kenney/Textures/"
cp "$U/assets/models/kenney/"*.glb "$D/assets/models/kenney/"; python3 -I "$HERE/tools/glb2json.py" "$D/assets/models/kenney/"*.glb >/dev/null; rm "$D/assets/models/kenney/"*.glb
# the artifact viewer won't run the CDN import map inside the game frame: ship the three.js files the game imports next to it
for f in build/three.module.js examples/jsm/loaders/GLTFLoader.js examples/jsm/utils/BufferGeometryUtils.js examples/jsm/utils/SkeletonUtils.js; do
  mkdir -p "$D/vendor/three/$(dirname $f)"; curl -sfL "https://cdn.jsdelivr.net/npm/three@0.170.0/$f" -o "$D/vendor/three/$f"; done
sed -i 's#https://cdn.jsdelivr.net/npm/three@0.170.0/#./vendor/three/#' "$D/index.html"
# title screen (title-3d.js, directions A and B): the same three.js files for the page's import map, and the Kenney models the
# glass scenes use, as glTF JSON like the dungeon's (art/3d/<kit>/name.json, each kit's colormap at art/3d/<kit>/Textures)
rm -rf "$A/three" && cp -r "$D/vendor/three" "$A/three"
M="$A/3d"; rm -rf "$M"
model() { local pack="$1" kit="$2"; shift 2; local src; src="$(ls -d "$K/$pack"/*/extracted/Models | tail -1)"; mkdir -p "$M/$kit"
  for n in "$@"; do local f; f="$(find "$src" -name "$n.glb" | head -1)"; [ -n "$f" ] || { echo "missing model $pack/$n" >&2; exit 1; }; cp "$f" "$M/$kit/"; done
  if [ -f "$src/GLB format/Textures/colormap.png" ]; then mkdir -p "$M/$kit/Textures"; cp "$src/GLB format/Textures/colormap.png" "$M/$kit/Textures/"; fi
  python3 -I "$HERE/tools/glb2json.py" "$M/$kit/"*.glb >/dev/null; rm "$M/$kit/"*.glb; }
model kenney-city-kit-commercial city building-a building-b building-c building-d building-f building-g building-h building-l building-m \
  building-skyscraper-a building-skyscraper-b building-skyscraper-c building-skyscraper-d building-skyscraper-e
model kenney-city-kit-suburban suburb building-type-a building-type-c building-type-f building-type-k tree-large tree-small
model kenney-city-kit-roads roads road-straight road-crossroad tile-low construction-cone construction-barrier construction-light light-square
model kenney-car-kit cars taxi sedan police delivery van
model kenney-mini-dungeon dungeon floor floor-detail wall wall-opening column chest barrel character-orc character-human banner weapon-sword
model kenney-castle-kit castle tower-square-base tower-square-mid-windows tower-square-top-roof-high wall wall-corner gate flag tree-large
model kenney-space-kit space rocket_baseA rocket_fuelA rocket_sidesA rocket_finsA rocket_topA satelliteDish_large terrain rock_crystalsLargeA astronautA
model kenney-nature-kit nature ground_grass tree_pineTallA tree_pineRoundC tree_default tree_oak rock_largeA mushroom_redGroup flower_yellowA campfire_stones tent_smallOpen

# the title scene: the archived castle town source (build it first: apps/web/title-town/tools/build.sh, then tools/variants.mjs)
TC="$ROOT/apps/web/title-town"; rm -rf "$HERE/town"; mkdir -p "$HERE/town/models"
cp "$TC/index.html" "$TC/city.js" "$TC/rampage.js" "$TC/earthbound.js" "$TC/fx.js" "$TC/crowd-path.js" "$HERE/town/"; cp -r "$TC/vendor" "$TC/fx-variants" "$HERE/town/"
cp -r "$TC/models/castle" "$TC/models/minidungeon" "$TC/models/monsters" "$TC/models/fx" "$TC/models/sounds" "$HERE/town/models/"
# the scenes' sprites (Ness, burnt Ness, the bat swing, the saucers; run tools/ness_sprite.py, tools/ufo_sprite.py, tools/sounds.sh first)
mkdir -p "$HERE/town/models/sprites/variants" "$HERE/town/models/sprites/ufo"
cp "$TC/models/sprites/variants/"ness*.png "$HERE/town/models/sprites/variants/"; cp "$TC/models/sprites/ufo/"ufo_[abc].png "$HERE/town/models/sprites/ufo/"
# Synty particle textures stay off the public site: Kenney Particle Pack stand-ins under the same names
KP="$K/kenney-particle-pack/1.1/extracted/PNG (Transparent)"; [ -d "$KP" ] || KP="$(dirname "$(find "$K/kenney-particle-pack" -name circle_03.png | head -1)")"
cp "$KP/circle_03.png" "$HERE/town/models/fx/PolygonParticles_Ring_01.png"; cp "$KP/scratch_01.png" "$HERE/town/models/fx/PolygonParticles_GroundBreak_01.png"
python3 -I -c 'import json, shutil, sys, pathlib   # only the castle-town variants, and a manifest listing just those
src, dst = map(pathlib.Path, sys.argv[1:3]); dst.mkdir(parents=True, exist_ok=True); m = json.loads((src / "manifest.json").read_text())
m["variants"] = [v for v in m["variants"] if v["set"] in ("house", "tallhouse", "hall", "wide", "shack", "stall")]
for v in m["variants"]: shutil.copy(src / (v["name"] + ".glb"), dst)
(dst / "manifest.json").write_text(json.dumps(m))' "$TC/models/variants" "$HERE/town/models/variants"
# the baked files (apps/web/title-town/tools/bake.mjs, tools/poster.mjs) and one bundled script in place of the module tree
mkdir -p "$HERE/town/models/bake"; cp "$TC/models/bake/"*.bin "$TC/models/bake/"*.gz "$TC/models/bake/"*.webp "$TC/models/bake/"*.jpg "$HERE/town/models/bake/"   # baked terrain, trees, model pack, posters and their stills
node "$TC/tools/bundle.mjs" "$HERE/town" && sed -i 's#<script type="module" src="city.js"></script>#<script type="module" src="city.bundle.js"></script>#' "$HERE/town/index.html"
rm -rf "$HERE/town/vendor/pixelfx" "$HERE/town/fx-variants" "$HERE/town/"{city,rampage,earthbound,fx,crowd-path}.js; find "$HERE/town/vendor/three" -name "*.js" -delete
echo "built $HERE (publish index.html with every other file under it)"

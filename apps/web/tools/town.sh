#!/usr/bin/env bash
# Build the title's castle town and music into public/ (both gitignored). Operator-run: needs assets-local/ and a built
# apps/web/title-town. Ports prototypes/studio-v0/tools/build.sh lines 30–38 (music) and 85–103 (town copy and bundle).
# --public leaves out the Sidetrax tracks (Kevin's personal licence): a public-only build plays MUSIC.title.fallback.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"; WEB="$ROOT/apps/web"; K="${K:-$ROOT/assets-local/packs}"
PY="${PY:-$ROOT/scripts/audio/.venv/bin/python}"
PUBLIC=0; [[ "${1:-}" == "--public" ]] && PUBLIC=1
TC="$WEB/title-town"; OUT="$WEB/public/town"; A="$WEB/public/art"

if [[ ! -d "$TC/models/bake" ]]; then
  echo "apps/web/title-town is not built; run these first:" >&2
  echo "  bash apps/web/title-town/tools/build.sh" >&2
  echo "  node apps/web/title-town/tools/bake.mjs" >&2
  echo "  node apps/web/title-town/tools/poster.mjs" >&2
  exit 2
fi

# music (lib/sound MUSIC): every Kenney Music Loops track, MP3 because iPhone Safari can't decode Ogg
mkdir -p "$A/music"
for f in "$K/kenney-music-loops/1.1/extracted/"{Loops,Retro}/*.ogg; do
  n="$(basename "$f" .ogg | tr 'A-Z ' 'a-z-')"; ffmpeg -loglevel error -y -i "$f" -codec:a libmp3lame -q:a 5 "$A/music/$n.mp3"; done
if [[ "$PUBLIC" == 0 ]]; then
  # Sidetrax title and menu tracks, cut just past their loop ends so the loop points stay sample-accurate
  CAMELOT="$K/sidetrax-loop-pack-15/v1/extracted/Camelot.wav"
  UNDERGROUND="$K/sidetrax-84-retro-music/v1/extracted/Underground.wav"
  if [[ -f "$CAMELOT" && -f "$UNDERGROUND" ]]; then
    ffmpeg -loglevel error -y -i "$CAMELOT" -t 119.9 -codec:a libmp3lame -q:a 4 "$A/music/camelot.mp3"
    ffmpeg -loglevel error -y -i "$UNDERGROUND" -t 134.5 -codec:a libmp3lame -q:a 4 "$A/music/underground.mp3"
  else
    rm -f "$A/music/camelot.mp3" "$A/music/underground.mp3"
    printf '%s\n' 'town: licensed music unavailable; using built-in fallbacks' >&2
  fi
else
  rm -f "$A/music/camelot.mp3" "$A/music/underground.mp3"
fi
"$PY" -I -c "import sys; from PIL import Image; im = Image.open(sys.argv[1]); im.thumbnail((1400, 1400)); im.save(sys.argv[2], quality=88)" \
  "$ROOT/prototypes/ui-v0/site/assets/img/logo.png" "$A/logo.webp"

# the castle town: the subset the studio copied, Kenney stand-ins for the Synty particle textures, one bundled script
rm -rf "$OUT"; mkdir -p "$OUT/models"
cp "$TC/index.html" "$TC/city.js" "$TC/rampage.js" "$TC/crowd-path.js" "$TC/earthbound.js" "$TC/fx.js" "$TC/timeline.js" "$OUT/"; cp -r "$TC/vendor" "$TC/fx-variants" "$OUT/"
cp -r "$TC/models/castle" "$TC/models/minidungeon" "$TC/models/monsters" "$TC/models/fx" "$TC/models/sounds" "$OUT/models/"
mkdir -p "$OUT/models/sprites/variants" "$OUT/models/sprites/ufo"
cp "$TC/models/sprites/variants/"ness*.png "$OUT/models/sprites/variants/"; cp "$TC/models/sprites/ufo/"ufo_[abc].png "$OUT/models/sprites/ufo/"
KP="$K/kenney-particle-pack/1.1/extracted/PNG (Transparent)"; [ -d "$KP" ] || KP="$(dirname "$(find "$K/kenney-particle-pack" -name circle_03.png | head -1)")"
cp "$KP/circle_03.png" "$OUT/models/fx/PolygonParticles_Ring_01.png"; cp "$KP/scratch_01.png" "$OUT/models/fx/PolygonParticles_GroundBreak_01.png"
python3 -I -c 'import json, shutil, sys, pathlib
src, dst = map(pathlib.Path, sys.argv[1:3]); dst.mkdir(parents=True, exist_ok=True); m = json.loads((src / "manifest.json").read_text())
m["variants"] = [v for v in m["variants"] if v["set"] in ("house", "tallhouse", "hall", "wide", "shack", "stall")]
for v in m["variants"]: shutil.copy(src / (v["name"] + ".glb"), dst)
(dst / "manifest.json").write_text(json.dumps(m))' "$TC/models/variants" "$OUT/models/variants"
mkdir -p "$OUT/models/bake"; cp "$TC/models/bake/"*.bin "$TC/models/bake/"*.gz "$TC/models/bake/"*.webp "$TC/models/bake/"*.jpg "$OUT/models/bake/"
node "$TC/tools/bundle.mjs" "$OUT" && sed -i 's#<script type="module" src="city.js"></script>#<script type="module" src="city.bundle.js"></script>#' "$OUT/index.html"
rm -rf "$OUT/vendor/pixelfx" "$OUT/fx-variants" "$OUT/"{city,rampage,crowd-path,earthbound,fx,timeline}.js; find "$OUT/vendor/three" -name "*.js" -delete
echo "built $OUT and $A"

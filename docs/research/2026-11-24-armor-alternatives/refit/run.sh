#!/bin/bash
# run.sh <outfit name> <body: meshy|ranger-m|ranger-f> <out stem> [k=v...]
cd ~/.cache/ogm-armor-test/work
Q="/home/orangekid/games/open-game-maker-2000/assets-local/packs/quaternius-outfits-fantasy/2026-11-24/extracted/Modular Character Outfits - Fantasy[Standard]/Exports/glTF (Godot-Unreal)/Outfits"
B=$2; [ "$B" != meshy ] && B=/home/orangekid/games/open-game-maker-2000/assets-local/experiments/sprite-pipeline/hero-base/$2/gen/model_mesh.glb
export PYTHONPATH=$HOME/.cache/ogm-armor-test/deps:$HOME/.local/share/ogm/forge-venv/lib/python3.13/site-packages
nice -n 10 /usr/bin/blender -b --factory-startup --python-use-system-env --python-exit-code 1 --python refit.py -- "$Q/$1.gltf" "$B" $3.glb idmesh=$3.id.glb "${@:4}" < /dev/null > refit-$3.log 2>&1
echo "exit=$? refit $3"; grep -E "^REFIT|Error" refit-$3.log | cut -c1-3000
/home/orangekid/games/open-game-maker-2000/assets-local/experiments/sprite-pipeline/fal-arm-e/tools/blender.sh --python fitview.py -- $3.glb fv-$3.png > fv-$3.log 2>&1; echo "exit=$? fitview $3"

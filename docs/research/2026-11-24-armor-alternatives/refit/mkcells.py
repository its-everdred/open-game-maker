"""mkcells.py <stem> <glb> <model text> [--axe] [--height 43] -> cells-<stem>.json: a walk and the Big chop on a refit glb."""
import copy, json, sys
H = '/home/orangekid/games/open-game-maker-2000/assets-local/experiments/sprite-pipeline/hero-anim/'
stem, glb, model = sys.argv[1:4]
axe = '--axe' in sys.argv
hp = float(sys.argv[sys.argv.index('--height') + 1]) if '--height' in sys.argv else 43
card = json.load(open(H + 'round4/cells_card.json'))
chop = copy.deepcopy(card['cells'][0])
rig = dict(chop['rigged'], path=glb)
mx = 'mixamorig:'
bones = ['Hips', 'Spine', 'Spine1', 'Spine2', 'Neck', 'Head'] + [f'{s}{b}' for s in ('Left', 'Right') for b in
         ('Shoulder', 'Arm', 'ForeArm', 'Hand', 'UpLeg', 'Leg', 'Foot', 'ToeBase')]
walk = {'name': f'{stem}-walk', 'arm': 'Meshy basic walk (round 3), plain copy onto the refit rig', 'clip': 'walk',
        'model': model, 'cost_usd': 0, 'licence': 'Meshy basic walk via fal (fal/Meshy terms)', 'rigged': rig,
        'motion': {'kind': 'copy', 'path': H + 'round3/gen/basic_animations_walking_glb.glb', 'action': 'walking',
                   'src_hips': mx + 'Hips', 'in_place': True, 'sample': 'even', 'map': {mx + b: mx + b for b in bones}}}
chop.update(name=f'{stem}-bigchop', model=model, rigged=rig)
cells = [walk, chop]
if axe:
    walk['weapon'] = dict(chop['weapon'], pitch=45, roll=-100.8); walk['weapon'].pop('spin', None)
else:
    for c in cells:
        c.pop('weapon', None)
out = {k: v for k, v in card.items() if k != 'cells'}
out['render'] = dict(out['render'], height_px=hp)
out.update(model=model, cells=cells, pixel=dict(out['pixel'], weapon=4))
json.dump(out, open(f'cells-{stem}.json', 'w'), indent=1)
print(f'cells-{stem}.json')

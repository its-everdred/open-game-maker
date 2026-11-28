"""Convert Claude Design .dc.html artboards into standalone HTML for prototypes/ogm-glass.

usage: convert.py <artifact project dir> <blob dir (files named as in BLOBS)> <out dir> <assets-local img dir>
"""
import json, re, shutil, sys, os

src, blobdir, out, localimg = sys.argv[1:5]

# id -> (file name, committed?, source, w, h)
BLOBS = {
    'ca8b9be18fa59294b3e74cfd443bd571': ('gm.webp', True, 'OGM "GM" mark (OGM brand)', 360, 216),
    '785888b192dcef005ebc56851857715f': ('logo.webp', True, 'Open Game Maker 2000 logo (OGM brand)', 1400, 788),
    '421ab7bed071bc03875f991901a85a9d': ('minerals.svg', True, 'Minerals resource icon (OGM UI)', 1254, 1254),
    'e5147135ad62940b7bf434a1751d9e01': ('blobs.jpg', False, 'Blobs VS Blocks cover (game art; provenance unconfirmed, treated as pack art)', 800, 450),
    '015ced2a867ab02cff12e6b0337e901e': ('dusk.jpg', False, 'Dusk Helm cover (SmallScaleInt)', 800, 600),
    'e28dd2481e084fa751a5f39338777dee': ('land-bg.jpg', False, 'Dusk Helm arena still (SmallScaleInt)', 1280, 720),
    'eb1b9a2257d5f7ad87968f7ded9d009e': ('play-bg.jpg', False, 'Dusk Helm play still (SmallScaleInt)', 390, 780),
    '0988d9ae610f53aed709898684a3d179': ('thumb-16.jpg', False, 'Dusk Helm village thumbnail (SmallScaleInt)', 240, 240),
    '068a857faa2d118b7f61d23597b2eb77': ('thumb-41.jpg', False, 'Dusk Helm field thumbnail (SmallScaleInt)', 240, 240),
    '91174c76f5bd618196a77231cbee15cd': ('town-phone.jpg', False, 'Title town render (pack art; provenance unconfirmed)', 780, 1688),
    '4b97203fbddf30a8b7b040de43d1d3a9': ('goblin.jpg', False, 'Goblin Cellar screenshot (KayKit dungeon)', 960, 463),
    'b8c69744b0a0c08ebde48453ca686fa4': ('spr-goblin.png', False, 'Goblin sprite (SmallScaleInt)', 160, 160),
    'ef0e33526863e3bc924eff67037970d1': ('spr-cave-goblin.png', False, 'Cave goblin sprite (SmallScaleInt)', 160, 160),
    '329ce084b832b1da27ac517bccbdabaf': ('spr-skeleton.png', False, 'Skeleton sprite (SmallScaleInt)', 160, 160),
    'd7b115952236e939a38ff0469d60f3aa': ('spr-boss.png', False, 'Boss sprite (SmallScaleInt)', 160, 160),
    '54e39352b082909ec95fef62e2e0fed8': ('spr-hero.png', False, 'Knight hero sprite (SmallScaleInt)', 160, 160),
    '939932aad2e4dee3b8fd4857c2fa5bb2': ('spr-archer.png', False, 'Archer sprite (SmallScaleInt)', 160, 160),
    '6fdb0a8de3a37e057847d2e5250f60ac': ('spr-wizard.png', False, 'Wizard sprite (SmallScaleInt)', 160, 160),
    # Catalogue page (core #1504): Quaternius and KayKit (CC0), chierit (CC-BY), Hivemind and Leartes (NoAI), CC3+ (reference only)
    '45339d8e6fae2fe702b53f6e8ef332df': ('cat-q-idle.png', False, 'Quaternius UAL Idle_Loop clip thumbnail (CC0)', 256, 256),
    '30c47695c6c0e09606663a63e8aa0457': ('cat-q-jog.png', False, 'Quaternius UAL Jog_Fwd_Loop clip thumbnail (CC0)', 256, 256),
    'bded2cce21880b8fca1eec514116ee6e': ('cat-q-sword.png', False, 'Quaternius UAL Sword_Attack clip thumbnail (CC0)', 256, 256),
    'e355474144cee7d6fea042ff5e13c6c8': ('cat-q-punch.png', False, 'Quaternius UAL Punch_Jab clip thumbnail (CC0)', 256, 256),
    '79d73b2694499a976c8c7402525f4563': ('cat-q-roll.png', False, 'Quaternius UAL Roll clip thumbnail (CC0)', 256, 256),
    '107957e1277344fd108c7ffdf5d72b75': ('cat-q-spell.png', False, 'Quaternius UAL Spell_Simple_Shoot clip thumbnail (CC0)', 256, 256),
    '73cef04252080589bd3191c2e0ba30d3': ('cat-q-walk.png', False, 'Quaternius UAL Walk_Loop clip thumbnail (CC0)', 256, 256),
    'e6ce523f294c690b207ce13860da6084': ('cat-q-death.png', False, 'Quaternius UAL Death01 clip thumbnail (CC0)', 256, 256),
    '3deabeb9ee13636dac88d72e40068950': ('cat-q-jump.png', False, 'Quaternius UAL Jump_Loop clip thumbnail (CC0)', 256, 256),
    '18cce8cf3fd691a44bc32317fe30343d': ('cat-q-swidle.png', False, 'Quaternius UAL Sword_Idle clip thumbnail (CC0)', 256, 256),
    '19c238bdc483cc6d33ebf629ea52d1cb': ('cat-m-knight.png', False, 'KayKit Adventurers knight thumbnail, background keyed out (CC0)', 512, 512),
    '414c4f3948406bbe5eab18b9b0c0714e': ('cat-m-mage.png', False, 'KayKit Adventurers mage thumbnail, background keyed out (CC0)', 512, 512),
    '681d5d5ffa1a92cedd9d64526f05c394': ('cat-m-barbarian.png', False, 'KayKit Adventurers barbarian thumbnail, background keyed out (CC0)', 512, 512),
    '590b7e852e9df4eb8c5d96fdc3c05cd6': ('cat-m-rogue.png', False, 'KayKit Adventurers rogue thumbnail, background keyed out (CC0)', 512, 512),
    'e9387d9cf525d7a6756d73a971ab3efa': ('cat-m-chest.png', False, 'KayKit Dungeon gold chest thumbnail, background keyed out (CC0)', 512, 512),
    'a19c62728c27b741a47bd9b33ab190c8': ('cat-map-hall.jpg', False, 'CC3+ Rothenburg town hall crop (ProFantasy, reference only)', 520, 600),
    'd8811104c4b6dc4e111ad5887bd7f984': ('cat-minotaur.png', False, 'chierit Minotaur idle frame (CC-BY-4.0)', 288, 160),
    '2660a83461c102a6160593ebec2e4fa7': ('cat-fx-fire.jpg', False, 'Hivemind fire VFX store preview, torches crop (NoAI)', 300, 300),
    '7a4471c850fe621d6db33ced3900e688': ('cat-m-village.jpg', False, 'Leartes Medieval Russian Village store preview (NoAI)', 480, 270),
}
# Fixes applied on top of the canvas. glass.css gained a global .pick (editor picks, 42x42) on 2026-11-27,
# which squashes the square A/B choice tiles these three chats approved on 2026-11-26; restore height:auto and block display.
PATCHES = {
    b: [('background:#000;aspect-ratio:1}', 'background:#000;aspect-ratio:1;height:auto;display:block}')]
    for b in ('AgentChat.dc.html', 'ChatA.dc.html', 'ChatB.dc.html')
}
LOCAL_REL = '../../assets-local/review/design-ogm-glass/img/'

canvas = json.load(open(os.path.join(src, 'canvas.json')))
os.makedirs(os.path.join(out, 'img'), exist_ok=True)
os.makedirs(localimg, exist_ok=True)
for bid, (name, commit, *_rest) in BLOBS.items():
    shutil.copyfile(os.path.join(blobdir, name), os.path.join(out, 'img', name) if commit else os.path.join(localimg, name))
for css in ('glass.css', 'catalogue.css'):
    shutil.copyfile(os.path.join(src, css), os.path.join(out, css))
shutil.copyfile(os.path.join(src, 'canvas.json'), os.path.join(out, 'canvas.json'))

manifest = []
blob_re = re.compile(r'/_blob/([0-9a-f]{32})')
for board in canvas['boards']:
    html = open(os.path.join(src, board)).read()
    name = board.replace('.dc.html', '')
    for old, new in PATCHES.get(board, []):
        assert html.count(old) == 1, (board, old)
        html = html.replace(old, new)
    helmet = re.search(r'<helmet>\n?(.*?)</helmet>\n?', html, re.S)
    assert helmet, board
    html = html.replace(helmet.group(0), '')
    html = html.replace('<script src="./support.js"></script>\n', '')
    html = re.sub(r'<x-dc>\n?|</x-dc>\n?', '', html)
    html = re.sub(r'<script type="text/x-dc"[^>]*>.*?</script>\n?', '', html, flags=re.S)
    html = html.replace('</head>', helmet.group(1).rstrip('\n') + '\n</head>', 1)
    html = re.sub(r'href="([A-Za-z]+)\.dc\.html"', r'href="\1.html"', html)
    used_pack = set()

    def sub(m):
        f, commit, source, w, h = BLOBS[m.group(1)]
        if commit:
            return 'img/' + f
        used_pack.add(f)
        return LOCAL_REL + f

    html = blob_re.sub(sub, html)
    assert '_blob' not in html and 'x-dc' not in html and 'support.js' not in html, board
    if used_pack:
        html = html.replace('</body>', '<script src="fallback.js"></script>\n</body>', 1)
    for f in sorted(used_pack):
        src_ = next(v for v in BLOBS.values() if v[0] == f)
        manifest.append({'artboard': name + '.html', 'path': 'assets-local/review/design-ogm-glass/img/' + f,
                         'source': src_[2], 'width': src_[3], 'height': src_[4]})
    open(os.path.join(out, name + '.html'), 'w').write(html)

json.dump({'note_local_root': 'paths are relative to the repo root; assets-local/ is gitignored and lives on the host',
           'images': manifest}, open(os.path.join(out, 'assets.json'), 'w'), indent=1)
sizes = {v[0]: [v[3], v[4]] for v in BLOBS.values() if not v[1]}
print(len(canvas['boards']), 'artboards;', len(manifest), 'pack refs')
print(json.dumps(sizes))

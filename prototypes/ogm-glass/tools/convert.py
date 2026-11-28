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
shutil.copyfile(os.path.join(src, 'glass.css'), os.path.join(out, 'glass.css'))
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

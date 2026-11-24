"""The starter effects: python effects.py <outdir> writes their .efkproj files (textures resolve from <outdir>/Texture)."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from efkgen import Generator  # noqa: E402

T = 'Texture/'


def campfire(g, size=1.0, sparks=2.5):
    """Tongues of flame, a flickering core glow, and sparks that rise, drift and fade. `size` scales the fire."""
    s = size
    return [
        g.node('flame', T + 'Fire_Single.png', life=(18, 30), every=1.2 / s, sphere=(0, 0.3 * s),
               vel=((-0.006 * s, 0.006 * s), (0.03 * s, 0.06 * s), (-0.006 * s, 0.006 * s)),
               scale_ease=((0.9 * s, 1.3 * s), (0.15 * s, 0.35 * s)), c0=(255, (190, 230), (80, 130), 170),
               c1=(230, (30, 70), 0, 150), fadein=4, fadeout=12),
        g.node('core', T + 'Particle_Soft.png', life=(5, 9), every=2, box=((-0.1 * s, 0.1 * s), (0.3 * s, 0.6 * s), (-0.1 * s, 0.1 * s)),
               scale=(1.3 * s, 1.8 * s), c0=(255, (150, 190), 50, (40, 80)), c1=(255, 100, 10, 0), fadein=2),
        g.node('sparks', T + 'Particle_Hard.png', life=(45, 90), every=sparks, sphere=(0, 0.3 * s),
               vel=((-0.02, 0.02), (0.06 * s, 0.13 * s), (-0.02, 0.02)), acc=((-0.0012, 0.0012), (-0.0004, 0), (-0.0012, 0.0012)),
               scale=(0.09, 0.17), c0=(255, (220, 255), (120, 170), 255), c1=(255, (60, 110), 0, 255), fadeout=25),
    ]


def cast(g):
    """Blue-white motes converge on the hand, a flash and star flare, then a radial burst of sparks. One second."""
    return [
        g.node('gather', T + 'Particle_Hard.png', life=(16, 20), every=0.8, maxgen=22, ease_from=1.3, scale=(0.12, 0.22),
               c0=(150, 210, 255, 0), c1=(230, 245, 255, 255), fadein=6),
        g.node('flash', T + 'Particle_Soft.png', life=(14, 14), every=1, maxgen=1, offset=20,
               scale_ease=((0.6, 0.6), (3.6, 3.6)), c0=(220, 240, 255, 255), c1=(90, 140, 255, 0)),
        g.node('flare', T + 'Star.png', life=(16, 16), every=1, maxgen=1, offset=20, scale_ease=((3.2, 3.2), (0.4, 0.4)),
               c0=(235, 245, 255, 255), c1=(120, 170, 255, 0)),
        g.node('burst', T + 'Particle_Hard.png', life=(18, 30), every=0.05, maxgen=26, offset=20, sphere=(0, 0.1),
               vel=((-0.14, 0.14), (-0.08, 0.16), (-0.14, 0.14)), grav=0.004, scale=(0.08, 0.16),
               c0=(200, 230, 255, 255), c1=(80, 120, 255, 255), fadeout=10),
    ]


def legendary(g):
    """Gold motes rising along a 2-unit blade, a slow breathing glow, and star glints. Layer on the outline and tint."""
    return [
        g.node('glow', T + 'Particle_Soft.png', life=(60, 60), every=30, box=((0, 0), (1.55, 1.55), (0, 0)), scale=(2.6, 2.6),
               c0=(255, 150, 40, 0), c1=(255, 120, 20, 0), fadein=30, fadeout=30),
        g.node('glowpeak', T + 'Particle_Soft.png', life=(60, 60), every=30, box=((0, 0), (1.55, 1.55), (0, 0)), scale=(1.8, 1.8),
               c0=(255, 170, 60, 120), c1=(255, 130, 30, 120), fadein=30, fadeout=30),
        g.node('motes', T + 'Particle_Hard.png', life=(35, 60), every=1.5, box=((-0.18, 0.18), (0, 2.0), (-0.18, 0.18)),
               vel=((-0.004, 0.004), (0.012, 0.03), (-0.004, 0.004)), scale=(0.07, 0.13),
               c0=(255, (220, 250), (150, 200), 255), c1=(255, 150, 50, 255), fadein=8, fadeout=18),
        g.node('glint', T + 'Star.png', life=(14, 14), every=22, box=((-0.15, 0.15), (0.2, 1.9), (-0.15, 0.15)),
               scale_ease=((0.1, 0.1), (0.9, 1.1)), c0=(255, 250, 220, 255), c1=(255, 190, 90, 0)),
    ]


def write_all(outdir):
    g = Generator()
    out = Path(outdir)
    g.project(out / 'campfire.efkproj', campfire(g), end=240)
    # A torch: a smaller, quicker flame with fewer sparks.
    g.project(out / 'torch.efkproj', campfire(g, size=0.55, sparks=6), end=240)
    g.project(out / 'cast.efkproj', cast(g), end=60, loop=False)
    g.project(out / 'legendary.efkproj', legendary(g), end=240)
    return sorted(out.glob('*.efkproj'))


if __name__ == '__main__':
    for path in write_all(sys.argv[1]):
        print(path)

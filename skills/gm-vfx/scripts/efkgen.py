"""Write Effekseer .efkproj effects by script: each node clones the template's full sprite node and sets its fields.

Effekseer omits default values from project XML, so a node is only scriptable when every field below is present; the
bundled template/sprite.efkproj has them all. Export the projects with scripts/effekseer.sh export.
"""
import copy
import xml.etree.ElementTree as ET
from pathlib import Path

TEMPLATE = Path(__file__).resolve().parent.parent / 'template' / 'sprite.efkproj'
# Blend modes (RendererCommonValues/AlphaBlend).
OPACITY, BLEND, ADD, SUB, MUL = 0, 1, 2, 3, 4


class Generator:
    def __init__(self, template=TEMPLATE):
        self.root = ET.parse(template).getroot()
        self.sprite = self.root.find('Root/Children/Node')

    def node(self, name, tex, *, life, every, maxgen=None, offset=0, blend=ADD, sphere=None, box=None,
             vel=((0, 0), (0, 0), (0, 0)), acc=((0, 0), (0, 0), (0, 0)), grav=0.0, scale=None, scale_ease=None,
             c0=(255, 255, 255, 255), c1=None, fadein=0, fadeout=0, ease_from=None):
        """One sprite emitter. Ranges are (min, max); times are frames at 60 fps; units are effect units.

        life: particle lifetime; every: frames between spawns; maxgen: total spawns (None = endless); offset: first
        spawn frame. Spawn in a sphere (radius range) or a box (per-axis ranges). Motion is velocity plus acceleration
        per frame (vel/acc per axis) and gravity, or ease_from: converge from a random point within that radius onto the
        centre. Size is a fixed random scale range or scale_ease ((start lo, hi), (end lo, hi)). Colour eases from c0
        to c1 (RGBA 0-255, each channel a value or a (lo, hi) range).
        """
        n = copy.deepcopy(self.sprite)
        if n.find('Children') is not None:
            n.find('Children').clear()
        _put(n, 'Name', name)
        _put(n, 'IsRendered', 'True')
        cv = 'CommonValues/'
        _put(n, cv + 'MaxGeneration/Infinite', 'True' if maxgen is None else 'False')
        _put(n, cv + 'MaxGeneration/Value', maxgen or 1)
        _rnd(n, cv + 'Life', *life)
        _put(n, cv + 'GenerationTime', every)
        _put(n, cv + 'GenerationTimeOffset', offset)
        if ease_from is not None:
            _put(n, 'LocationValues/Type', 2)
            for ax in 'XYZ':
                _rnd(n, f'LocationValues/Easing/Start/{ax}', -ease_from, ease_from)
                _rnd(n, f'LocationValues/Easing/End/{ax}', 0)
            _put(n, 'LocationValues/Easing/StartSpeed', 10)
            _put(n, 'LocationValues/Easing/EndSpeed', 10)
        else:
            _put(n, 'LocationValues/Type', 1)
            for i, ax in enumerate('XYZ'):
                _rnd(n, f'LocationValues/PVA/Location/{ax}', 0)
                _rnd(n, f'LocationValues/PVA/Velocity/{ax}', *vel[i])
                _rnd(n, f'LocationValues/PVA/Acceleration/{ax}', *acc[i])
        _put(n, 'LocationAbsValues/Gravity/Gravity/Y', grav)
        g = 'GenerationLocationValues/'
        if sphere:
            _put(n, g + 'Type', 1)
            _rnd(n, g + 'Sphere/Radius', *sphere)
            _rnd(n, g + 'Sphere/RotationX', -180, 180)
            _rnd(n, g + 'Sphere/RotationY', -180, 180)
        else:
            _put(n, g + 'Type', 0)
            b = box or ((0, 0), (0, 0), (0, 0))
            for i, ax in enumerate('XYZ'):
                _rnd(n, f'{g}Point/Location/{ax}', *b[i])
        s = 'ScalingValues/'
        if scale_ease:
            _put(n, s + 'Type', 2)
            (a0, a1), (b0, b1) = scale_ease
            for ax in 'XYZ':
                _rnd(n, f'{s}Easing/Start/{ax}', a0, a1)
                _rnd(n, f'{s}Easing/End/{ax}', b0, b1)
            _put(n, s + 'Easing/StartSpeed', 0)
            _put(n, s + 'Easing/EndSpeed', 0)
        else:
            _put(n, s + 'Type', 1)
            lo, hi = scale or (1, 1)
            for ax in 'XYZ':
                _rnd(n, f'{s}PVA/Scale/{ax}', lo, hi)
                _rnd(n, f'{s}PVA/Velocity/{ax}', 0)
                _rnd(n, f'{s}PVA/Acceleration/{ax}', 0)
        r = 'RendererCommonValues/'
        _put(n, r + 'ColorTexture', tex)
        _put(n, r + 'AlphaBlend', blend)
        _put(n, r + 'FadeInType', 1 if fadein else 0)
        _put(n, r + 'FadeIn/Frame', fadein or 1)
        _put(n, r + 'FadeOutType', 1 if fadeout else 0)
        _put(n, r + 'FadeOut/Frame', fadeout or 1)
        d = 'DrawingValues/Sprite/'
        _put(n, 'DrawingValues/Type', 2)
        c1 = c1 or c0
        _put(n, d + 'ColorAll', 2)
        for k, v0, v1 in zip('RGBA', c0, c1):
            a = v0 if isinstance(v0, tuple) else (v0, v0)
            b = v1 if isinstance(v1, tuple) else (v1, v1)
            _rnd(n, f'{d}ColorAll_Easing/Start/{k}', *a)
            _rnd(n, f'{d}ColorAll_Easing/End/{k}', *b)
        _put(n, d + 'ColorAll_Easing/StartSpeed', 0)
        _put(n, d + 'ColorAll_Easing/EndSpeed', 0)
        return n

    def project(self, path, nodes, end, loop=True):
        """Writes an effect of these emitters, `end` frames long, to `path` (.efkproj)."""
        p = copy.deepcopy(self.root)
        children = p.find('Root/Children')
        children.clear()
        for n in nodes:
            children.append(n)
        _put(p, 'EndFrame', end)
        _put(p, 'IsLoop', 'True' if loop else 'False')
        ET.ElementTree(p).write(path, encoding='utf-8', xml_declaration=True)


def _put(e, path, v):
    found = e.find(path)
    if found is None:
        raise KeyError(f'template node has no {path}')
    found.text = str(v)


def _rnd(e, path, lo, hi=None):
    hi = lo if hi is None else hi
    t = e.find(path)
    if t is None:
        raise KeyError(f'template node has no {path}')
    t.find('Min').text, t.find('Max').text, t.find('Center').text = str(lo), str(hi), str((lo + hi) / 2)

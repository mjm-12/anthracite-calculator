"""Fuzz Face (classic output) + optional base-collector R_BC1/R_BC2 and C_BC1/C_BC2.

Schematic for the web calculator (schematic.svg at repo root).
Text is emitted as SVG paths (svg.fonttype='path'), so no font install is needed.
"""
import os
import shutil
import warnings

import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib import font_manager
import schemdraw
import schemdraw.elements as elm
from schemdraw.segments import Segment, SegmentCircle

warnings.filterwarnings('ignore', message='.*non-interactive.*')

HERE = os.path.dirname(os.path.abspath(__file__))

# -------------------------
# Fonts (Helvetica Neue, resolved relative to this script)
font_path_reg = os.path.join(HERE, 'Fonts', 'Helvetica Neue LT Pro 55 Roman.otf')
font_path_it = os.path.join(HERE, 'Fonts', 'Helvetica Neue LT Pro 56 Italic.otf')
font_size = 16

try:
    font_manager.fontManager.addfont(font_path_reg)
    font_manager.fontManager.addfont(font_path_it)
    font_name = font_manager.FontProperties(fname=font_path_reg).get_name()
except Exception as e:  # fallback
    print(f'font load failed: {e}')
    font_name = 'sans-serif'

plt.rcParams['mathtext.fontset'] = 'custom'
plt.rcParams['mathtext.default'] = 'regular'
plt.rcParams['font.size'] = font_size
plt.rcParams['mathtext.rm'] = font_name
plt.rcParams['mathtext.it'] = f'{font_name}:italic'
plt.rcParams['mathtext.bf'] = f'{font_name}:bold'
plt.rcParams['font.family'] = font_name
plt.rcParams['svg.fonttype'] = 'path'   # text -> outlines in the SVG

schemdraw.use('matplotlib')


# =========================
# Custom elements (same as FuzzFace_classic_div.py)
class Vcc(elm.Vdd):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.scale(2)
        self.segments.append(SegmentCircle((0, 0), 0.1))


resw = 1.0 / 6
resh = .18


class Res(elm.Element2Term):
    def __init__(self, **kwargs):
        super().__init__(**kwargs)
        self.segments.append(Segment(
            [(0, 0), (0.5*resw, resh), (1.5*resw, -resh),
             (2.5*resw, resh), (3.5*resw, -resh),
             (4.5*resw, resh), (5.5*resw, -resh), (6*resw, 0)]))


class Pot(Res):
    _element_defaults = {
        'arrowwidth': .15,
        'arrowlength': .25,
        'tap_length': 0.72,
    }

    def __init__(self, **kwargs):
        super().__init__(**kwargs)
        potheight = self.params['tap_length']
        self.anchors['tap'] = (resw*3, potheight)
        self.params['lblloc'] = 'bot'
        self.segments.append(Segment(
            [(resw*3, potheight), (resw*3, resw*1.5)],
            arrow='->', arrowwidth=self.params['arrowwidth'],
            arrowlength=self.params['arrowlength']))


# =========================
RL = 1.3   # vertical resistor length
# Larger-plate capacitor (stock plates x1.25) whose length can be set with .tox()
capgap, caph = 0.225, 0.3125
NAN = (float('nan'), float('nan'))


class Cap(elm.Element2Term):
    def __init__(self, **kwargs):
        super().__init__(**kwargs)
        self.segments.append(Segment([(0, 0), NAN, (0, caph), (0, -caph), NAN,
                                      (capgap, caph), (capgap, -caph), NAN, (capgap, 0)]))


# Layers: the UI stacks these SVGs. Every file draws the whole circuit, but
# elements outside the file's layer get a fully transparent colour, so all files share one
# bounding box (identical viewBox) and line up exactly when stacked.
LAYERS = ['base', 'rbc1', 'rbc2', 'cbc1', 'cbc2']


def draw(layer='full', pnp=False):
    """pnp=True: PNP transistors (emitter still at the bottom), -V_CC supply,
    C_in and C_E2 polarity flipped. Same geometry as the NPN drawing."""
    def col(name):
        return 'black' if layer in ('full', name) else '#00000000'   # fully transparent
    cb, r1, r2, k1, k2 = (col(n) for n in LAYERS)
    vcc_lbl = '$-V_{CC}$' if pnp else '$V_{CC}$'

    def bjt():
        return elm.BjtPnp(circle=True).flip() if pnp else elm.BjtNpn(circle=True)

    def cin():   # NPN: + toward V_B1 ; PNP: + toward the source side
        c = elm.Capacitor2(polar=True)
        return c if pnp else c.reverse()

    def ce2():   # NPN: + at V_E2 ; PNP: + toward RV1
        c = elm.Capacitor2(polar=True)
        return c.reverse() if pnp else c

    with schemdraw.Drawing(show=False) as d:
        d.config(fontsize=font_size, font=font_name, lw=1, color=cb)

        # --- source v_s + R_in / Q1 base ------------------------------------
        Vs = elm.SourceSin().down(1.8).label('$v_s$')
        elm.GroundSignal(lead=False)
        elm.Line().right(0.3).at(Vs.start)
        Res().right(1.3).label('$R_{in}$', loc='top')
        cin().right(1.5).label('$C_{in}$', loc='top').scale(1.25)
        elm.Line().right(0.35)
        nK1 = elm.Dot().color(k1)                           # C_BC1 leaves upward
        elm.Line().right(0.6)
        nR1 = elm.Dot().color(r1).label('$V_{B1}$', loc='bottom', color=cb)   # R_BC1 leaves upward
        elm.Line().right(0.8)
        nRF = elm.Dot()                                     # RF arrives from below
        elm.Line().right(0.4)
        Q1 = bjt().anchor('base').theta(0).label('$Q_1$', loc='right')
        elm.Line().down(.2).at(Q1.emitter)
        G1 = elm.GroundSignal(lead=False)

        # --- Q1 collector: V_C1 node, R1 ------------------------------------
        elm.Line().up(0.45).at(Q1.collector)
        nC1 = elm.Dot().label('$V_{C1}$', loc='right', ofst=(0.05, -0.25))   # Q2 base wire leaves right
        elm.Line().up(0.75)
        nR1t = elm.Dot().color(r1)                          # R_BC1 lands from left
        elm.Line().up(1.1)
        nK1t = elm.Dot().color(k1)                          # C_BC1 lands from left
        elm.Line().up(0.25)
        Res().up(RL).label('$R_{1}$', loc='bottom')
        elm.Line().up(0.25)
        Vcc(lead=False).label(vcc_lbl, loc='top')

        # R_BC1 (inner) and C_BC1 (outer): V_B1 -> up -> right to V_C1
        elm.Line().up().at(nR1.center).toy(nR1t.center).color(r1)
        RBC1 = Res().right().tox(nR1t.center).label('$R_{BC1}$', loc='top').color(r1)
        elm.Line().up().at(nK1.center).toy(nK1t.center).color(k1)
        Cap().right().tox(nK1t.center).label('$C_{BC1}$', loc='top').color(k1)

        # --- Q2 -------------------------------------------------------------
        elm.Line().right(1.0).at(nC1.center)
        nK2 = elm.Dot().color(k2)                           # C_BC2 leaves upward
        elm.Line().right(1.0)
        nR2 = elm.Dot().color(r2)                           # R_BC2 leaves upward
        elm.Line().right(0.8)
        Q2 = bjt().anchor('base').theta(0).label('$Q_2$', loc='right')

        elm.Line().up(0.75).at(Q2.collector)
        nR2t = elm.Dot().color(r2).label('$V_{C2}$', loc='right', ofst=(0.05, -0.3), color=cb)  # R_BC2 lands
        elm.Line().up(0.6)
        nOut = elm.Dot()                                    # C_out leaves right
        elm.Line().up(0.6)
        nK2t = elm.Dot().color(k2)                          # C_BC2 lands from left
        elm.Line().up(0.2)
        Res().up(RL).label('$R_{2}$', loc='top')
        elm.Line().up(0.25)
        Vcc(lead=False).label(vcc_lbl, loc='top')

        # R_BC2 (inner) and C_BC2 (outer): V_C1 -> up -> right to V_C2
        elm.Line().up().at(nR2.center).toy(nR2t.center).color(r2)
        RBC2 = Res().right().tox(nR2t.center).label('$R_{BC2}$', loc='top').color(r2)
        elm.Line().up().at(nK2.center).toy(nK2t.center).color(k2)
        Cap().right().tox(nK2t.center).label('$C_{BC2}$', loc='top').color(k2)

        # --- output: Cout -> RV2 ---------------------------------------------
        elm.Capacitor().at(nOut.center).right(1.8).label('$C_{out}$', loc='top').scale(1.25)
        RV2 = Pot().down(1.6).label('$RV_{2}$', loc='bottom', ofst=(-.5, -.45))
        elm.GroundSignal(lead=False)
        elm.Line().at(RV2.tap).right(0.8)
        elm.Dot(open=True).fill('white' if cb == 'black' else '#00000000').label('output', loc='right')

        # --- Q2 emitter: V_E2, R3, CE2 + RV1 ---------------------------------
        elm.Line().down().at(Q2.emitter).toy(G1.end[1] - 0.45)
        nE2 = elm.Dot().label('$V_{E2}$', loc='top', ofst=(-0.5, 0))
        Res().down(RL).label('$R_{3}$', loc='top')
        elm.GroundSignal(lead=False)

        ce2().at(nE2.center).right(1.6).label('$C_{E2}$', loc='top').scale(1.25)
        elm.Dot()
        RV1 = Pot().down(RL).label('$RV_{1}$', loc='top')
        elm.GroundSignal(lead=False)
        elm.Line().right().at(RV1.start).tox(RV1.tap)
        elm.Line().down().toy(RV1.tap)

        # --- RF: V_E2 -> V_B1 -------------------------------------------------
        Res().at(nE2.center).left(2.4).label('$R_{F}$', loc='top')
        LF = elm.Line().left().tox(nRF.center)
        # I_F reference direction: V_E2 -> V_B1 (engine: I_F = (V_E2 - V_B1)/R_F)
        # Invisible placeholder for the I_F arrow: not drawn (the UI shows it on hover from
        # schematic_currents.json), but kept so its position and the bounding box stay fixed.
        IFL = elm.CurrentLabel(top=True, length=0.9, ofst=0.22).at(LF).label('$I_F$', ofst=-0.08).color('#00000000')
        elm.Line().up().toy(nRF.center)

    # key elements, used to export current-arrow geometry (schematic_currents.json)
    d.refs = dict(Q1=Q1, Q2=Q2, nC1=nC1, nRF=nRF, nR2=nR2, nR2t=nR2t, nE2=nE2,
                  LF=LF, IFL=IFL, RBC1=RBC1, RBC2=RBC2)
    return d


plt.rcParams['svg.hashsalt'] = 'fuzzface-bc'   # stable ids between runs

image_dir = os.path.join(HERE, 'Images')
repo_root = os.path.dirname(HERE)
os.makedirs(image_dir, exist_ok=True)

import re
import tempfile

_DATE = re.compile(rb'<dc:date>.*?</dc:date>', re.S)


def save_if_changed(d, path, **kw):
    """Save, but leave an existing file untouched when only the SVG date differs."""
    ext = os.path.splitext(path)[1]
    fd, tmp = tempfile.mkstemp(suffix=ext)
    os.close(fd)
    d.save(tmp, **kw)
    new = open(tmp, 'rb').read()
    if os.path.exists(path) and _DATE.sub(b'', open(path, 'rb').read()) == _DATE.sub(b'', new):
        os.remove(tmp)
        return False
    shutil.move(tmp, path)
    return True


for pnp in (False, True):
    tag = '_pnp' if pnp else ''
    # full drawing (reference / documentation)
    d = draw('full', pnp)
    save_if_changed(d, os.path.join(image_dir, f'FuzzFace_bc{tag}.svg'), transparent=True)
    save_if_changed(d, os.path.join(image_dir, f'FuzzFace_bc{tag}.png'), dpi=300, transparent=False)

    # layers: schematic[_pnp].svg (base) + schematic[_pnp]_<layer>.svg
    for layer in LAYERS:
        suffix = tag if layer == 'base' else f'{tag}_{layer}'
        d = draw(layer, pnp)
        svg_path = os.path.join(image_dir, f'FuzzFace_bc{tag}_layer_{layer}.svg')
        changed = save_if_changed(d, svg_path, transparent=True)
        save_if_changed(d, os.path.join(image_dir, f'FuzzFace_bc{tag}_layer_{layer}.png'),
                        dpi=300, transparent=True)
        root_svg = os.path.join(repo_root, f'schematic{suffix}.svg')
        if changed or not os.path.exists(root_svg):
            shutil.copyfile(svg_path, root_svg)
        print('updated' if changed else 'unchanged', svg_path)


# =========================
# Current-arrow geometry for the UI hover highlight (schematic_currents.json)
# Coordinates are in the schematic SVG's own user units (its viewBox).
import json
import numpy as np

ARROW_L = 0.65   # arrow length [drawing units]
SIDE = 0.3       # offset of the arrow from its wire [drawing units]


def svg_mapper(d):
    """drawing units -> SVG user units (pt), same crop as d.save(bbox_inches='tight', pad 0)."""
    fig, ax = d.fig.fig, d.fig.ax
    r = fig.canvas.get_renderer()
    tb = fig.get_tightbbox(r, bbox_extra_artists=ax.get_default_bbox_extra_artists())  # inches

    def f(x, y):
        px, py = ax.transData.transform((x, y)) / fig.dpi   # inches from fig origin
        return (round(72 * (px - tb.x0), 2), round(72 * (tb.y1 - py), 2))
    return f, (round(72 * tb.width, 3), round(72 * tb.height, 3))


def current_arrows(d, pnp):
    R = d.refs
    P = lambda a: np.array([float(a[0]), float(a[1])])
    out = {}

    def add(key, text, c, direction, side, off=SIDE):
        c, u, s = P(c), np.array(direction, float), np.array(side, float)
        u /= np.linalg.norm(u)
        tail = c + s * off - u * ARROW_L / 2
        head = c + s * off + u * ARROW_L / 2
        lab = c + s * (off + 0.32)
        out[key] = dict(tail=tail, head=head, label=lab, text=text)

    sgn = -1 if pnp else 1           # PNP: Ic, Ib, Ie reversed
    q1, q2 = R['Q1'], R['Q2']
    # Q1 collector stub (collector -> V_C1), arrow on the left
    add('Ic1', 'I_C1', (q1.collector[0], q1.collector[1] + 0.42), (0, -sgn), (-1, 0), off=0.38)
    # wire from the R_F dot into Q1 base, arrow above
    add('Ib1', 'I_B1', ((R['nRF'].center[0] + q1.base[0]) / 2, q1.base[1]), (sgn, 0), (0, 1))
    # Q1 emitter lead to ground, arrow on the right
    add('Ie1', 'I_E1', (q1.emitter[0], q1.emitter[1] - 0.1), (0, -sgn), (1, 0), off=0.45)
    # Q2 collector wire below V_C2, arrow on the left
    add('Ic2', 'I_C2', (q2.collector[0], q2.collector[1] + 0.3), (0, -sgn), (-1, 0))
    # V_C1 -> Q2 base wire near Q2, arrow above
    add('Ib2', 'I_B2', ((R['nR2'].center[0] + q2.base[0]) / 2, q2.base[1]), (sgn, 0), (0, 1))
    # Q2 emitter lead above V_E2, arrow on the left
    add('Ie2', 'I_E2', (q2.emitter[0], (q2.emitter[1] + R['nE2'].center[1]) / 2), (0, -sgn), (-1, 0))
    # R_BC1 / R_BC2: C1 -> B1 and C2 -> C1 (both leftward), arrow below the resistor
    for key, text, el in (('Ibc1', 'I_BC1', R['RBC1']), ('Ibc2', 'I_BC2', R['RBC2'])):
        add(key, text, (P(el.start) + P(el.end)) / 2, (-1, 0), (0, -1))
    # I_F: reuse the drawn CurrentLabel arrow (E2 -> B1, leftward)
    pts = []
    for seg in R['IFL'].segments:
        if hasattr(seg, 'path'):
            pts += [R['IFL'].transform.transform(p) for p in seg.path]
    pts = np.array([[float(p[0]), float(p[1])] for p in pts])
    y = pts[:, 1].mean()
    xr, xl = pts[:, 0].max(), pts[:, 0].min()
    out['If'] = dict(tail=np.array([xr, y]), head=np.array([xl, y]),
                     label=np.array([(xl + xr) / 2, y - 0.32]), text='I_F')
    return out


currents = {}
for pnp in (False, True):
    d = draw('base', pnp)
    d.save(os.path.join(tempfile.gettempdir(), 'ffbc_map.svg'), transparent=True)  # realise figure
    f, size = svg_mapper(d)
    arr = {}
    for k, a in current_arrows(d, pnp).items():
        (x1, y1), (x2, y2), (lx, ly) = f(*a['tail']), f(*a['head']), f(*a['label'])
        arr[k] = dict(x1=x1, y1=y1, x2=x2, y2=y2, lx=lx, ly=ly, text=a['text'])
    currents['pnp' if pnp else 'npn'] = arr
    print('mapper size', size)
currents['viewBox'] = '0 0 %g %g' % size
js = json.dumps(currents, separators=(',', ':'))
jpath = os.path.join(repo_root, 'schematic_currents.json')
if not os.path.exists(jpath) or open(jpath, encoding='utf-8').read() != js:
    open(jpath, 'w', encoding='utf-8').write(js)
print('currents ->', jpath, len(js), 'bytes')

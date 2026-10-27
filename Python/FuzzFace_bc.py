"""Fuzz Face (classic output) + base-collector resistors R_BC1 / R_BC2.

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
GREY = '#c4c4c4'   # colour of an R_BC branch that is switched OPEN


def draw(open1=False, open2=False):
    """Return the drawing. open1/open2 grey out the R_BC1/R_BC2 branch
    (resistor, label, riser wire, and the dots that stop being junctions).
    Only colours change, so every variant has the same bounding box."""
    c1 = GREY if open1 else 'black'
    c2 = GREY if open2 else 'black'
    z1 = 5 if open1 else None   # grey dots on top of the black wire they sit on
    z2 = 5 if open2 else None
    with schemdraw.Drawing(show=False) as d:
        d.config(fontsize=font_size, font=font_name, lw=1)

        # --- source v_s + R_in / Q1 base ------------------------------------
        Vs = elm.SourceSin().down(1.8).label('$v_s$')
        elm.GroundSignal(lead=False)
        elm.Line().right(0.3).at(Vs.start)
        Rin = Res().right(1.3).label('$R_{in}$', loc='top')
        Cin = elm.Capacitor2(polar=True).reverse().right(1.5).label('$C_{in}$', loc='top').scale(1.25)
        elm.Line().right(0.35)
        nB1 = elm.Dot().label('$V_{B1}$', loc='bottom', color='black').color(c1).zorder(z1)     # R_BC1 leaves upward
        elm.Line().right(0.8)
        nB1b = elm.Dot()                                    # RF arrives from below
        elm.Line().right(0.4)
        Q1 = elm.BjtNpn(circle=True).anchor('base').theta(0).label('$Q_1$', loc='right')
        elm.Line().down(.2).at(Q1.emitter)
        G1 = elm.GroundSignal(lead=False)

        # --- Q1 collector: V_C1 node, R1 ------------------------------------
        elm.Line().up(0.45).at(Q1.collector)
        nC1 = elm.Dot().label('$V_{C1}$', loc='right', ofst=(0.05, -0.25))   # Q2 base wire leaves right
        elm.Line().up(0.75)
        nC1t = elm.Dot().color(c1).zorder(z1)                                                     # R_BC1 lands from left
        elm.Line().up(0.25)
        R1 = Res().up(RL).label('$R_{1}$', loc='bottom')
        elm.Line().up(0.25)
        Vcc(lead=False).label('$V_{CC}$', loc='top')

        # R_BC1: V_B1 -> up -> right to V_C1
        elm.Line().up().at(nB1.center).toy(nC1t.center).color(c1)
        RBC1 = Res().right().tox(nC1t.center).label('$R_{BC1}$', loc='top').color(c1)

        # --- Q2 -------------------------------------------------------------
        elm.Line().right(0.95).at(nC1.center)
        nC1r = elm.Dot().color(c2).zorder(z2)                                                     # R_BC2 leaves upward
        elm.Line().right(0.65)
        Q2 = elm.BjtNpn(circle=True).anchor('base').theta(0).label('$Q_2$', loc='right')

        elm.Line().up(0.75).at(Q2.collector)
        nC2 = elm.Dot().label('$V_{C2}$', loc='right', ofst=(0.05, -0.3), color='black').color(c2).zorder(z2)   # R_BC2 lands from left
        elm.Line().up(0.6)
        nOut = elm.Dot()                     # V_C2 node: C_out leaves right
        elm.Line().up(0.2)
        R2 = Res().up(RL).label('$R_{2}$', loc='top')
        elm.Line().up(0.25)
        Vcc(lead=False).label('$V_{CC}$', loc='top')

        # R_BC2: V_C1 -> up -> right to V_C2
        elm.Line().up().at(nC1r.center).toy(nC2.center).color(c2)
        RBC2 = Res().right().tox(nC2.center).label('$R_{BC2}$', loc='top').color(c2)

        # --- output: Cout -> RV2 ---------------------------------------------
        Cout = elm.Capacitor().at(nOut.center).right(1.8).label('$C_{out}$', loc='top').scale(1.25)
        RV2 = Pot().down(1.6).label('$RV_{2}$', loc='bottom', ofst=(-.5, -.45))
        elm.GroundSignal(lead=False)
        elm.Line().at(RV2.tap).right(0.8)
        elm.Dot(open=True).label('output', loc='right')

        # --- Q2 emitter: V_E2, R3, CE2 + RV1 ---------------------------------
        LE2 = elm.Line().down().at(Q2.emitter).toy(G1.end[1] - 0.45)
        nE2 = elm.Dot().label('$V_{E2}$', loc='top', ofst=(-0.5, 0))
        R3 = Res().down(RL).label('$R_{3}$', loc='top')
        elm.GroundSignal(lead=False)

        CE2 = elm.Capacitor2(polar=True).at(nE2.center).right(1.6).label('$C_{E2}$', loc='top').scale(1.25)
        nRV1 = elm.Dot()
        RV1 = Pot().down(RL).label('$RV_{1}$', loc='top')
        elm.GroundSignal(lead=False)
        elm.Line().right().at(RV1.start).tox(RV1.tap)
        elm.Line().down().toy(RV1.tap)

        # --- RF: V_E2 -> V_B1 -------------------------------------------------
        RF = Res().at(nE2.center).left(2.4).label('$R_{F}$', loc='top')
        elm.Line().left().tox(nB1b.center)
        elm.Line().up().toy(nB1b.center)

    return d


plt.rcParams['svg.hashsalt'] = 'fuzzface-bc'   # stable ids between runs

image_dir = os.path.join(HERE, 'Images')
repo_root = os.path.dirname(HERE)
os.makedirs(image_dir, exist_ok=True)

VARIANTS = [('', False, False), ('_o1', True, False),
            ('_o2', False, True), ('_o12', True, True)]
for suffix, o1, o2 in VARIANTS:
    d = draw(o1, o2)
    svg_path = os.path.join(image_dir, f'FuzzFace_bc{suffix}.svg')
    png_path = os.path.join(image_dir, f'FuzzFace_bc{suffix}.png')
    d.save(svg_path, transparent=True)
    d.save(png_path, dpi=300, transparent=False)
    shutil.copyfile(svg_path, os.path.join(repo_root, f'schematic{suffix}.svg'))
    print('saved', svg_path)

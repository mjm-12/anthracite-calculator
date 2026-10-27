import os
import schemdraw
import schemdraw.elements as elm
import matplotlib
matplotlib.use('Agg')  # GUIを使わず、ファイル保存のみ行う
import matplotlib.pyplot as plt
from matplotlib import font_manager
import warnings
warnings.filterwarnings('ignore', message='.*non-interactive.*')

from schemdraw import elements as elm
from schemdraw.segments import Segment, SegmentCircle

# -------------------------
# フォントの読み込み

# font_path_reg = 'Fonts/SourceSans3-Regular.ttf'
# font_path_it  = 'Fonts/SourceSans3-Italic.ttf'

font_path_reg = 'Fonts/Helvetica Neue LT Pro 55 Roman.otf'
font_path_it  = 'Fonts/Helvetica Neue LT Pro 56 Italic.otf'

font_size = 14

# --- 2. フォントマネージャーに追加 ---
try:
    font_manager.fontManager.addfont(font_path_reg)
    font_manager.fontManager.addfont(font_path_it)
    
    # 正確なフォント名を取得
    prop_reg = font_manager.FontProperties(fname=font_path_reg)
    prop_it  = font_manager.FontProperties(fname=font_path_it)
    font_name = prop_reg.get_name()
    
    print(f"フォント読み込み成功: {font_name}")


except Exception as e:
    print(f"フォント読み込み失敗: {e}")
    font_name = 'sans-serif' # フォールバック

# --- 3. 数式フォントをカスタム設定にする ---
# まず 'custom' モードを有効化
plt.rcParams['mathtext.fontset'] = 'custom'
plt.rcParams['mathtext.default'] = 'regular'  # 数式のデフォルトスタイルを設定
plt.rcParams['font.size'] = font_size  # 数式フォントのサイズを明示的に設定

# 数式の各役割に、読み込んだフォントを割り当てる
plt.rcParams['mathtext.rm'] = font_name          # ローマン体（数字、単位など）
plt.rcParams['mathtext.it'] = f'{font_name}:italic' # イタリック体（変数 V, R など）
plt.rcParams['mathtext.bf'] = f'{font_name}:bold'   # ボールド体（ベクトルなど）

# ※通常のテキストフォントも合わせておく
plt.rcParams['font.family'] = font_name

# -------------------------


# =========================
# Vccを作成
class Vcc(elm.Vdd):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.scale(2) # Vdd自身の大きさを2倍する
        self.segments.append(SegmentCircle((0,0), 0.1)) # 中心に半径0.1の円を追加する

# =========================
# 抵抗
resw = 1.0 / 6
resh = .18

class Res(elm.Element2Term):
    def __init__(self, **kwargs):
            super().__init__(**kwargs)
            self.segments.append(Segment(
            [(0, 0), (0.5*resw, resh), (1.5*resw, -resh),
             (2.5*resw, resh), (3.5*resw, -resh),
             (4.5*resw, resh), (5.5*resw, -resh), (6*resw, 0)]))
            
# =========================
# 可変抵抗
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
        
class Var(Res):
    _element_defaults = {
        'arrowwidth': .12,
        'arrowlength': .2,
        'arrow_lw': None,
        'arrow_color': None,
        }
    def __init__(self, **kwargs):
        super().__init__(**kwargs)
        self.segments.append(
            Segment([(.75*resw, -resh*1.5), (5.25*resw, resw*2.5)],
            arrow='->', arrowwidth=self.params['arrowwidth'],
            arrowlength=self.params['arrowlength'],
            lw=self.params['arrow_lw'],
            color=self.params['arrow_color']
            ))
# =========================


with schemdraw.Drawing() as d:
    d.config(fontsize=font_size, font=font_name, lw=1) 
    
    # 入力
    elm.Dot(open=True).label('input', loc='left')
    C1 = elm.Capacitor2(polar=True).reverse().right(2).label('$C_{in}$', loc='top').scale(1.25) # .label('1μF',loc='bottom')
    elm.Dot().label('$V_{B1}$',loc='top')
    LB1 = elm.Line().right(.5)

    Q1 = elm.BjtNpn(circle=True).anchor('base').theta(0).label('$Q_1$',loc='right')
    elm.Line().down(.25).at(Q1.emitter)
    elm.GroundSignal(lead=False)

    LC1 = elm.Line().up(0.5).at(Q1.collector)
    elm.Dot().label('$V_{C1}$',loc='top',ofst=(0.4,0))

    R1 = Res().up(2).label('$R_{1}$',loc='bottom') # \n33k
    Vcc(lead=False).label('$V_{CC}$',loc='top') # \n+9V

    LE2 = elm.Line().right(1.5).at(R1.start)
    Q2 = elm.BjtNpn(circle=True).anchor('base').theta(0).label('$Q_2$',loc='right')

    R2 = Res().up(2).label('$R_{2}$',loc='bottom') # \n8.2k
    Vcc(lead=False).label('$V_{CC}$',loc='top') # \n+9V

    L2e = elm.Line().down(2).at(Q2.emitter)
    elm.Dot().label('$V_{E2}$',loc='top',ofst=(-0.4,0))

    R3 = Res().down(2).label('$R_{3}$',loc='top') # \nB1k
    # elm.Line().down(2)
    elm.GroundSignal(lead=False)

    
    C2 = elm.Capacitor2(polar=True).at(R3.start).right(2).label('$C_{E2}$',loc='top').scale(1.25) # \n20μF
    elm.Dot()
    RV1 = Pot().down(2).label('$RV_{1}$',loc="top")
    elm.GroundSignal(lead=False)

    elm.Line().right().at(RV1.start).tox(RV1.tap)
    elm.Line().down().toy(RV1.tap)

    R4 = Res().at(R3.start).left(2.5).label('$R_{F}$',loc='top') # .label('100k',loc='bottom')
    elm.Line().tox(C1.end)
    elm.Line().toy(C1.end)

    elm.Dot().at(R2.start).label('$V_{C2}$',loc='top',ofst=(-0.4,-0.1))
    C3 = elm.Capacitor().right(2).label('$C_{out}$',loc='top').scale(1.25) # .label('0.01μF',loc='bottom')
    RV2 = Pot().down(2).label('$RV_{2}$',ofst=(-.5,-.5),loc='bottom') # \nA500k
    elm.GroundSignal(lead=False)

    elm.Line().at(RV2.tap).right(1)
    elm.Dot(open=True).label('output', loc='right')

    elm.CurrentLabel(top=False, length=1.2, ofst=-.5).at(R2).label('$I_{C2}$',loc='top',ofst=-.05).reverse()
    elm.CurrentLabel(top=False, length=.7, ofst=-0.3).at(LC1).label('$I_{C1}$',loc='top',ofst=-.05).reverse()

    
    """
    # 電流ラベル
    elm.CurrentLabel(length=1, ofst=0.3).at(LB1).label('$I_{B1}$')
    elm.CurrentLabel(length=1.25, ofst=0.3).at(LE2).label('$I_{B2}$')
    elm.CurrentLabel(length=1.25, ofst=0.3).at(L2e).label('$I_{E2}$')

    elm.CurrentLabel(top=False, length=1, ofst=0.3).at(R1).label('$I_{C1}+I_{B2}$').reverse()

    # 電圧ラベル
    gap_EB1 = elm.Gap().at(Q1.emitter).to(Q1.base)
    elm.VoltageLabelArc(length=1, ofst=.3).at(gap_EB1).label('$V_{BE}$')
    """

    # 保存
    image_dir = os.path.join(os.path.dirname(__file__), 'Images')
    os.makedirs(image_dir, exist_ok=True)
    
    base_name = os.path.splitext(os.path.basename(__file__))[0]
    d.save(os.path.join(image_dir, f'{base_name}.svg'), dpi=300)
    d.save(os.path.join(image_dir, f'{base_name}.png'), dpi=300, transparent=False)
    print(f"FuzzFace images has been exported to {image_dir}")
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
    IN = elm.Dot(open=True).label('input', loc='left')
    L1 = elm.Line().right(2).dot()
    Rie1 = Res().down(3).label('$r_{ie1}$',loc='bottom')
    Lie1 = elm.Line().right(1.5).dot()

    # Q1周辺
    Lg1 = elm.Line().down(2).at(Lie1.end).dot()
    elm.Line().left().tox(IN.start)
    INg = elm.Dot(open=True)

    elm.Line().right(1.5).at(Lie1.end)
    elm.SourceI().reverse().label('$h_{fe1} \\cdot i_{b1}$',color='red')

    # コレクタ
    elm.Line().right(2).dot()
    Lc1 = elm.Line().down(2)
    Rc1 = Res().down(1).label('$R_{C1}$',loc='bottom')
    elm.Line().down(2)
    Lg2 = elm.Line().left().tox(Lg1.start).dot()

    # Q2周辺
    Lie2 = elm.Line().right(3).at(Lc1.start)
    Rie2 = Res().down(2.5).label('$r_{ie2}$',loc='bottom')
    Lie2g = elm.Line().right(1.5).dot()
    Re2 = Var().down().toy(INg.start).label('$R_{E2}$',loc='bottom',ofst=(.3,-.25)).reverse()
    Lg3 = elm.Line().left().tox(Lg2.start).dot()

    elm.Line().right(1.5).at(Lie2g.end).dot()
    Cr2 = elm.SourceI().up(2.5).reverse().label('$h_{fe2} \\cdot i_{b2}$',color='red')

    # 出力
    elm.Line().right(4).at(Cr2.end)
    Rc2b = Res().down(2.5).label('$R_{C2b}$',loc='bottom').dot()
    Rc2 = Res().down().toy(INg.start).label('$R_{S}$',loc='bottom',fontsize=font_size,ofst=(-.2,.1)).label('$= R_{C2t}\\,//\\,RV_{2}$',loc='bottom',fontsize=font_size-2,ofst=(.2,.2)).dot()
    Lg4 = elm.Line().left().tox(Lg3.start).dot()

    elm.Line().right(4).at(Rc2.start)
    OUT = elm.Dot(open=True).label('output',loc='right')
    Lg5 = elm.Line().right().at(Lg4.start).tox(OUT.start)
    OUTg = elm.Dot(open=True)

    #フィードバック
    elm.Line().right(1.5).at(Cr2.start)
    elm.Line().up(6)
    Rf = Res().left().label('$R_F$',loc='bottom').tox(L1.end)
    elm.Line().down().toy(L1.end)

    # ==========================

    # Current Label
    elm.CurrentLabel(length=1).at(L1).label('$i_1$',ofst=-.15).color('red')
    elm.CurrentLabel(length=1,ofst=-.6).at(Rie1).label('$i_{b1}$',loc='top',ofst=-.1).color('red')
    elm.CurrentLabel(length=1, ofst=.3).at(Lc1).label('$i_{c1}$',ofst=-.1).color('red').reverse
    elm.CurrentLabel(length=1, ofst=.3).at(Lie2).label('$i_{b2}$',ofst=-.1).color('red')
    elm.CurrentLabel(length=1, ofst=-.6).at(Rf).label('$i_f$',ofst= -.65).color('red')
    elm.CurrentLabel(length=1,ofst=-1.2).at(Re2).label('$i_{e2}$',loc='top',ofst=-.1).color('red').reverse()
    elm.CurrentLabel(length=1,ofst=-.6).at(Rc2).label('$i_{c2}$',loc='top',ofst=-.1).color('red')
    elm.CurrentLabel(length=1,ofst=-.6).at(Rc2b).label('$i_{c2}$',loc='top',ofst=-.1).color('red')

    # 入力電圧
    label_gap = 0.6
    in_top = IN.start
    in_bottom = INg.start
    l_in = abs(in_top.y - in_bottom.y)
    elm.Line().up(0.2).at(INg.start).color('white')
    elm.Line(lw=1).up(l_in/2 - 0.2 - label_gap/2).color('blue')
    elm.Line().up(label_gap).color('white')
    elm.Line(arrow='=>',lw=1).up(l_in/2 - 0.2 - label_gap/2).color('blue')
    elm.Line().toy(IN.start).color('white')
    elm.Gap().at(IN.start).toy(INg.start).label('$v_{in}$').color('blue')

    # 出力電圧
    out_top = OUT.start
    out_bottom = OUTg.start
    l_out = abs(out_top.y - out_bottom.y)
    elm.Line().up(0.2).at(OUTg.start).color('white')
    elm.Line(lw=1).up(l_out/2 - 0.2 - label_gap/2).color('blue')
    elm.Line().length(label_gap).color('white')
    elm.Line(arrow='=>',lw=1).up(l_out/2 - 0.2 - label_gap/2) .color('blue')
    elm.Gap().at(OUT.start).toy(OUTg.start).label('$v_{out}$').color('blue')

    # 電圧ラベル
    elm.VoltageLabelArc(top=True,ofst=0.2,length=4,bend=1).at(Rf).reverse().label('$v_{f}$').color('blue')

    Ge2 = elm.Gap().at(Rie2.start).toy(INg.start)
    elm.VoltageLabelArc(top=False,ofst=0.4,length=4.5,bend=1.2).at(Ge2).color('blue').label('$v_{b2}$').reverse()

    cur_2 = Cr2.start
    l_Cr2 = abs(cur_2.y - in_bottom.y)
    elm.Line().down(0.2).at(Cr2.start).color('white')
    elm.Line(arrow="<=",lw=1).down(l_Cr2 - 0.4).color('blue').label('$v_{e2}$',loc='bottom',ofst=-.05)



    # 保存
    image_dir = os.path.join(os.path.dirname(__file__), 'Images')
    os.makedirs(image_dir, exist_ok=True)
    
    base_name = os.path.splitext(os.path.basename(__file__))[0]
    d.save(os.path.join(image_dir, f'{base_name}.svg'), dpi=300)
    d.save(os.path.join(image_dir, f'{base_name}.png'), dpi=300, transparent=False)
    print(f"FuzzFace images has been exported to {image_dir}")
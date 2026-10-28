# Anthracite Calc

2 石の直結帰還型ファズ（Fuzz Face 系、NPN / PNP）の動作点、利得、周波数特性、安定性を SPICE モデルから計算するブラウザ用ツールである。Trope のファズペダル [Anthracite](https://github.com/trope-oshw/anthracite) の定数決定に使用したものを公開用に再構成。

<img src="schematic.svg" width="560">

## 使い方

### 導入

GitHub Pages で公開しているため、ブラウザで開けばインストールなしで利用可能。

https://mjm-12.github.io/anthracite-calculator/

オフラインで利用する場合はclone したうえで、

```
python -m http.server 8765
```

を実行し、 `index.html` を開く。`bode.html` とのやり取りに BroadcastChannel を使うため、`file://` では一部が動作しない。



### 操作

入力は Enter か欄を離れたときに確定し再計算する。抵抗と電流の欄では ↑↓ で E24 系列の隣の値に切り替え可能。

| 操作（切替） | キー |
|---|---|
| $I_C \to R$ / $R \to I_C$ | Alt+1 / Alt+2 |
| $R_F$ 指定 / $V_{E2}$ 指定 | Alt+3 |
| NPN / PNP | Alt+P |
| Anthracite / Classic | Alt+K |
| 結果を反対のモードへ代入 | Ctrl+Enter |
| dB / 倍率 | Alt+G |
| ボード線図 / 別ウィンドウ | Alt+B / Shift+Alt+B |
| RV1 掃引（ボード線図内） | Alt+R |
| ボード線図 / 安定性（ボード線図内） | Alt+T |
| CSV 書き出し / 読み込み | Ctrl+S / Ctrl+O |

結果欄の電流の右上にある ? にカーソルを合わせると、その電流の位置と向きを回路図上に表示する。

## 機能

- コレクタ電流$I_{C1}, I_{C2}$ と動作点比率 $V_{R2}:V_{CE2}$ から $R_1, R_2, R_3$ の算出。$V_{R2}:V_{CE2}:V_{E2}$ を与えたときは指定値を満たす $R_F$ を算出する
- 抵抗値からコレクタ電流、動作点比率の算出
- 中域利得 $A_v$、信号源抵抗 $R_{in}$ を含む $A_{vs}$、$Z_{in}$ の計算
- 結合容量、接合容量、拡散容量を含む周波数特性の計算（bode）
- 各トランジスタの B–C 間に任意の $R_{BC}$, $C_{BC}$ を実装した際の特性の計算
- 2 種類のトポロジの切り替え
  - Anthracite：$R_3$ と並列に $C_{E2}$ + RV1、$R_{BC}$ / $C_{BC}$ を追加可能
  - Classic：RV1 を $R_3$ として使い、ワイパーから $C_{E2}$ で接地。$R_{2t}$ / $R_{2b}$ の接続点から出力
- NPN / PNP の切り替え。PNP は $V_{CC}$ を負の値で与え、電圧と枝電流は符号付きで表示する。$I_C$, $I_B$, $h_{FE}$ は大きさで表示する
- ギターのピックアップ（Texas Special Neck、57 Classic Neck）を信号源にした周波数特性と安定性の評価（beta）
  - 全ループを含めた発振の判定と、最も減衰の小さい極の $\zeta$
  - $R_F$ ループのループ利得（Tian 法）、位相余裕、利得余裕
- $I_B, V_{CE}, I_C, V_{BE}$ の測定値より SPICE パラメータの推定（Q1/Q2 の fit から `fit.html`）。PNP にも対応

サンプルのトランジスタモデル 2SC8888-W（NPN）と 2SA9999-W（PNP）は、実在の品番に対応しない仮想モデルである。

## モデルと精度

Gummel-Poon の直流モデル（VAF, VAR, IKF, IKR, BR, NR, ISC, NC を含む）で節点方程式を Newton 法で解き、その動作点の偏微分から小信号モデルを構成する。容量は CJE, CJC, TF, TR からバイアス点で求める。

LTspice 24 と比べた差は次のとおり。多くの場合において必要十分な精度を確保している。

| 項目 | 差 |
|---|---|
| 直流（RB, RE, RC を除いた .model） | ノード電圧 0.004 mV 以内 |
| 直流（.model そのまま） | ノード電圧 1.4 mV 以内 |
| 中域の $A_v$, $Z_{in}$ | 0.12 % 以内 |
| 周波数特性 10 Hz〜1 MHz（6 回路） | 0.006 dB、0.02° 以内 |
| PNP、Classic の直流 / 周波数特性 | ノード電圧 30 µV、0.007 dB 以内 |
| 発振・減衰の周波数と速さ（過渡解析） | 0.03 %、0.3 % 以内 |

直流の RB, RE, RC と IRB, RBM、温度依存は計算に用いない。結果は TNOM での値で、$V_T = 25.85$ mV は 300 K に相当する。なお、大振幅でファズとして歪ませたときの挙動は扱わない。

ピックアップは DCR、$L_s$、$C_p$、$R_p$ の集中定数で近似した。実機で発振境界を測定していないため、安定性の評価は beta 扱いとする。

## ファイル

| パス | 内容 |
|---|---|
| `index.html`, `js/app.js` | 計算画面 |
| `js/engine.js` | 直流、交流、周波数特性、安定性の計算（DOM 非依存） |
| `js/fit.js`, `fit.html`, `js/fit-app.js` | パラメータ推定 |
| `bode.html`, `js/bode-plot.js`, `js/bode-app.js` | ボード線図の別ウィンドウと描画 |
| `js/spice-parser.js`, `js/utils.js` | .model の読み取り、工学表記、CSV |
| `schematic*.svg`, `Python/FuzzFace_bc.py` | 回路図（Anthracite / Classic、NPN / PNP。Anthracite は $R_{BC}$, $C_{BC}$ の重ね合わせ用を含む）と生成スクリプト |
| `schematic_currents.json` | 電流の矢印を回路図上に描く座標 |

---

Fuzz Face は Dunlop Manufacturing, Inc. の商標である。本ツールは同社と関係がない。

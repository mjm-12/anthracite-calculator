# Anthracite Calc

NPN 2 石の直結帰還型ファズ（Fuzz Face 系）の動作点、利得、周波数特性を SPICE モデルから計算するブラウザ用ツールである。Trope のファズペダル Anthracite の定数決定に使用したものを公開用に再構成。

<img src="schematic.svg" width="560">

## 使い方

GitHub Pages で公開している。ブラウザで開けば、インストールなしで使える。

https://mjm-12.github.io/anthracite-calculator/

手元で動かす場合は、静的サーバで配信して `index.html` を開く。`bode.html` とのやり取りに BroadcastChannel を使うので、`file://` では一部が動作しない。

```
python -m http.server 8765
```

入力は Enter か欄を離れたときに確定し再計算する。抵抗と電流の欄では ↑↓ で E24 系列の隣の値に切り替え可能。

| 操作（切替） | キー |
|---|---|
| $I_C \to R$ / $R \to I_C$ | Alt+1 / Alt+2 |
| $R_F$ 指定 / $V_E$ 指定 | Alt+3 |
| 結果を反対のモードへ代入 | Ctrl+Enter |
| dB / 倍率 | Alt+G |
| ボード線図 / 別ウィンドウ | Alt+B / Shift+Alt+B |
| RV1 掃引（ボード線図内） | Alt+R |
| CSV 書き出し / 読み込み | Ctrl+S / Ctrl+O |

## 機能

- コレクタ電流$I_{C1}, I_{C2}$ と動作点比率 $V_R:V_C$ から $R_1, R_2, R_3$ の算出。$V_R:V_C:V_E$ を与えたときは指定値を満たす $R_F$ を算出する
- 抵抗値からコレクタ電流、動作点比率の算出
- 中域利得 $A_v$、信号源抵抗 $R_{in}$ を含む $A_{vs}$、$Z_{in}$ の計算
- 結合容量、接合容量、拡散容量を含む周波数特性の計算（bode）
- 各トランジスタの B–C 間に任意の $R_{BC}$, $C_{BC}$ を実装した際の特性の計算
- $I_B, V_{CE}, I_C, V_{BE}$ の測定値より SPICE パラメータの推定（Q1/Q2 の fit から `fit.html`）

## モデルと精度

Gummel-Poon の直流モデル（VAF, VAR, IKF, IKR, BR, NR, ISC, NC を含む）で節点方程式を Newton 法で解き、その動作点の偏微分から小信号モデルを構成する。容量は CJE, CJC, TF, TR からバイアス点で求める。

LTspice 24 と比べた差は次のとおりだった。

| 項目 | 差 |
|---|---|
| 直流（RB, RE, RC を除いた .model） | ノード電圧 0.004 mV 以内 |
| 直流（.model そのまま） | ノード電圧 1.4 mV 以内 |
| 中域の $A_v$, $Z_{in}$ | 0.12 % 以内 |
| 周波数特性 10 Hz〜1 MHz（6 回路） | 0.006 dB、0.02° 以内 |

直流の RB, RE, RC と IRB, RBM、温度依存は計算しない。結果は TNOM での値で、$V_T = 25.85$ mV は 300 K に相当する。大振幅でファズとして歪ませたときの挙動は扱わない。

## テスト

```
node tests/engine.test.js
node tests/fit.test.js
node tests/bode.test.js
```

依存パッケージを要しない。LTspice の参照値はテストに埋め込んである。

## ファイル

| パス | 内容 |
|---|---|
| `index.html`, `js/app.js` | 計算画面 |
| `js/engine.js` | 直流、交流、周波数特性の計算（DOM 非依存） |
| `js/fit.js`, `fit.html`, `js/fit-app.js` | パラメータ推定 |
| `bode.html`, `js/bode-plot.js`, `js/bode-app.js` | ボード線図の別ウィンドウと描画 |
| `js/spice-parser.js`, `js/utils.js` | .model の読み取り、工学表記、CSV |
| `schematic*.svg`, `Python/FuzzFace_bc.py` | 回路図（基本図と $R_{BC}$, $C_{BC}$ の重ね合わせ用）と生成スクリプト |

---

Fuzz Face は Dunlop Manufacturing, Inc. の商標である。本ツールは同社と関係がない。

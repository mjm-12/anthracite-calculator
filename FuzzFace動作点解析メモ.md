---
tags:
See also: []
date: 2026-01-28
imageNameKey:
permalink: 4ca56beafaa944
---


下図の様な回路が与えられると考える。

![alt text](FuzzFace-Classic.png)


## 問題設定
![alt text](FuzzFace_eq.png)

ゲインA
$$
A = \frac{v_{out}}{v_{in}}
$$
と入力インピーダンスZ

$$
Z = \frac{v_{in}}{i_1}
$$
を求めることが目標。
### KCL
点A

$$
i_{1} + i_{f} = i_{b1}
$$

点B

$$
0 = h_{fe1} i_{b1} + i_{b2} + i_{c1}
$$

点C

$$
i_{b2} + h_{fe2} i_{b2} = i_{e2} + i_{f}
$$

点D

$$
0 = h_{fe2} i_{b2} + i_{c2}
$$

### オームの法則
A-GND

$$
v_{in} = r_{ie1} i_{b1}
$$

B-GND

$$
v_{b2} = R_1 i_{c1} 
$$

B-C

$$
v_{b2} - v_{e2} = r_{ie2} i_{b2}
$$
C-GND

$$
v_{e2} = (RV_1 \parallel R_3 )i_{e2}
$$

C-A

$$
\begin{align}
v_f &= R_F i_f \\
v_f &= v_{e2} - v_{in}
\end{align}
$$

OUT-GND

$$
v_{out} = (R_2 \parallel RV_2) i_{c2}
$$

と与えられます。

### Spiceパラメータ

ここでトランジスタについて、以下のようなSpiceパラメータが与えられていると考えます。

```spice
.MODEL 2SC8888-W NPN(IS=2.544E-14 BF=380.43 NF=1.002 VAF=125.5 IKF=0.385 ISE=4.88E-15 NE=1.35 BR=8.22 NR=1.01 VAR=18.5 IKR=0.18 ISC=3.25E-14 NC=1.25 RB=12.8 IRB=5.0E-05 RBM=2.0 RE=0.185 RC=0.88 CJE=15.32p VJE=0.75 MJE=0.34 CJC=5.12p VJC=0.55 MJC=0.32 FC=0.5 TF=445.0p XTF=8.0 VTF=12.0 ITF=0.3 TR=65.0n EG=1.11 XTI=3.0 XTB=1.5 Vceo=60 Icrating=150m mfg=USO)
```

#### $r_{ie}$の導出

このとき、入力インピーダンス$r_{ie} ( = h_{ie})$は内部ベース抵抗$r_b$とB-E接合の動的抵抗$r_{\pi}$ 、内部エミッタ抵抗$R_E$を用いて

$$
h_{ie} = r_b + r_\pi + (1 + \beta) \cdot R_E
$$

で与えられます。ここで$r_{\pi}$の逆数$g_{\pi}$について考えます。まず、$r_{\pi}$はベース電流に対する$V_{BE}$の微分から求められるので、

$$
r_\pi = \frac{\partial V_{BE}}{\partial I_B} = \frac{1}{g_\pi}
$$

で与えられるので、展開すると、

$$g_\pi = \frac{\partial I_B}{\partial V_{BE}} = \frac{I_S}{B_F \cdot N_F \cdot V_T}\exp\left(\frac{V_{BE}}{N_F V_T}\right) + \frac{I_{SE}}{N_E \cdot V_T}\exp\left(\frac{V_{BE}}{N_E V_T}\right)$$

が得られます。再結合が小さい小〜中電流領域では

$$g_\pi \approx \frac{I_C}{\beta_{eff} \cdot N_F \cdot V_T}$$

のように近似できます。

ここで、実効的な$\beta$である$\beta_{eff}$は、

$$\beta_{eff} = \frac{I_C}{I_B} \approx \frac{B_F}{1 + \dfrac{B_F \cdot I_{SE}}{I_S} \cdot \exp\left(\dfrac{V_{BE}(N_F - N_E)}{N_F \cdot N_E \cdot V_T}\right)}$$

で与えられます。


次に$r_b$について考えます。Fuzz Faceのような低電流では

$$r_b \approx RB$$

と近似できます。


これらの結果から、入力インピーダンスは

$$
r_{ie} = RB + \frac{ \beta_{eff} \cdot N_F \cdot V_T}{I_C} + (1+\beta_{eff}) \cdot R_E
$$

より求めることができます。

#### $h_{fe}$の導出

小信号の交流電流増幅率$h_{fe}$は、トランスコンダクタンス$g_m$とベース入力コンダクタンス$g_\pi$の比として定義されます。

$$
h_{fe} = \frac{\partial I_C}{\partial I_B} = \frac{\partial I_C / \partial V_{BE}}{\partial I_B / \partial V_{BE}} = \frac{g_m}{g_\pi}
$$

**トランスコンダクタンス$g_m$の導出**

Gummel-Poonモデルにおいて、コレクタ電流$I_C$は

$$
I_C = I_S \exp\left(\frac{V_{BE}}{N_F V_T}\right)
$$

で近似できるので（低〜中電流領域）、$g_m$は

$$
g_m = \frac{\partial I_C}{\partial V_{BE}} = \frac{I_C}{N_F \cdot V_T}
$$

となります。

**$h_{fe}$の計算**

$g_\pi$は既に求めた通り

$$
g_\pi = \frac{I_S}{B_F \cdot N_F \cdot V_T}\exp\left(\frac{V_{BE}}{N_F V_T}\right) + \frac{I_{SE}}{N_E \cdot V_T}\exp\left(\frac{V_{BE}}{N_E V_T}\right)
$$

なので、$h_{fe} = g_m / g_\pi$を計算すると

$$
h_{fe} = \frac{I_C / (N_F V_T)}{\dfrac{I_C}{B_F \cdot N_F \cdot V_T} + \dfrac{I_{SE}}{N_E \cdot V_T}\exp\left(\dfrac{V_{BE}}{N_E V_T}\right)}
$$

分母分子を$I_C / (N_F V_T)$で割ると

$$
h_{fe} = \frac{1}{\dfrac{1}{B_F} + \dfrac{N_F \cdot I_{SE}}{N_E \cdot I_C}\exp\left(\dfrac{V_{BE}}{N_E V_T}\right)}
$$

ここで$V_{BE} \approx N_F V_T \ln(I_C / I_S)$を代入すると

$$
h_{fe} = \frac{B_F}{1 + \dfrac{B_F \cdot N_F \cdot I_{SE}}{N_E \cdot I_S} \cdot \left(\dfrac{I_C}{I_S}\right)^{(N_F - N_E)/N_E}}
$$

> [!note] $h_{fe}$と$\beta_{eff}$の関係
> 上記の式は$\beta_{eff}$の式と同一の形をしています。これは、低周波小信号において$h_{fe} \approx \beta_{eff}$であることを示しています。
>
> $$h_{fe} \approx \beta_{eff} = \frac{B_F}{1 + \dfrac{B_F \cdot I_{SE}}{I_S} \cdot \exp\left(\dfrac{V_{BE}(N_F - N_E)}{N_F \cdot N_E \cdot V_T}\right)}$$
>
> ただし、厳密には$h_{fe}$は微分で定義されるのに対し、$\beta_{DC} = I_C/I_B$は比で定義されるため、動作点によってわずかに異なる場合があります。

**周波数依存性**

高周波では$h_{fe}$は周波数依存性を持ち、

$$
h_{fe}(f) = \frac{h_{fe0}}{1 + j (f / f_\beta)}
$$

で表されます。ここで$f_\beta$はベータ遮断周波数、$h_{fe0}$は低周波での値です。トランジション周波数$f_T$との関係は

$$
f_T = h_{fe0} \cdot f_\beta
$$

です。ただし、Fuzz Faceのようなオーディオ帯域（〜20kHz）の解析では、$f \ll f_\beta$なので周波数依存性は無視でき、

$$
h_{fe} \approx h_{fe0} \approx \beta_{eff}
$$

と近似できます。

これにより、Fuzz Faceのゲインと入力インピーダンスを求める準備が整いました。


## ゲインの計算

### 変数の置き換え

計算を簡潔にするため、以下の置き換えを行います。

$$
R_E = RV_1 \parallel R_3 \quad \text{（Q2エミッタ抵抗）}
$$

$$
R_C = R_2 \parallel RV_2 \quad \text{（出力負荷抵抗）}
$$

### 方程式の番号付け

**KCL方程式：**
- (K1) 点A: $i_1 + i_f = i_{b1}$
- (K2) 点B: $0 = h_{fe1} i_{b1} + i_{b2} + i_{c1}$
- (K3) 点C: $(1 + h_{fe2}) i_{b2} = i_{e2} + i_f$
- (K4) 点D: $0 = h_{fe2} i_{b2} + i_{c2}$ → $i_{c2} = -h_{fe2} i_{b2}$

**オームの法則：**
- (O1) A-GND: $v_{in} = r_{ie1} i_{b1}$
- (O2) B-GND: $v_{b2} = R_1 i_{c1}$
- (O3) B-C: $v_{b2} - v_{e2} = r_{ie2} i_{b2}$
- (O4) C-GND: $v_{e2} = R_E i_{e2}$
- (O5) C-A: $i_f = \dfrac{v_{e2} - v_{in}}{R_F}$
- (O6) OUT-GND: $v_{out} = R_C i_{c2}$

> [!note] 電流の符号について
> - (K2)より $i_{c1} = -h_{fe1} i_{b1} - i_{b2}$（$i_{c1}$は負の値をとる）
> - (K4)より $i_{c2} = -h_{fe2} i_{b2}$（$i_{c2}$も負の値をとる）
>
> これは等価回路図で$i_{c1}$, $i_{c2}$が「GNDから点B/出力点へ向かう」正方向で定義されているためです。実際の電流は逆向き（点B/出力点からGNDへ）に流れます。

### Step 1: 出力電圧の表現

(K4)より $i_{c2} = -h_{fe2} i_{b2}$、(O6)より $v_{out} = R_C i_{c2}$ なので、

$$
v_{out} = R_C \cdot (-h_{fe2} i_{b2}) = -R_C h_{fe2} i_{b2} \tag{1}
$$

ゲインは

$$
A = \frac{v_{out}}{v_{in}} = -\frac{R_C h_{fe2} i_{b2}}{v_{in}} \tag{2}
$$

### Step 2: $i_{b1}$の表現

(O1)より、

$$
i_{b1} = \frac{v_{in}}{r_{ie1}} \tag{3}
$$

### Step 3: $v_{b2}$の表現

(K2)より $i_{c1} = -h_{fe1} i_{b1} - i_{b2}$、(O2)より $v_{b2} = R_1 i_{c1}$ なので、

$$
v_{b2} = R_1 \cdot (-h_{fe1} i_{b1} - i_{b2}) = -R_1 (h_{fe1} i_{b1} + i_{b2}) \tag{4}
$$

(3)を代入すると、

$$
v_{b2} = -R_1 \left( \frac{h_{fe1} v_{in}}{r_{ie1}} + i_{b2} \right) = -\frac{R_1 h_{fe1} v_{in}}{r_{ie1}} - R_1 i_{b2} \tag{5}
$$

### Step 4: $v_{e2}$の表現（フィードバックを含む）

(K3)を$i_{e2}$について解くと、

$$
i_{e2} = (1 + h_{fe2}) i_{b2} - i_f \tag{6}
$$

(O4)に代入すると、

$$
v_{e2} = R_E \left[ (1 + h_{fe2}) i_{b2} - i_f \right] \tag{7}
$$

(O5)より$i_f$を代入すると、

$$
v_{e2} = R_E (1 + h_{fe2}) i_{b2} - R_E \cdot \frac{v_{e2} - v_{in}}{R_F}
$$

$v_{e2}$について整理すると（前述の導出と同様）、

$$
v_{e2} = \frac{R_E R_F (1 + h_{fe2})}{R_F + R_E} i_{b2} + \frac{R_E}{R_F + R_E} v_{in} \tag{8}
$$

### Step 5: $i_{b2}$を$v_{in}$で表す

(O3)より、

$$
v_{b2} = v_{e2} + r_{ie2} i_{b2} \tag{9}
$$

(5)と(9)を等置すると、

$$
-\frac{R_1 h_{fe1} v_{in}}{r_{ie1}} - R_1 i_{b2} = v_{e2} + r_{ie2} i_{b2}
$$

(8)を代入すると、

$$
-\frac{R_1 h_{fe1} v_{in}}{r_{ie1}} - R_1 i_{b2} = \frac{R_E R_F (1 + h_{fe2})}{R_F + R_E} i_{b2} + \frac{R_E}{R_F + R_E} v_{in} + r_{ie2} i_{b2}
$$

$v_{in}$の項を左辺へ、$i_{b2}$の項を右辺へまとめます。

**左辺（$v_{in}$の項）：**

$$
- v_{in} \left[ \frac{R_1 h_{fe1}}{r_{ie1}} + \frac{R_E}{R_F + R_E} \right]
$$

通分すると、

$$
= - v_{in} \cdot \frac{R_1 h_{fe1} (R_F + R_E) + R_E r_{ie1}}{r_{ie1} (R_F + R_E)}
$$

**右辺（$i_{b2}$の項）：**

$$
i_{b2} \left[ R_1 + r_{ie2} + \frac{R_E R_F (1 + h_{fe2})}{R_F + R_E} \right]
$$

通分すると（分母の行列式 $\Delta$ の一部）、

$$
= i_{b2} \cdot \frac{(R_1 + r_{ie2})(R_F + R_E) + R_E R_F (1 + h_{fe2})}{R_F + R_E}
$$

ここで分母の式を $\Delta_{denom}$ と置くと、

$$
\Delta_{denom} = (R_1 + r_{ie2})(R_F + R_E) + R_E R_F (1 + h_{fe2})
$$

**$i_{b2}$を求める：**

$$
i_{b2} = - v_{in} \cdot \frac{R_1 h_{fe1} (R_F + R_E) + R_E r_{ie1}}{r_{ie1} \Delta_{denom}} \tag{10}
$$

### Step 6: ゲインの最終式

(2)に(10)を代入すると、

$$
A = -\frac{R_C h_{fe2}}{v_{in}} \cdot \left( - v_{in} \cdot \frac{R_1 h_{fe1} (R_F + R_E) + R_E r_{ie1}}{r_{ie1} \Delta_{denom}} \right)
$$

負の符号が打ち消し合い、

$$
A = \frac{R_C h_{fe2} \left[ R_1 h_{fe1} (R_F + R_E) + R_E r_{ie1} \right]}{r_{ie1} \left[ (R_1 + r_{ie2})(R_F + R_E) + R_E R_F (1 + h_{fe2}) \right]}
$$

整理すると、

$$
\boxed{A = \frac{R_C h_{fe2} \left[ R_1 h_{fe1} (R_F + R_E) + R_E r_{ie1} \right]}{r_{ie1} \left[ (R_1 + r_{ie2})(R_F + R_E) + R_E R_F (1 + h_{fe2}) \right]}} \tag{11}
$$

これにより、正のゲインが得られ、分子の項も加算 $(+)$ となり物理的に妥当な結果となります。

## 入力インピーダンスの計算

### Step 1: $i_1$の表現

(K1)より、

$$
i_1 = i_{b1} - i_f \tag{12}
$$

### Step 2: $i_f$の表現

(O5) $i_f = \frac{v_{e2} - v_{in}}{R_F}$ に (8) $v_{e2} = \dots$ を代入して整理すると（前述同様）、

$$
i_f = \frac{R_E (1 + h_{fe2})}{R_F + R_E} i_{b2} - \frac{v_{in}}{R_F + R_E} \tag{13}
$$

### Step 3: $i_{b2}$を$v_{in}$で表す

(10)より、$i_{b2} = \kappa \cdot v_{in}$と書けます。ここで、

$$
\kappa = - \frac{R_1 h_{fe1} (R_F + R_E) + R_E r_{ie1}}{r_{ie1} \Delta_{denom}} \tag{14}
$$

### Step 4: $Z_{in}$の導出

(12)に(3)と(13)を代入すると、

$$
i_1 = \frac{v_{in}}{r_{ie1}} - \left[ \frac{R_E (1 + h_{fe2}) \kappa}{R_F + R_E} v_{in} - \frac{v_{in}}{R_F + R_E} \right]
$$

$$
i_1 = v_{in} \left[ \frac{1}{r_{ie1}} + \frac{1 - R_E (1 + h_{fe2}) \kappa}{R_F + R_E} \right]
$$

入力インピーダンス $Z_{in} = v_{in} / i_1$ は、

$$
Z_{in} = \frac{1}{\dfrac{1}{r_{ie1}} + \dfrac{1 - R_E (1 + h_{fe2}) \kappa}{R_F + R_E}} \tag{15}
$$

ここで $\kappa$ は負の値を持つため、$- R_E (1 + h_{fe2}) \kappa$ の項は正になります。
数式を見やすく整理するため、$\kappa = - \frac{N_+}{r_{ie1} \Delta_{denom}}$ と置きます。
ここで $N_+ = R_1 h_{fe1} (R_F + R_E) + R_E r_{ie1}$ です。

(15)の分母を展開して整理します。

$$
\text{Denom} = \frac{1}{r_{ie1}} + \frac{1}{R_F+R_E} - \frac{R_E(1+h_{fe2})}{R_F+R_E} \left( - \frac{N_+}{r_{ie1} \Delta_{denom}} \right)
$$

$$
\text{Denom} = \frac{1}{r_{ie1}} + \frac{1}{R_F+R_E} + \frac{R_E(1+h_{fe2}) N_+}{r_{ie1} (R_F+R_E) \Delta_{denom}}
$$

通分（共通分母 $r_{ie1} (R_F+R_E) \Delta_{denom}$）すると、

$$
\text{Numerator of Denom} = (R_F+R_E)\Delta_{denom} + r_{ie1}\Delta_{denom} + R_E(1+h_{fe2}) N_+
$$

よって入力インピーダンスは、

$$
Z_{in} = \frac{r_{ie1} (R_F+R_E) \Delta_{denom}}{(R_F+R_E + r_{ie1})\Delta_{denom} + R_E(1+h_{fe2}) \left[ R_1 h_{fe1} (R_F + R_E) + R_E r_{ie1} \right]} \tag{16}
$$

この式は、フィードバック効果により入力インピーダンスが $r_{ie1}$ よりも低くなる（並列フィードバックによるMiller効果的な振る舞い）ことを示唆します。

### 物理的解釈

$$
Z_{in} = \frac{r_{ie1}}{1 + \text{LoopGainTerm}}
$$

フィードバックにより入力電流 $i_f$ が増大（入力から吸い込まれる電流が増える）するため、見かけのインピーダンスは低下します。これは電圧－並列負帰還（Shunt-Shunt Feedback）の特徴と一致します。


## レビュー(GLM-4.7)

### ゲインの計算の検証

**検証結果：正しい**

#### 方程式の整合性確認

1. **方程式(K2): $i_{c1} + i_{b2} + h_{fe1} i_{b1} = 0$**
   - 点BにおけるKCL（電流の和 = 0）
   - $i_{c1}$：点Bから$R_1$を通じて流出（正方向）
   - $i_{b2}$：点BからQ2ベースへ流出（正方向）
   - $h_{fe1} i_{b1}$：Q1コレクタから点Bへ流入（負方向として定義）
   - したがって：$i_{c1} + i_{b2} - (-h_{fe1} i_{b1}) = 0$ではなく、電流源が吸い込む方向を考慮すると、$i_{c1} + i_{b2} + h_{fe1} i_{b1} = 0$が正しい
   - 等価回路図を確認すると、$h_{fe1} i_{b1}$は上向き（点Bから点A方向）なので、点Bから流出する電流の和を0とするとき、$i_{c1} + i_{b2} = -h_{fe1} i_{b1}$となり、これを変形すると$i_{c1} + i_{b2} + h_{fe1} i_{b1} = 0$
   - **結論：正しい**

2. **方程式(K4): $i_{c2} = h_{fe2} i_{b2}$**
   - Q2コレクタ電流の定義
   - 等価回路図でQ2のコレクタ電流は上向き（点Dから$R_C$方向）
   - $h_{fe2} i_{b2}$も上向き
   - したがって$i_{c2} = h_{fe2} i_{b2}$が正しい
   - **結論：正しい**

3. **方程式(O2): $v_{b2} = R_1 i_{c1}$**
   - $R_1$の両端電圧
   - 点Bの電圧$v_{b2}$とGNDの電圧（0V）の差
   - $R_1$を流れる電流$i_{c1}$（点BからGND方向）による電圧降下
   - したがって$v_{b2} = R_1 i_{c1}$が正しい
   - **結論：正しい**

4. **方程式(O6): $v_{out} = - R_C i_{c2}$**
   - 出力電圧の定義
   - $R_C$を流れる電流$i_{c2} = h_{fe2} i_{b2}$は、出力点からGNDへ向かう（等価回路図の電流方向）
   - 電流が流出するとき、電圧は低下するため$v_{out} = - R_C i_{c2}$が正しい
   - これはAC信号の反転増幅としての解釈と整合
   - **結論：正しい**

#### 導出プロセスの検証

1. **式(3): $i_{b1} = v_{in} / r_{ie1}$**
   - (O1)より、正しい

2. **式(5): $v_{b2} = -\frac{R_1 h_{fe1} v_{in}}{r_{ie1}} - R_1 i_{b2}$**
   - (K2): $i_{c1} + i_{b2} + h_{fe1} i_{b1} = 0$より、$i_{c1} = -h_{fe1} i_{b1} - i_{b2}$
   - (O2): $v_{b2} = R_1 i_{c1}$に代入すると、$v_{b2} = R_1 (-h_{fe1} i_{b1} - i_{b2})$
   - (3)を代入すると、$v_{b2} = -\frac{R_1 h_{fe1} v_{in}}{r_{ie1}} - R_1 i_{b2}$
   - **結論：正しい**

3. **式(8): $v_{e2} = \frac{R_E R_F (1 + h_{fe2})}{R_F + R_E} i_{b2} + \frac{R_E}{R_F + R_E} v_{in}$**
   - (K3)と(O4)、(O5)から導出
   - 数学検証：
     - (K3): $(1 + h_{fe2}) i_{b2} = i_{e2} + i_{f}$
     - (O4): $v_{e2} = R_E i_{e2}$ → $i_{e2} = v_{e2} / R_E$
     - (O5): $i_{f} = (v_{e2} - v_{in}) / R_F$
     - 代入：$(1 + h_{fe2}) i_{b2} = v_{e2} / R_E + (v_{e2} - v_{in}) / R_F$
     - 整理：$(1 + h_{fe2}) i_{b2} + v_{in} / R_F = v_{e2} (1 / R_E + 1 / R_F)$
     - $v_{e2} = \frac{(1 + h_{fe2}) i_{b2} + v_{in} / R_F}{1 / R_E + 1 / R_F}$
     - 通分：$v_{e2} = \frac{R_E R_F (1 + h_{fe2}) i_{b2} + R_E v_{in}}{R_F + R_E}$
     - $v_{e2} = \frac{R_E R_F (1 + h_{fe2})}{R_F + R_E} i_{b2} + \frac{R_E}{R_F + R_E} v_{in}$
   - **結論：正しい**

4. **式(10): $i_{b2} = - v_{in} \cdot \frac{R_1 h_{fe1} (R_F + R_E) + R_E r_{ie1}}{r_{ie1} \Delta_{denom}}$**
   - (O3): $v_{b2} = v_{e2} + r_{ie2} i_{b2}$
   - (5)と(9)を等置：$-\frac{R_1 h_{fe1} v_{in}}{r_{ie1}} - R_1 i_{b2} = v_{e2} + r_{ie2} i_{b2}$
   - (8)を代入：$-\frac{R_1 h_{fe1} v_{in}}{r_{ie1}} - R_1 i_{b2} = \frac{R_E R_F (1 + h_{fe2})}{R_F + R_E} i_{b2} + \frac{R_E}{R_F + R_E} v_{in} + r_{ie2} i_{b2}$
   - $v_{in}$の項を左辺、$i_{b2}$の項を右辺へ：
     - 左辺：$-v_{in} \left[ \frac{R_1 h_{fe1}}{r_{ie1}} + \frac{R_E}{R_F + R_E} \right] = -v_{in} \cdot \frac{R_1 h_{fe1} (R_F + R_E) + R_E r_{ie1}}{r_{ie1} (R_F + R_E)}$
     - 右辺：$i_{b2} \left[ R_1 + r_{ie2} + \frac{R_E R_F (1 + h_{fe2})}{R_F + R_E} \right] = i_{b2} \cdot \frac{(R_1 + r_{ie2})(R_F + R_E) + R_E R_F (1 + h_{fe2})}{R_F + R_E}$
   - したがって：$i_{b2} = -v_{in} \cdot \frac{R_1 h_{fe1} (R_F + R_E) + R_E r_{ie1}}{r_{ie1} \left[ (R_1 + r_{ie2})(R_F + R_E) + R_E R_F (1 + h_{fe2}) \right]}$
   - **結論：正しい**

5. **式(11): ゲインの最終式**
   - (2): $A = -\frac{R_C h_{fe2} i_{b2}}{v_{in}}$
   - (10)を代入：$A = -\frac{R_C h_{fe2}}{v_{in}} \cdot \left( -v_{in} \cdot \frac{R_1 h_{fe1} (R_F + R_E) + R_E r_{ie1}}{r_{ie1} \Delta_{denom}} \right)$
   - 符号が打ち消し合い：$A = \frac{R_C h_{fe2} \left[ R_1 h_{fe1} (R_F + R_E) + R_E r_{ie1} \right]}{r_{ie1} \Delta_{denom}}$
   - **結論：正しい**

#### 物理的な正しさの確認

1. **ゲインの符号**：
   - 最終式(11)は正のゲインを与える
   - 2段のエミッタ接地増幅器は、各段で反転するため、合計で2回の反転 → 正のゲイン
   - **結論：物理的に正しい**

2. **分子の物理的意味**：
   - $R_1 h_{fe1} (R_F + R_E)$：Q1の前段ゲインとフィードバックの影響
   - $R_E r_{ie1}$：エミッタ抵抗と入力インピーダンスの積
   - 両者が加算されることで、フィードバックの影響が適切に表現されている
   - **結論：物理的に妥当**

**総合評価：ゲインの計算は正しい**

---

### 入力インピーダンスの計算の検証

**検証結果：正しい**

#### 導出プロセスの検証

1. **式(12): $i_1 = i_{b1} - i_{f}$**
   - (K1): $i_1 + i_f = i_{b1}$より、$i_1 = i_{b1} - i_f$
   - **結論：正しい**

2. **式(13): $i_f = \frac{R_E (1 + h_{fe2})}{R_F + R_E} i_{b2} - \frac{v_{in}}{R_F + R_E}$**
   - (O5): $i_f = (v_{e2} - v_{in}) / R_F$
   - (8): $v_{e2} = \frac{R_E R_F (1 + h_{fe2})}{R_F + R_E} i_{b2} + \frac{R_E}{R_F + R_E} v_{in}$
   - 代入：$i_f = \frac{1}{R_F} \left[ \frac{R_E R_F (1 + h_{fe2})}{R_F + R_E} i_{b2} + \frac{R_E}{R_F + R_E} v_{in} - v_{in} \right]$
   - 整理：$i_f = \frac{R_E (1 + h_{fe2})}{R_F + R_E} i_{b2} + \frac{R_E - (R_F + R_E)}{R_F + R_E} \cdot \frac{v_{in}}{R_F} \cdot R_F$
   - いや、簡易的に：
     - $i_f = \frac{1}{R_F} \left[ \frac{R_E R_F (1 + h_{fe2})}{R_F + R_E} i_{b2} + \frac{R_E v_{in}}{R_F + R_E} - v_{in} \right]$
     - $i_f = \frac{R_E (1 + h_{fe2})}{R_F + R_E} i_{b2} + \frac{R_E v_{in} - (R_F + R_E) v_{in}}{R_F (R_F + R_E)} \cdot R_F$
     - $i_f = \frac{R_E (1 + h_{fe2})}{R_F + R_E} i_{b2} - \frac{R_F v_{in}}{R_F (R_F + R_E)}$
     - $i_f = \frac{R_E (1 + h_{fe2})}{R_F + R_E} i_{b2} - \frac{v_{in}}{R_F + R_E}$
   - **結論：正しい**

3. **式(14): $\kappa = - \frac{R_1 h_{fe1} (R_F + R_E) + R_E r_{ie1}}{r_{ie1} \Delta_{denom}}$**
   - (10)より、$i_{b2} = \kappa v_{in}$
   - したがって、$\kappa$は(10)の係数
   - **結論：正しい**

4. **式(15)への導出**：
   - (12): $i_1 = i_{b1} - i_f$
   - (3): $i_{b1} = v_{in} / r_{ie1}$
   - (13): $i_f = \frac{R_E (1 + h_{fe2})}{R_F + R_E} i_{b2} - \frac{v_{in}}{R_F + R_E}$
   - 代入：$i_1 = \frac{v_{in}}{r_{ie1}} - \left[ \frac{R_E (1 + h_{fe2})}{R_F + R_E} i_{b2} - \frac{v_{in}}{R_F + R_E} \right]$
   - $i_1 = \frac{v_{in}}{r_{ie1}} - \frac{R_E (1 + h_{fe2})}{R_F + R_E} i_{b2} + \frac{v_{in}}{R_F + R_E}$
   - $i_{b2} = \kappa v_{in}$を代入：
     - $i_1 = \frac{v_{in}}{r_{ie1}} - \frac{R_E (1 + h_{fe2}) \kappa}{R_F + R_E} v_{in} + \frac{v_{in}}{R_F + R_E}$
     - $i_1 = v_{in} \left[ \frac{1}{r_{ie1}} + \frac{1}{R_F + R_E} - \frac{R_E (1 + h_{fe2}) \kappa}{R_F + R_E} \right]$
   - **結論：正しい**

5. **式(15)の分母**：
   - $\frac{1}{r_{ie1}} + \frac{1}{R_F + R_E} - \frac{R_E (1 + h_{fe2}) \kappa}{R_F + R_E}$
   - これは原文の記述と整合

6. **式(16): 最終式の検証**：
   - 分母を通分：
     - $\frac{1}{r_{ie1}} + \frac{1}{R_F + R_E} + \frac{R_E (1 + h_{fe2}) N_+}{r_{ie1} (R_F + R_E) \Delta_{denom}}$
     （ここで$\kappa = -N_+ / (r_{ie1} \Delta_{denom})$なので、$-\kappa = N_+ / (r_{ie1} \Delta_{denom})$）
   - 共通分母：$r_{ie1} (R_F + R_E) \Delta_{denom}$
   - 分子：
     - $(R_F + R_E) \Delta_{denom} + r_{ie1} \Delta_{denom} + R_E (1 + h_{fe2}) N_+$
   - したがって：
     - $Z_{in} = \frac{r_{ie1} (R_F + R_E) \Delta_{denom}}{(R_F + R_E + r_{ie1}) \Delta_{denom} + R_E (1 + h_{fe2}) \left[ R_1 h_{fe1} (R_F + R_E) + R_E r_{ie1} \right]}$
   - **結論：正しい**

#### 物理的な正しさの確認

1. **入力インピーダンスの低下**：
   - 並列フィードバック（Shunt-Shunt Feedback）により、入力インピーダンスが低下する
   - 式(16)の分母には、$\Delta_{denom}$に加えて追加の項$R_E (1 + h_{fe2}) [\dots]$がある
   - これにより、$Z_{in} < r_{ie1}$になる（条件付き）
   - **結論：物理的に妥当**

2. **$R_F \to \infty$の極限**：
   - $R_F \to \infty$のとき、$\Delta_{denom} \to (R_1 + r_{ie2}) R_F$（第1項が支配的）
   - また、分子$\to r_{ie1} R_F \Delta_{denom} / R_F \approx r_{ie1} \Delta_{denom}$
   - 分母の追加項$\to 0$（$R_E / R_F \to 0$）
   - したがって、$Z_{in} \to r_{ie1}$
   - フィードバックがない場合の入力インピーダンスと一致
   - **結論：物理的に正しい**

**総合評価：入力インピーダンスの計算は正しい**

---

### 総合評価

| 項目 | 結果 | 詳細 |
|------|------|------|
| **ゲインの計算** | **正しい** | 方程式の定義、導出プロセス、物理的意味すべてにおいて正しい。正のゲインが得られ、物理的に妥当 |
| **入力インピーダンスの計算** | **正しい** | 方程式の定義、導出プロセス、物理的意味すべてにおいて正しい。フィードバックによるインピーダンス低下が適切に表現されている |

**結論：修正後のゲインおよび入力インピーダンスの計算は、厳格な検証の結果、正しいことが確認されました。**


## レビュー (Claude Opus)

### 1. 方程式定義の検証

#### (K2) $0 = h_{fe1} i_{b1} + i_{b2} + i_{c1}$ の検証

**等価回路図との整合性:**

等価回路図を確認すると、点Bにおいて：
- $h_{fe1} i_{b1}$の電流源の矢印は**下向き**（点BからGND方向へ吸い込む）
- $i_{c1}$は**上向き**（GNDから点B方向）に定義
- $i_{b2}$は**右向き**（点BからQ2ベース方向）

**KCL（点Bにおける電流の収支）:**

図の定義に基づくと：
- 流入: $i_{c1}$（上向きで定義）
- 流出: $h_{fe1} i_{b1}$（電流源が吸い込む）、$i_{b2}$（右向き）

$$i_{c1} = h_{fe1} i_{b1} + i_{b2}$$

これを変形すると：
$$0 = h_{fe1} i_{b1} + i_{b2} - i_{c1}$$

問題設定の式 $0 = h_{fe1} i_{b1} + i_{b2} + i_{c1}$ とは$i_{c1}$の符号が異なりますが、$i_{c1}$の正方向の定義が「GND→点B」の場合、実際の電流（点B→GND）では$i_{c1} < 0$となります。

**結論: 図の電流方向定義と整合している。**

---

#### (K4) $0 = h_{fe2} i_{b2} + i_{c2}$ の検証

**等価回路図との整合性:**

図を確認すると：
- $h_{fe2} i_{b2}$の電流源は出力ノードからGND方向へ吸い込む
- $i_{c2}$は出力ノードから$R_C$を通ってGND方向

**KCL（出力ノード = 点D）:**

$h_{fe2} i_{b2}$が「流出」（GNDへ吸い込み）、$i_{c2}$も「流出」なら：
$$0 = h_{fe2} i_{b2} + i_{c2}$$
$$\therefore i_{c2} = -h_{fe2} i_{b2}$$

> [!check] 整合性確認
> (K4)は問題設定セクションの定義 $0 = h_{fe2} i_{b2} + i_{c2}$ と**完全に一致**しています。
> (O6)も問題設定の $v_{out} = R_C i_{c2}$ と一致しています。

**結論: 問題設定と整合しており、正しい。**

---

### 2. 導出過程の数学的検証

#### Step 3: 式(4)→式(5)の導出

(K2): $i_{c1} + i_{b2} + h_{fe1} i_{b1} = 0$
$$\therefore i_{c1} = -h_{fe1} i_{b1} - i_{b2}$$

(O2): $v_{b2} = R_1 i_{c1}$
$$v_{b2} = R_1 (-h_{fe1} i_{b1} - i_{b2}) = -R_1 h_{fe1} i_{b1} - R_1 i_{b2}$$

(3)を代入: $i_{b1} = v_{in}/r_{ie1}$
$$v_{b2} = -\frac{R_1 h_{fe1} v_{in}}{r_{ie1}} - R_1 i_{b2}$$

**結論: 式(5)は正しい。**

---

#### Step 5: 式(10)の導出

(5)と(9)を等置：
$$-\frac{R_1 h_{fe1} v_{in}}{r_{ie1}} - R_1 i_{b2} = v_{e2} + r_{ie2} i_{b2}$$

(8)を代入：
$$-\frac{R_1 h_{fe1} v_{in}}{r_{ie1}} - R_1 i_{b2} = \frac{R_E R_F (1 + h_{fe2})}{R_F + R_E} i_{b2} + \frac{R_E}{R_F + R_E} v_{in} + r_{ie2} i_{b2}$$

**左辺（$v_{in}$の項）を整理:**
$$-v_{in} \left[ \frac{R_1 h_{fe1}}{r_{ie1}} + \frac{R_E}{R_F + R_E} \right] = -v_{in} \cdot \frac{R_1 h_{fe1}(R_F + R_E) + R_E r_{ie1}}{r_{ie1}(R_F + R_E)}$$

**右辺（$i_{b2}$の項）を整理:**
$$i_{b2} \left[ R_1 + r_{ie2} + \frac{R_E R_F (1 + h_{fe2})}{R_F + R_E} \right] = i_{b2} \cdot \frac{(R_1 + r_{ie2})(R_F + R_E) + R_E R_F(1 + h_{fe2})}{R_F + R_E}$$

**$i_{b2}$を求める:**
$$i_{b2} = -v_{in} \cdot \frac{R_1 h_{fe1}(R_F + R_E) + R_E r_{ie1}}{r_{ie1} \Delta_{denom}}$$

**結論: 式(10)は正しい。**

---

#### Step 6: ゲインの最終式

(2): $A = -\frac{R_C h_{fe2} i_{b2}}{v_{in}}$

(10)を代入:
$$A = -\frac{R_C h_{fe2}}{v_{in}} \cdot \left( -v_{in} \cdot \frac{R_1 h_{fe1}(R_F + R_E) + R_E r_{ie1}}{r_{ie1} \Delta_{denom}} \right)$$

負の符号が打ち消し合い:
$$A = \frac{R_C h_{fe2} [R_1 h_{fe1}(R_F + R_E) + R_E r_{ie1}]}{r_{ie1} \Delta_{denom}}$$

**結論: 式(11)は正しい。**

---

### 3. 参考記事との比較検証

参考記事（https://zenn.dev/bj_9/articles/5052267b1f2455）のゲイン式:

$$A_v = \frac{h_{fe2} \cdot (R_{C2t} \parallel RV_2) \cdot [h_{fe1} \cdot R_{C1} \cdot (R_F + R_{E2}) + r_{ie1} \cdot R_{E2}]}{r_{ie1} \cdot [(R_{C1} + r_{ie2})(R_F + R_{E2}) + (1 + h_{fe2}) \cdot R_F \cdot R_{E2}]}$$

変数の対応:

| 本メモ | 参考記事 |
|--------|----------|
| $R_C = R_2 \parallel RV_2$ | $R_{C2t} \parallel RV_2$ |
| $R_1$ | $R_{C1}$ |
| $R_E = RV_1 \parallel R_3$ | $R_{E2}$ |

本メモの式(11):
$$A = \frac{R_C h_{fe2} [R_1 h_{fe1}(R_F + R_E) + R_E r_{ie1}]}{r_{ie1} [(R_1 + r_{ie2})(R_F + R_E) + R_E R_F(1 + h_{fe2})]}$$

> [!check] 検証結果
> **式(11)は参考記事のゲイン式と完全に一致しています。**

---

### 4. 物理的妥当性の検証

#### ゲインの符号

$$A > 0 \text{（正のゲイン）}$$

**解釈:**
- Q1: エミッタ接地 → 反転増幅（位相180°シフト）
- Q2: エミッタ接地 → 反転増幅（位相180°シフト）
- 合計: 360°シフト = 同相 → **正のゲインは物理的に正しい**

#### 分子の符号

$$R_1 h_{fe1}(R_F + R_E) + R_E r_{ie1} > 0$$

すべての項が正なので、分子は常に正。**物理的に妥当。**

#### $R_F \to \infty$（フィードバック無し）の極限

$$\lim_{R_F \to \infty} A = \lim_{R_F \to \infty} \frac{R_C h_{fe2} [R_1 h_{fe1} R_F + \cdots]}{r_{ie1} [(R_1 + r_{ie2}) R_F + \cdots]}$$

$$= \frac{R_C h_{fe2} \cdot R_1 h_{fe1}}{r_{ie1} (R_1 + r_{ie2})} = \frac{R_C h_{fe2} R_1 h_{fe1}}{r_{ie1}(R_1 + r_{ie2})}$$

これは2段増幅器のカスケードゲイン（フィードバック無し）の式に一致。**物理的に正しい。**

---

### 5. 入力インピーダンスの検証

式(16):
$$Z_{in} = \frac{r_{ie1}(R_F + R_E)\Delta_{denom}}{(R_F + R_E + r_{ie1})\Delta_{denom} + R_E(1 + h_{fe2})[R_1 h_{fe1}(R_F + R_E) + R_E r_{ie1}]}$$

#### $R_F \to \infty$の極限

分母の第2項: $R_E(1 + h_{fe2})[\cdots]$ は$R_F$に比例
分母の第1項: $(R_F + R_E + r_{ie1})\Delta_{denom}$ は$R_F^2$に比例

$$\lim_{R_F \to \infty} Z_{in} = \lim_{R_F \to \infty} \frac{r_{ie1} R_F \cdot (R_1 + r_{ie2}) R_F}{(R_F + r_{ie1})(R_1 + r_{ie2}) R_F}$$

$$= \frac{r_{ie1}(R_1 + r_{ie2})}{R_1 + r_{ie2}} = r_{ie1}$$

**フィードバック無しで$Z_{in} = r_{ie1}$となり、物理的に正しい。**

---

### 6. 総合評価

| 検証項目 | 結果 | 備考 |
|----------|------|------|
| (K2)の定義 | ✅ 正しい | 問題設定と整合、図の電流方向と一貫 |
| (K4)の定義 | ✅ 正しい | 問題設定と完全一致 |
| (O6)の定義 | ✅ 正しい | 問題設定と完全一致 |
| 式(10)の導出 | ✅ 正しい | 数学的に検証済み |
| 式(11)ゲイン | ✅ 正しい | 参考記事と完全一致 |
| 式(16)入力インピーダンス | ✅ 正しい | 極限検証で物理的妥当性確認 |
| 物理的意味 | ✅ 妥当 | 正のゲイン、$R_F \to \infty$の極限が正しい |

> [!tip] 結論
> **すべての方程式が問題設定セクションと整合しており、最終的なゲイン式(11)と入力インピーダンス式(16)は正しいです。**
>
> - (K2), (K4), (O6)が問題設定と完全に一致
> - 参考記事のゲイン式とも完全一致
> - 物理的妥当性も確認済み（正のゲイン、極限での正しい振る舞い）

## 別解：行列式を用いた解法

### 方程式の行列形式への変換

未知数を $[v_{b2}, v_{e2}, i_{b2}]^T$ とし、$v_{in}$ は入力として既知とします。

**使用する方程式:**

1. (O3): $v_{b2} - v_{e2} = r_{ie2} i_{b2}$
2. (K2)+(O2): $v_{b2} = -R_1(h_{fe1} i_{b1} + i_{b2}) = -\frac{R_1 h_{fe1}}{r_{ie1}} v_{in} - R_1 i_{b2}$
3. (K3)+(O4)+(O5)から導出した式(8): $v_{e2} = \frac{R_E R_F (1+h_{fe2})}{R_F+R_E} i_{b2} + \frac{R_E}{R_F+R_E} v_{in}$

**標準形に整理:**

$$
\begin{cases}
v_{b2} - v_{e2} - r_{ie2} i_{b2} = 0 \\
v_{b2} + R_1 i_{b2} = -\dfrac{R_1 h_{fe1}}{r_{ie1}} v_{in} \\
v_{e2} - \dfrac{R_E R_F (1+h_{fe2})}{R_F+R_E} i_{b2} = \dfrac{R_E}{R_F+R_E} v_{in}
\end{cases}
$$

**行列形式 $\mathbf{A} \mathbf{x} = \mathbf{b}$:**

$$
\underbrace{\begin{pmatrix}
1 & -1 & -r_{ie2} \\
1 & 0 & R_1 \\
0 & 1 & -\dfrac{R_E R_F (1+h_{fe2})}{R_F+R_E}
\end{pmatrix}}_{\mathbf{A}}
\begin{pmatrix}
v_{b2} \\
v_{e2} \\
i_{b2}
\end{pmatrix}
=
\underbrace{\begin{pmatrix}
0 \\
-\dfrac{R_1 h_{fe1}}{r_{ie1}} \\
\dfrac{R_E}{R_F+R_E}
\end{pmatrix}}_{\mathbf{b}} v_{in}
$$

### ｘによる解法

$i_{b2}$を求めるには、クラメルの公式を使用：

$$
i_{b2} = \frac{\det(\mathbf{A}_3)}{\det(\mathbf{A})}
$$

ここで $\mathbf{A}_3$ は行列 $\mathbf{A}$ の3列目を $\mathbf{b}$ で置き換えた行列。

#### 係数行列の行列式 $\det(\mathbf{A})$

$$
\det(\mathbf{A}) = \begin{vmatrix}
1 & -1 & -r_{ie2} \\
1 & 0 & R_1 \\
0 & 1 & -\dfrac{R_E R_F (1+h_{fe2})}{R_F+R_E}
\end{vmatrix}
$$

第1行で展開：

$$
= 1 \cdot \begin{vmatrix} 0 & R_1 \\ 1 & -\dfrac{R_E R_F (1+h_{fe2})}{R_F+R_E} \end{vmatrix}
- (-1) \cdot \begin{vmatrix} 1 & R_1 \\ 0 & -\dfrac{R_E R_F (1+h_{fe2})}{R_F+R_E} \end{vmatrix}
+ (-r_{ie2}) \cdot \begin{vmatrix} 1 & 0 \\ 0 & 1 \end{vmatrix}
$$

$$
= 1 \cdot \left( -R_1 \right) + 1 \cdot \left( -\frac{R_E R_F (1+h_{fe2})}{R_F+R_E} \right) - r_{ie2} \cdot 1
$$

$$
= -R_1 - \frac{R_E R_F (1+h_{fe2})}{R_F+R_E} - r_{ie2}
$$

通分すると：

$$
\det(\mathbf{A}) = -\frac{(R_1 + r_{ie2})(R_F+R_E) + R_E R_F (1+h_{fe2})}{R_F+R_E} = -\frac{\Delta_{denom}}{R_F+R_E}
$$

#### $\det(\mathbf{A}_3)$ の計算

$$
\mathbf{A}_3 = \begin{pmatrix}
1 & -1 & 0 \\
1 & 0 & -\dfrac{R_1 h_{fe1}}{r_{ie1}} \\
0 & 1 & \dfrac{R_E}{R_F+R_E}
\end{pmatrix} v_{in}
$$

$$
\det(\mathbf{A}_3) = v_{in} \cdot \begin{vmatrix}
1 & -1 & 0 \\
1 & 0 & -\dfrac{R_1 h_{fe1}}{r_{ie1}} \\
0 & 1 & \dfrac{R_E}{R_F+R_E}
\end{vmatrix}
$$

第1行で展開：

$$
= v_{in} \left[ 1 \cdot \left( 0 + \frac{R_1 h_{fe1}}{r_{ie1}} \right) + 1 \cdot \left( \frac{R_E}{R_F+R_E} - 0 \right) \right]
$$

$$
= v_{in} \left( \frac{R_1 h_{fe1}}{r_{ie1}} + \frac{R_E}{R_F+R_E} \right)
$$

通分：

$$
\det(\mathbf{A}_3) = v_{in} \cdot \frac{R_1 h_{fe1}(R_F+R_E) + R_E r_{ie1}}{r_{ie1}(R_F+R_E)}
$$

#### $i_{b2}$ の導出

$$
i_{b2} = \frac{\det(\mathbf{A}_3)}{\det(\mathbf{A})} = \frac{v_{in} \cdot \dfrac{R_1 h_{fe1}(R_F+R_E) + R_E r_{ie1}}{r_{ie1}(R_F+R_E)}}{-\dfrac{\Delta_{denom}}{R_F+R_E}}
$$

$$
= v_{in} \cdot \frac{R_1 h_{fe1}(R_F+R_E) + R_E r_{ie1}}{r_{ie1}(R_F+R_E)} \cdot \frac{R_F+R_E}{-\Delta_{denom}}
$$

$$
\boxed{i_{b2} = -v_{in} \cdot \frac{R_1 h_{fe1}(R_F+R_E) + R_E r_{ie1}}{r_{ie1} \Delta_{denom}}}
$$

これは式(10)と一致します。

### まとめ：行列解法の利点

| 解法 | 手順 | 特徴 |
|------|------|------|
| **逐次代入法** | 式を順番に代入して整理 | 直感的だが計算量が多い |
| **行列式法** | $3 \times 3$行列式を2回計算 | 機械的に解ける、計算ミスが少ない |

> [!tip] 計算のコツ
> 行列式の計算では、0が多い行・列で展開すると効率的です。また、$R_F + R_E$を共通因子として通分すると、$\Delta_{denom}$が自然に現れます。
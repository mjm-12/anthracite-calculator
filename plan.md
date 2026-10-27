
現在作成しているwebアプリは以下の問と答えに対応しています。

# 問題

![alt text](archive/FuzzFace-Classic.svg)

![alt text](archive/FuzzFace-Classic.png)

（同一画像です）

図のようなFuzz Faceの最適な動作点は
$$
I_2 R_2 : V_{CC} - I_2 R_2 -R_3 I_3 = 1+R2/RV2 :1
$$

で与えられます。各ノードでのキルヒホッフの式は

$$
\begin{align}
I_1 &= I_{B2} + h_{FE1} I_{B1}\\
I_{B1} &= I_{F} \\
I_{F} + I_3 &= I_{B2}(1+h_{FE2}) \\
I_2 &= I_{B2}h_{FE2}  \\
V_{BE1} + I_F R_F &= I_3 R_3  \\
I_3 R_3 + V_{BE2} + I_1 R_1 &= V_{CC}
\end{align}
$$

で与えられます。

また、熱電圧$V_T$と
```spice
.MODEL 2SC5395-F NPN(Is=43.773E-15 Bf=375.71 Vaf=86.600 Ikf=.7 Ise=43.773E-15 Ne=1.7679 Br=8.5951 Var=5 Ikr=10.010E-3 Isc=145.43E-12 Nc=2.2998 Nk=.68987 Rb=9.7807 Rc=.6642 Cje=15.662E-12 Vje=.83869 Mje=.38051 Cjc=6.4060E-12 Vjc=.46595 Mjc=.2832 Tf=558.14E-12 Xtf=294.17 Vtf=315.74 Itf=4.6695 Tr=195.43E-9 Xtb=1.5000 Vceo=50 Icrating=200m mfg=ISAHAYA)
```
のようなspiceパラメータが与えられたとき、

$$
I_C = I_S \exp\left(\frac{V_{BE}}{V_T}\right) \quad \Rightarrow \quad \boxed{V_{BE} = V_T \ln\left( \frac{I_C}{I_S} \right)} 
$$
及び

$$ I_B = \frac{I_S}{\beta_F}\left(e^{\frac{V_{BE}}{V_T}}-1\right) + I_{SE}\left(e^{\frac{V_{BE}}{N_E V_T}}-1\right) $$
を用いることで、各電流でのトランジスタの動作点を特定できます。

これらを用いて、各トランジスタのコレクタ電流が$I_{C1},I_{C2}$における最適な動作点を実現するための、R1,R2, R3を求めてください。


---

# 模範解答: Fuzz Faceの最適動作点設計

## 1. 概要と方針
本問題は、指定されたトランジスタのコレクタ電流 ($I_{C1}, I_{C2}$) において、回路が「最適な動作点（最大振幅動作点）」を満たすための抵抗値 $R_1, R_2, R_3$ を求めるものです。

トランジスタのベース電流 $I_B$ とベース・エミッタ間電圧 $V_{BE}$ は定数ではなく、指定された $I_C$ とSPICEモデルパラメータから逆算する必要があります。これらを求めた後、キルヒホッフの法則を用いて各抵抗値を導出します。

前提条件として、典型的なFuzz Face回路の定数を以下と仮定します（これらはコード内で変更可能です）。
*   電源電圧: $V_{CC} = 9.0\text{ V}$
*   帰還抵抗: $R_F = 100\text{ k}\Omega$
*   出力ボリューム: $RV_2 = 500\text{ k}\Omega$
*   熱電圧: $V_T \approx 25.85\text{ mV} (300\text{K})$

## 2. トランジスタの動作点の特定
SPICEモデル式より、コレクタ電流 $I_C$ が与えられたときの $V_{BE}$ と $I_B$ は以下のように求まります。

1.  **$V_{BE}$ の導出**:
    $$ V_{BE} = V_T \ln\left( \frac{I_C}{I_S} \right) $$

2.  **$I_B$ の導出**:
    $$ I_B = \frac{I_S}{\beta_F}\left(e^{\frac{V_{BE}}{V_T}}-1\right) + I_{SE}\left(e^{\frac{V_{BE}}{N_E V_T}}-1\right) $$

これにより、ターゲットとする $I_{C1}, I_{C2}$ から、$V_{BE1}, I_{B1}$ および $V_{BE2}, I_{B2}$ が一意に定まります。

## 3. 回路方程式の解法

求めた電流・電圧値を用いて、各ノードのKCL（キルヒホッフの電流則）とKVL（電圧則）から抵抗値を逆算します。

### ステップ1: $R_3$ の算出
$Q_1$ のベース周辺と $Q_2$ のエミッタ周辺に着目します。
*   問題文より $I_{B1} = I_F$。
*   $Q_2$のエミッタ電流は $I_{E2} = I_{C2} + I_{B2}$ です。
*   ノード $V_{E2}$ でのKCLより: $I_{E2} = I_3 + I_F$ なので、
    $$ I_3 = (I_{C2} + I_{B2}) - I_{B1} $$
    ※ここで $I_3 > 0$ である必要があります。
*   $Q_1$ のベースループのKVL ($V_{BE1} + I_F R_F = I_3 R_3$) より:
    $$ R_3 = \frac{V_{BE1} + I_{B1} R_F}{I_3} $$
    これで $R_3$ と $V_{E2} = I_3 R_3$ が求まります。

### ステップ2: $R_1$ の算出
$Q_1$ のコレクタ（$Q_2$のベース）周辺に着目します。
*   $Q_1$ のコレクタ電位 $V_{C1}$ は、$Q_2$ のベース電位に等しいため:
    $$ V_{C1} = V_{E2} + V_{BE2} $$
*   $R_1$ を流れる電流 $I_1$ は:
    $$ I_1 = I_{C1} + I_{B2} $$
*   電源電圧との関係 ($V_{CC} = I_1 R_1 + V_{C1}$) より:
    $$ R_1 = \frac{V_{CC} - V_{C1}}{I_1} $$

### ステップ3: $R_2$ の算出（最適動作点の適用）
問題文の最適動作点の条件式を用います。
$$ I_2 R_2 : V_{CC} - I_2 R_2 - I_3 R_3 = 1 + \frac{R_2}{RV_2} : 1 $$
これは抵抗 $R_2$ での電圧降下 $V_{R2} = I_2 R_2$ と、トランジスタ $Q_2$ のコレクタ・エミッタ間電圧 $V_{CE2} = V_{CC} - V_{R2} - V_{E2}$ の比率を指定するものです。
$$ \frac{I_2 R_2}{V_{CC} - I_2 R_2 - V_{E2}} = 1 + \frac{R_2}{RV_2} $$
ここで、$V_{avail} = V_{CC} - V_{E2}$（$R_2$とTrで使える電圧）とし、$I_2 = I_{C2}$ とすると、以下の2次方程式が得られます。
$$ \frac{I_{C2}}{RV_2} R_2^2 + \left( 2 I_{C2} - \frac{V_{avail}}{RV_2} \right) R_2 - V_{avail} = 0 $$
この2次方程式の正の解が求める $R_2$ です。

---

## 4. Pythonによる数値計算の実装

以下に、上記の導出過程を実装したPythonコードを示します。例として、シリコンFuzz Faceで良好とされるバイアス電流付近（$Q_1 \approx 50\mu A, Q_2 \approx 500\mu A$）での計算を行います。

```python
import numpy as np

def solve_fuzz_face_bias(Ic1_target, Ic2_target):
    # --- 1. 定数定義 ---
    # SPICE Model Parameters (2SC5395-F)
    Is  = 43.773e-15
    Bf  = 375.71
    Ise = 43.773e-15
    Ne  = 1.7679
    Vt  = 25.85e-3  # Thermal Voltage at 300K

    # Circuit Constants
    Vcc = 9.0       # 電源電圧 [V]
    Rf  = 100e3     # 帰還抵抗 [ohm]
    Rv2 = 500e3     # Volume Pot [ohm]

    # --- 2. トランジスタ動作点の計算関数 ---
    def get_vbe(Ic):
        if Ic <= 0: return 0
        return Vt * np.log(Ic / Is)

    def get_ib(Vbe):
        # I_B = (Is/Bf)*(exp(Vbe/Vt)-1) + Ise*(exp(Vbe/(Ne*Vt))-1)
        term1 = (Is / Bf) * (np.exp(Vbe / Vt) - 1)
        term2 = Ise * (np.exp(Vbe / (Ne * Vt)) - 1)
        return term1 + term2

    # --- 3. 計算実行 ---
    # Q1, Q2のVbe, Ibを特定
    Vbe1 = get_vbe(Ic1_target)
    Ib1  = get_ib(Vbe1)
    
    Vbe2 = get_vbe(Ic2_target)
    Ib2  = get_ib(Vbe2)

    # R3の計算
    # I3 = (Ic2 + Ib2) - Ib1 (Ib1 = If)
    If = Ib1
    I3 = (Ic2_target + Ib2) - If
    
    if I3 <= 0:
        return "Error: I3 <= 0. Impossible current combination."

    # R3 = (Vbe1 + If*Rf) / I3
    R3 = (Vbe1 + If * Rf) / I3
    Ve2 = I3 * R3

    # R1の計算
    # Vc1 = Ve2 + Vbe2
    # I1 = Ic1 + Ib2
    Vc1 = Ve2 + Vbe2
    I1 = Ic1_target + Ib2
    
    if Vc1 >= Vcc:
        return "Error: Vc1 >= Vcc. Decrease currents or increase Vcc."
        
    R1 = (Vcc - Vc1) / I1

    # R2の計算 (2次方程式の解)
    # A*R2^2 + B*R2 + C = 0
    V_avail = Vcc - Ve2
    A = Ic2_target / Rv2
    B = 2 * Ic2_target - V_avail / Rv2
    C = -V_avail
    
    # 解の公式
    discriminant = B**2 - 4*A*C
    if discriminant < 0:
        return "Error: No real solution for R2."
    
    R2 = (-B + np.sqrt(discriminant)) / (2*A)

    return {
        "Inputs": {"Ic1": Ic1_target, "Ic2": Ic2_target},
        "Resistors": {"R1": R1, "R2": R2, "R3": R3},
        "Voltages": {"Vc1": Vc1, "Vc2 (output bias)": Vcc - Ic2_target*R2, "Ve2": Ve2}
    }

# --- 実行例 ---
# シリコンFuzz Faceの典型的な低電流動作点 (Ic1=50uA, Ic2=500uA) を想定
result = solve_fuzz_face_bias(50e-6, 500e-6)

# 結果表示
print("=== Fuzz Face 設計結果 ===")
print(f"Target currents: Ic1={result['Inputs']['Ic1']*1e6:.1f}uA, Ic2={result['Inputs']['Ic2']*1e6:.1f}uA")
print("\n[Calculated Resistors]")
print(f"R1 = {result['Resistors']['R1']/1000:.2f} kΩ")
print(f"R2 = {result['Resistors']['R2']/1000:.2f} kΩ")
print(f"R3 = {result['Resistors']['R3']:.2f} Ω")
print("\n[Operating Point Voltages]")
print(f"Vc1 = {result['Voltages']['Vc1']:.2f} V")
print(f"Vc2 = {result['Voltages']['Vc2 (output bias)']:.2f} V")
print(f"Ve2 = {result['Voltages']['Ve2']:.2f} V")
```

## 5. 計算結果の例
上記のコードを実行すると、以下のような値が得られます（$I_{C1}=50\mu A, I_{C2}=500\mu A$ の場合）。

*   **R1**: 約 **152.8 kΩ**
*   **R2**: 約 **8.5 kΩ** (標準的な8.2kΩに近い)
*   **R3**: 約 **1.1 kΩ** (標準的な1kΩに近い)
*   **Vc2**: 約 **4.74 V** (電源9Vの中点付近、最適なバイアス)

このように、与えられた「最適な動作点」の式は、出力電圧（$V_{C2}$）が電源電圧の約半分になり、かつボリューム（$RV_2$）による負荷効果を考慮した最大振幅動作点を実現するものであることがわかります。





逆計算モード：R1~R3, RF, RV1, RV2, Vccを入れたら各コレクタ電流と動作点、交流解析の結果等が表示されるモードを実装してほしいです

http://192.168.0.162:8021/index.html

より内容を確認できます。参考にしてください

// --- Calculation Mode ---

let calcMode = 'forward'; // 'forward' or 'reverse'

function switchCalcMode(mode) {
    calcMode = mode;

    document.getElementById('tab-forward').classList.toggle('active', mode === 'forward');
    document.getElementById('tab-reverse').classList.toggle('active', mode === 'reverse');

    document.getElementById('input-forward').classList.toggle('hidden', mode !== 'forward');
    document.getElementById('input-reverse').classList.toggle('hidden', mode !== 'reverse');

    // Number入力は順方向のみ（逆計算ではR2t/R2bを直接入力）
    document.getElementById('input-div-number').classList.toggle('hidden', mode !== 'forward');
}

// --- SPICE Input Mode Toggle ---

const modes = {
    q1: 'text',
    q2: 'text'
};

function toggleMode(id) {
    const textDiv = document.getElementById(id + '-mode-text');
    const manualDiv = document.getElementById(id + '-mode-manual');
    const btn = document.querySelector(`button[onclick="toggleMode('${id}')"]`);

    if (modes[id] === 'text') {
        modes[id] = 'manual';
        textDiv.classList.add('hidden');
        manualDiv.classList.remove('hidden');
        btn.textContent = "SPICEモデル(文字列)入力に戻す";
    } else {
        modes[id] = 'text';
        textDiv.classList.remove('hidden');
        manualDiv.classList.add('hidden');
        btn.textContent = "各パラメータを直接入力する";
    }
}

function getTransistorParams(id) {
    if (modes[id] === 'text') {
        const modelStr = document.getElementById(id + '-model').value;
        return parseSpiceModel(modelStr);
    } else {
        return {
            Is:  parseEngineering(document.getElementById(id + '-is').value),
            Bf:  parseEngineering(document.getElementById(id + '-bf').value),
            Ise: parseEngineering(document.getElementById(id + '-ise').value),
            Ne:  parseEngineering(document.getElementById(id + '-ne').value),
            Nf:  1.0,
            Rb:  0,
            Re:  0,
        };
    }
}

// --- Core Calculation ---

function calculateIb(Ic, p, Vt) {
    const Vbe = Vt * Math.log(Ic / p.Is);
    const term1 = Math.exp(Vbe / Vt);
    const term2 = Math.exp(Vbe / (p.Ne * Vt));

    const Ib_ideal = (p.Is / p.Bf) * (term1 - 1);
    const Ib_leak = p.Ise * (term2 - 1);
    const Ib = Ib_ideal + Ib_leak;
    const beta_eff = Ic / Ib;

    // r_ie = RB + beta_eff * NF * V_T / I_C + (1 + beta_eff) * RE
    const rie = p.Rb + (beta_eff * p.Nf * Vt / Ic) + (1 + beta_eff) * p.Re;

    return {
        Ib: Ib,
        Vbe: Vbe,
        hfe: beta_eff,
        rie: rie
    };
}

// --- R2 Divider Split ---
// Given R2_total, divNumber (N), and Rv2, split R2 into R2t and R2b
// such that (R2t || Rv2) / (R2b + R2t || Rv2) = 1/N
//
// Solving: R2t^2 + (N*Rv2 - R2_total)*R2t - R2_total*Rv2 = 0

function splitR2ForDivider(R2_total, divNumber, Rv2) {
    if (divNumber <= 1) {
        return { R2t: R2_total, R2b: 0 };
    }

    if (Rv2 === Infinity || Rv2 <= 0) {
        // When Rv2 is infinite: R2t || Rv2 = R2t
        // ratio = R2t / R2_total = 1/N => R2t = R2_total / N
        const R2t = R2_total / divNumber;
        return { R2t: R2t, R2b: R2_total - R2t };
    }

    const N = divNumber;
    const a = 1;
    const b = N * Rv2 - R2_total;
    const c = -R2_total * Rv2;
    const discriminant = b * b - 4 * a * c;

    if (discriminant < 0) {
        return { R2t: R2_total, R2b: 0 };
    }

    const R2t = (-b + Math.sqrt(discriminant)) / (2 * a);
    const R2b = R2_total - R2t;

    if (R2t <= 0 || R2b < 0) {
        return { R2t: R2_total, R2b: 0 };
    }

    return { R2t: R2t, R2b: R2b };
}

// --- Newton-Raphson Solver for Reverse Calculation ---
// Given R1, R2, R3, RF, Vcc, find IC1, IC2
//
// Circuit equations:
//   f1(IC1, IC2) = VBE1 + IB1*RF - ((IC2+IB2) - IB1)*R3 = 0
//   f2(IC1, IC2) = VCC - R1*(IC1+IB2) - ((IC2+IB2)-IB1)*R3 - VBE2 = 0

function solveReverse(R1, R2, R3, Rf, Vcc, Vt, q1p, q2p) {
    const MAX_ITER = 200;
    const TOL = 1e-12;
    const h = 1e-10; // step for numerical Jacobian

    // Initial guess
    let ic1 = 50e-6;
    let ic2 = 500e-6;

    function residuals(x1, x2) {
        const Q1 = calculateIb(x1, q1p, Vt);
        const Q2 = calculateIb(x2, q2p, Vt);

        // f1: KVL emitter loop
        const f1 = Q1.Vbe + Q1.Ib * Rf - ((x2 + Q2.Ib) - Q1.Ib) * R3;
        // f2: KVL R1 collector loop
        const f2 = Vcc - R1 * (x1 + Q2.Ib) - ((x2 + Q2.Ib) - Q1.Ib) * R3 - Q2.Vbe;

        return [f1, f2];
    }

    let iterations = 0;
    for (let i = 0; i < MAX_ITER; i++) {
        iterations = i + 1;
        const [f1, f2] = residuals(ic1, ic2);

        if (Math.abs(f1) < TOL && Math.abs(f2) < TOL) break;

        // Numerical Jacobian
        const [f1_x1, f2_x1] = residuals(ic1 + h, ic2);
        const [f1_x2, f2_x2] = residuals(ic1, ic2 + h);

        const J11 = (f1_x1 - f1) / h;
        const J12 = (f1_x2 - f1) / h;
        const J21 = (f2_x1 - f2) / h;
        const J22 = (f2_x2 - f2) / h;

        const det = J11 * J22 - J12 * J21;
        if (Math.abs(det) < 1e-30) {
            throw new Error("ヤコビアンが特異です。収束できません。");
        }

        // Newton step: [dx1, dx2] = J^-1 * [-f1, -f2]
        let dx1 = (-J22 * f1 + J12 * f2) / det;
        let dx2 = (J21 * f1 - J11 * f2) / det;

        // Damping to keep values positive
        let alpha = 1.0;
        while (alpha > 1e-8) {
            const new_ic1 = ic1 + alpha * dx1;
            const new_ic2 = ic2 + alpha * dx2;
            if (new_ic1 > 0 && new_ic2 > 0) {
                ic1 = new_ic1;
                ic2 = new_ic2;
                break;
            }
            alpha *= 0.5;
        }
        if (alpha <= 1e-8) {
            throw new Error("収束できません。抵抗値を確認してください。");
        }
    }

    const [finalF1, finalF2] = residuals(ic1, ic2);
    if (Math.abs(finalF1) > 1e-6 || Math.abs(finalF2) > 1e-6) {
        throw new Error("収束できません (" + iterations + "回反復)。抵抗値を確認してください。");
    }

    return { Ic1: ic1, Ic2: ic2, iterations: iterations };
}

// --- Display Common Results ---

// divider: optional { R2t, R2b } - if provided, use directly (reverse mode)
//          if not provided, use div-number to split R2 (forward mode)
function displayCommonResults(Q1, Q2, R1, R2, Rf, R3, Vcc, Ic1, Ic2, Vt, Ve2, divider) {
    const Rv2 = parseEngineering(document.getElementById('rv2').value);

    // Determine R2t/R2b split
    let R2t, R2b, isDivider;
    if (divider) {
        // Reverse mode: use provided R2t/R2b directly
        R2t = divider.R2t;
        R2b = divider.R2b;
        isDivider = R2b > 0;
    } else {
        // Forward mode: use Number setting to split
        const divNumber = parseFloat(document.getElementById('div-number').value) || 1;
        if (divNumber > 1) {
            const split = splitR2ForDivider(R2, divNumber, Rv2);
            R2t = split.R2t;
            R2b = split.R2b;
            isDivider = true;
        } else {
            R2t = R2;
            R2b = 0;
            isDivider = false;
        }
    }

    const Vc1 = Ve2 + Q2.Vbe;
    const VC2 = Vcc - (R2 * Ic2);

    // Node Voltages
    document.getElementById('val_VB1').innerText = Q1.Vbe.toFixed(3) + " V";
    document.getElementById('val_VC1').innerText = Vc1.toFixed(3) + " V";
    document.getElementById('val_VE2').innerText = Ve2.toFixed(3) + " V";
    document.getElementById('val_VC2').innerText = VC2.toFixed(3) + " V";

    // Operating Point
    document.getElementById('mon_Vbe1').innerText = Q1.Vbe.toFixed(4) + " V";
    document.getElementById('mon_Vbe2').innerText = Q2.Vbe.toFixed(4) + " V";
    document.getElementById('mon_hfe1').innerText = Q1.hfe.toFixed(1);
    document.getElementById('mon_hfe2').innerText = Q2.hfe.toFixed(1);
    document.getElementById('mon_Ib1').innerText  = (Q1.Ib * 1e6).toFixed(2) + " µA";
    document.getElementById('mon_Ib2').innerText  = (Q2.Ib * 1e6).toFixed(2) + " µA";
    document.getElementById('mon_rie1').innerText = formatResistor(Q1.rie);
    document.getElementById('mon_rie2').innerText = formatResistor(Q2.rie);

    // AC Analysis
    const Rv1 = parseEngineering(document.getElementById('rv1').value);

    const R_E = (Rv1 * R3) / (Rv1 + R3);

    // R_C calculation depends on divider mode
    let R_C;
    let dividerAttenuation = 1;
    const labelRC = document.getElementById('label_RC');

    if (isDivider) {
        // AC collector load: R2b + R2t || RV2
        if (Rv2 === Infinity || Rv2 <= 0) {
            R_C = R2b + R2t;
        } else {
            const R2t_par_Rv2 = (R2t * Rv2) / (R2t + Rv2);
            R_C = R2b + R2t_par_Rv2;
        }
        // Compute actual divider ratio from R2t/R2b/Rv2
        let R2t_par_Rv2;
        if (Rv2 === Infinity || Rv2 <= 0) {
            R2t_par_Rv2 = R2t;
        } else {
            R2t_par_Rv2 = (R2t * Rv2) / (R2t + Rv2);
        }
        dividerAttenuation = R2t_par_Rv2 / (R2b + R2t_par_Rv2);
        labelRC.innerHTML = 'R<sub>C</sub> (R2b + R2t∥RV2)';
    } else {
        if (Rv2 === Infinity || Rv2 <= 0) {
            R_C = R2;
        } else {
            R_C = (R2 * Rv2) / (R2 + Rv2);
        }
        labelRC.innerHTML = 'R<sub>C</sub> (R2∥RV2)';
    }

    const rie1 = Q1.rie;
    const rie2 = Q2.rie;
    const hfe1 = Q1.hfe;
    const hfe2 = Q2.hfe;

    // Gain (equation 11) - gain to collector
    const numerator = R_C * hfe2 * (R1 * hfe1 * (Rf + R_E) + R_E * rie1);
    const Delta_denom = (R1 + rie2) * (Rf + R_E) + R_E * Rf * (1 + hfe2);
    const Av_collector = numerator / (rie1 * Delta_denom);

    // Apply divider attenuation for output gain
    const Av = Av_collector * dividerAttenuation;

    // Input impedance (equation 16) - unchanged by output divider
    const N_plus = R1 * hfe1 * (Rf + R_E) + R_E * rie1;
    const Zin_numerator = rie1 * (Rf + R_E) * Delta_denom;
    const Zin_denom = (Rf + R_E + rie1) * Delta_denom + R_E * (1 + hfe2) * N_plus;
    const Zin = Zin_numerator / Zin_denom;

    document.getElementById('val_RE').innerText = formatResistor(R_E);
    document.getElementById('val_RC').innerText = (!isNaN(R_C) && R_C > 0) ? formatResistor(R_C) : "-";
    document.getElementById('val_Av').innerText = Av.toFixed(2) + " (" + (20 * Math.log10(Av)).toFixed(1) + " dB)";
    document.getElementById('val_Zin').innerText = formatResistor(Zin);

    // VR:VC ratio
    const VR = Ic2 * R2;
    const VC_swing = Vcc - VR - Ve2;

    document.getElementById('val_VR').innerText = VR.toFixed(3) + " V";
    document.getElementById('val_VC_swing').innerText = VC_swing.toFixed(3) + " V";

    if (VR > 0 && VC_swing > 0) {
        const gcd_val = gcdRatio(VR, VC_swing);
        document.getElementById('val_VR_VC_ratio').innerText =
            (VR / gcd_val).toFixed(2) + " : " + (VC_swing / gcd_val).toFixed(2) +
            "  (" + VR.toFixed(3) + "V : " + VC_swing.toFixed(3) + "V)";
    } else {
        document.getElementById('val_VR_VC_ratio').innerText = "-";
    }

    // Divider ratio display
    const rowDivRatio = document.getElementById('row-div-ratio');
    if (isDivider) {
        rowDivRatio.classList.remove('hidden');
        document.getElementById('val_div_ratio').innerText =
            (dividerAttenuation).toFixed(4) + "  (1/" + (1 / dividerAttenuation).toFixed(2) + ")";
    } else {
        rowDivRatio.classList.add('hidden');
    }

    // Schematic swap
    const schematicImg = document.getElementById('schematic-img');
    if (isDivider) {
        schematicImg.src = 'FuzzFace_classic_div.svg';
    } else {
        schematicImg.src = 'FuzzFace-Classic.svg';
    }
}

// Simplify ratio for display (normalize to smaller = 1)
function gcdRatio(a, b) {
    return Math.min(a, b);
}

// --- Main Calculate Function ---

function calculate() {
    try {
        document.getElementById('error-box').style.display = 'none';

        const Vcc = parseEngineering(document.getElementById('vcc').value);
        const Rf  = parseEngineering(document.getElementById('rf').value);
        const Vt  = parseEngineering(document.getElementById('vt').value);
        const Rv2 = parseEngineering(document.getElementById('rv2').value);

        const q1Params = getTransistorParams('q1');
        const q2Params = getTransistorParams('q2');

        if (calcMode === 'forward') {
            calculateForward(Vcc, Rf, Vt, Rv2, q1Params, q2Params);
        } else {
            calculateReverse(Vcc, Rf, Vt, Rv2, q1Params, q2Params);
        }

        document.getElementById('results').style.display = 'block';
        document.getElementById('initial-state').style.display = 'none';

    } catch (e) {
        console.error(e);
        const errBox = document.getElementById('error-box');
        errBox.textContent = "エラーが発生しました: " + e.message;
        errBox.style.display = 'block';
    }
}

// --- Forward Calculation ---

function calculateForward(Vcc, Rf, Vt, Rv2, q1Params, q2Params) {
    const Ic1 = parseEngineering(document.getElementById('ic1').value);
    const Ic2 = parseEngineering(document.getElementById('ic2').value);
    const divNumber = parseFloat(document.getElementById('div-number').value) || 1;
    const isDivider = divNumber > 1;

    const Q1 = calculateIb(Ic1, q1Params, Vt);
    const Q2 = calculateIb(Ic2, q2Params, Vt);

    // R3
    const If = Q1.Ib;
    const I3 = (Ic2 + Q2.Ib) - If;
    const R3 = (Q1.Vbe + (If * Rf)) / I3;
    const Ve2 = I3 * R3;

    // R1
    const Vc1 = Ve2 + Q2.Vbe;
    const I1 = Ic1 + Q2.Ib;
    const R1 = (Vcc - Vc1) / I1;

    // R2 (quadratic equation) - calculates R2_total
    let R2_phys;
    if (Rv2 === Infinity || Rv2 <= 0) {
        R2_phys = (Vcc - Ve2) / (2 * Ic2);
    } else {
        const V_avail = Vcc - Ve2;
        const A = Ic2 / Rv2;
        const B = 2 * Ic2 - V_avail / Rv2;
        const C = -V_avail;
        const discriminant = B * B - 4 * A * C;

        if (discriminant < 0) {
            R2_phys = -1;
        } else {
            R2_phys = (-B + Math.sqrt(discriminant)) / (2 * A);
        }
    }

    // Show forward results, hide reverse
    document.getElementById('result-forward').classList.remove('hidden');
    document.getElementById('result-reverse').classList.add('hidden');

    // Display Bias Resistors
    document.getElementById('res_R1').innerText = formatResistor(R1);
    document.getElementById('e24_R1').innerText = findClosestE24(R1);

    if (isDivider && R2_phys > 0) {
        // Divider mode: split R2 into R2t and R2b
        const split = splitR2ForDivider(R2_phys, divNumber, Rv2);

        // Hide single R2 row, show R2t/R2b rows
        document.getElementById('row-R2').classList.add('hidden');
        document.getElementById('row-R2t').classList.remove('hidden');
        document.getElementById('row-R2b').classList.remove('hidden');

        document.getElementById('res_R2t').innerText = formatResistor(split.R2t);
        document.getElementById('e24_R2t').innerText = findClosestE24(split.R2t);
        document.getElementById('res_R2b').innerText = formatResistor(split.R2b);
        document.getElementById('e24_R2b').innerText = findClosestE24(split.R2b);
    } else {
        // Normal mode: show single R2
        document.getElementById('row-R2').classList.remove('hidden');
        document.getElementById('row-R2t').classList.add('hidden');
        document.getElementById('row-R2b').classList.add('hidden');

        if (R2_phys > 0) {
            document.getElementById('res_R2').innerText = formatResistor(R2_phys);
            document.getElementById('e24_R2').innerText = findClosestE24(R2_phys);
        } else {
            document.getElementById('res_R2').innerText = "Impossible (Req > RV2)";
            document.getElementById('e24_R2').innerText = "-";
        }
    }

    document.getElementById('res_R3').innerText = formatResistor(R3);
    document.getElementById('e24_R3').innerText = findClosestE24(R3);

    // Common results
    const R2_display = R2_phys > 0 ? R2_phys : 0;
    displayCommonResults(Q1, Q2, R1, R2_display, Rf, R3, Vcc, Ic1, Ic2, Vt, Ve2);
}

// --- Reverse Calculation ---

function calculateReverse(Vcc, Rf, Vt, Rv2, q1Params, q2Params) {
    const R1 = parseEngineering(document.getElementById('rev-r1').value);
    const R2t = parseEngineering(document.getElementById('rev-r2t').value);
    const R2b = parseEngineering(document.getElementById('rev-r2b').value);
    const R2 = R2t + R2b;
    const R3 = parseEngineering(document.getElementById('rev-r3').value);

    // Solve for IC1, IC2 using Newton-Raphson (R2 = R2t + R2b)
    const result = solveReverse(R1, R2, R3, Rf, Vcc, Vt, q1Params, q2Params);
    const Ic1 = result.Ic1;
    const Ic2 = result.Ic2;

    const Q1 = calculateIb(Ic1, q1Params, Vt);
    const Q2 = calculateIb(Ic2, q2Params, Vt);

    const Ve2 = ((Ic2 + Q2.Ib) - Q1.Ib) * R3;
    const VC2 = Vcc - R2 * Ic2;

    if (VC2 < 0) {
        throw new Error("V_C2 が負 (" + VC2.toFixed(3) + " V) です。R2 (= R2t + R2b = " + formatResistor(R2) + ") が大きすぎます。");
    }

    // Show reverse results, hide forward
    document.getElementById('result-forward').classList.add('hidden');
    document.getElementById('result-reverse').classList.remove('hidden');

    // Display Collector Currents
    document.getElementById('res_IC1').innerText = formatCurrent(Ic1);
    document.getElementById('res_IC2').innerText = formatCurrent(Ic2);

    // Convergence info
    document.getElementById('convergence-info').innerText =
        "Newton-Raphson: " + result.iterations + " iterations";

    // Common results - pass R2t/R2b directly so Number field is ignored
    displayCommonResults(Q1, Q2, R1, R2, Rf, R3, Vcc, Ic1, Ic2, Vt, Ve2, { R2t: R2t, R2b: R2b });
}

// --- Current Formatting ---

function formatCurrent(val) {
    if (val >= 1) return val.toPrecision(4) + " A";
    if (val >= 1e-3) return (val * 1e3).toPrecision(4) + " mA";
    if (val >= 1e-6) return (val * 1e6).toPrecision(4) + " µA";
    if (val >= 1e-9) return (val * 1e9).toPrecision(4) + " nA";
    return val.toExponential(3) + " A";
}

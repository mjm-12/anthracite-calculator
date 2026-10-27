// FFEngine: Fuzz Face (2-transistor NPN) DC operating point and small-signal engine.
// No DOM access. Works as a browser <script> (global FFEngine) and as a Node module.
//
// Circuit (DC):
//   Q1: E = GND, B = B1, C = C1        Q2: B = C1, E = E2, C = C2
//   R1: Vcc-C1   R2: Vcc-C2   R3: E2-GND   RF: E2-B1
//   RBC1: B1-C1 (optional)   RBC2: C1-C2 (optional)   Infinity = absent
//   RV1 (E2-GND) and RV2 (C2-GND, volume pot) are AC-coupled only.
// All quantities are SI units.
//
// DC transistor model: SPICE Gummel-Poon DC core (both junctions, base charge
// qb with VAF/VAR/IKF/IKR). Ohmic RB/RE/RC are not included in DC (they enter
// the AC analysis only, as series resistors).

(function (root) {
    'use strict';

    const IC_OFF = 1e-9;           // I_C below this -> cutoff
    const SAT_IBC_FRAC = 0.001;    // B-C junction current > 0.1 % of IB -> saturation
    const EXP_MAX = 80;            // exponentials are continued linearly above e^80

    // ---------------------------------------------------------------
    // Input validation helpers
    // ---------------------------------------------------------------

    function isNum(v) { return typeof v === 'number' && !Number.isNaN(v); }

    function reqPos(v, label) {
        if (!isNum(v) || !isFinite(v) || v <= 0) {
            throw new Error(label + ' が不正: 正の有限値が必要 (' + v + ')');
        }
        return v;
    }

    function reqPosOrInf(v, label) {
        if (!isNum(v) || v <= 0) {
            throw new Error(label + ' が不正: 正の値か ∞ が必要 (' + v + ')');
        }
        return v;
    }

    function reqNonNeg(v, label) {
        if (!isNum(v) || !isFinite(v) || v < 0) {
            throw new Error(label + ' が不正: 0 以上の有限値が必要 (' + v + ')');
        }
        return v;
    }

    // SPICE convention: VAF/VAR/IKF/IKR = 0 or absent means infinite.
    function reqInfDefault(v, label) {
        if (v === undefined || v === null || v === 0) return Infinity;
        return reqPosOrInf(v, label);
    }

    function optDefault(v, d) { return (v === undefined || v === null) ? d : v; }

    function normalizeModel(p, label) {
        if (!p || typeof p !== 'object') throw new Error(label + ' のモデルパラメータがない');
        return {
            Is: reqPos(p.Is, label + ' IS'),
            Bf: reqPos(p.Bf, label + ' BF'),
            Nf: reqPos(optDefault(p.Nf, 1), label + ' NF'),
            Ise: reqNonNeg(optDefault(p.Ise, 0), label + ' ISE'),
            Ne: reqPos(optDefault(p.Ne, 1.5), label + ' NE'),
            Br: reqPos(optDefault(p.Br, 1), label + ' BR'),
            Nr: reqPos(optDefault(p.Nr, 1), label + ' NR'),
            Isc: reqNonNeg(optDefault(p.Isc, 0), label + ' ISC'),
            Nc: reqPos(optDefault(p.Nc, 2), label + ' NC'),
            Vaf: reqInfDefault(p.Vaf, label + ' VAF'),
            Var: reqInfDefault(p.Var, label + ' VAR'),
            Ikf: reqInfDefault(p.Ikf, label + ' IKF'),
            Ikr: reqInfDefault(p.Ikr, label + ' IKR'),
            Rb: reqNonNeg(optDefault(p.Rb, 0), label + ' RB'),
            Re: reqNonNeg(optDefault(p.Re, 0), label + ' RE'),
            Rc: reqNonNeg(optDefault(p.Rc, 0), label + ' RC'),
            // Capacitances (AC sweep only). SPICE defaults.
            Cje: reqNonNeg(optDefault(p.Cje, 0), label + ' CJE'),
            Vje: reqPos(optDefault(p.Vje, 0.75), label + ' VJE'),
            Mje: reqNonNeg(optDefault(p.Mje, 0.33), label + ' MJE'),
            Cjc: reqNonNeg(optDefault(p.Cjc, 0), label + ' CJC'),
            Vjc: reqPos(optDefault(p.Vjc, 0.75), label + ' VJC'),
            Mjc: reqNonNeg(optDefault(p.Mjc, 0.33), label + ' MJC'),
            Fc: reqNonNeg(optDefault(p.Fc, 0.5), label + ' FC'),
            Tf: reqNonNeg(optDefault(p.Tf, 0), label + ' TF'),
            Tr: reqNonNeg(optDefault(p.Tr, 0), label + ' TR'),
        };
    }

    // Common circuit parameters (shared by both modes).
    // opts.rfIsOutput: R_F is computed (forward mode with V_E ratio); inputs.Rf is ignored.
    function normalizeCommon(inp, opts) {
        if (!inp || typeof inp !== 'object') throw new Error('入力がない');
        return {
            Vcc: reqPos(inp.Vcc, 'V_CC'),
            Rf: (opts && opts.rfIsOutput) ? NaN : reqPos(inp.Rf, 'R_F'),
            Vt: reqPos(inp.Vt, 'V_T'),
            RV1: reqPosOrInf(inp.RV1, 'RV1'),
            RV2: reqPosOrInf(optDefault(inp.RV2, Infinity), 'RV2'),
            Rbc1: reqPosOrInf(optDefault(inp.Rbc1, Infinity), 'R_BC1'),
            Rbc2: reqPosOrInf(optDefault(inp.Rbc2, Infinity), 'R_BC2'),
            gmin: reqNonNeg(optDefault(inp.gmin, 0), 'gmin'),
            q1: normalizeModel(inp.q1, 'Q1'),
            q2: normalizeModel(inp.q2, 'Q2'),
        };
    }

    // ---------------------------------------------------------------
    // Simplified forward-active model: IC -> VBE, IB (used for the
    // initial guess of the reverse solver and kept for reference)
    // VBE = NF VT ln(IC/IS + 1),  IB = IC/BF + ISE (exp(VBE/(NE VT)) - 1)
    // ---------------------------------------------------------------
    function transistorOp(Ic, p, Vt) {
        const nfvt = p.Nf * Vt;
        const Vbe = nfvt * Math.log1p(Ic / p.Is);
        const IbIdeal = Ic / p.Bf;
        const IbLeak = p.Ise > 0 ? p.Ise * Math.expm1(Vbe / (p.Ne * Vt)) : 0;
        const Ib = IbIdeal + IbLeak;
        const hfe = Ic / Ib;
        const rie = p.Rb + hfe * nfvt / Ic + (1 + hfe) * p.Re;
        return { Ic: Ic, Vbe: Vbe, Ib: Ib, hfe: hfe, rie: rie };
    }

    // ---------------------------------------------------------------
    // Gummel-Poon DC core (as in SPICE3 / ngspice bjtload, without RB/RE/RC)
    //   cbe = IS (exp(vbe/(NF VT)) - 1),  cbc = IS (exp(vbc/(NR VT)) - 1)
    //   cben = ISE (exp(vbe/(NE VT)) - 1) + gmin vbe
    //   cbcn = ISC (exp(vbc/(NC VT)) - 1) + gmin vbc
    //   q1 = 1 / (1 - vbc/VAF - vbe/VAR),  q2 = cbe/IKF + cbc/IKR
    //   qb = q1 (1 + sqrt(1 + 4 q2)) / 2
    //   IC = (cbe - cbc)/qb - cbc/BR - cbcn
    //   IB = cbe/BF + cben + cbc/BR + cbcn
    // Returns currents and their partial derivatives wrt vbe, vbc.
    // ---------------------------------------------------------------
    const EXP_MAX_V = Math.exp(EXP_MAX);
    function expLim(x) {
        if (x <= EXP_MAX) { const e = Math.exp(x); return [e, e]; }
        return [EXP_MAX_V * (1 + x - EXP_MAX), EXP_MAX_V];
    }

    function gpDC(vbe, vbc, p, Vt, gmin) {
        gmin = gmin || 0;
        const vtf = p.Nf * Vt, vtr = p.Nr * Vt;
        const [ebe, debe] = expLim(vbe / vtf);
        const [ebc, debc] = expLim(vbc / vtr);
        const cbe = p.Is * (ebe - 1), gbe = p.Is * debe / vtf;
        const cbc = p.Is * (ebc - 1), gbc = p.Is * debc / vtr;
        let cben = gmin * vbe, gben = gmin, cbcn = gmin * vbc, gbcn = gmin;
        if (p.Ise > 0) {
            const vt = p.Ne * Vt, [e, de] = expLim(vbe / vt);
            cben += p.Ise * (e - 1); gben += p.Ise * de / vt;
        }
        if (p.Isc > 0) {
            const vt = p.Nc * Vt, [e, de] = expLim(vbc / vt);
            cbcn += p.Isc * (e - 1); gbcn += p.Isc * de / vt;
        }
        // Base charge
        const iVaf = 1 / p.Vaf, iVar = 1 / p.Var, iIkf = 1 / p.Ikf, iIkr = 1 / p.Ikr;
        const den = 1 - vbc * iVaf - vbe * iVar;
        let q1, dq1be, dq1bc;
        if (den > 1e-3) { q1 = 1 / den; dq1be = q1 * q1 * iVar; dq1bc = q1 * q1 * iVaf; }
        else { q1 = 1e3; dq1be = 0; dq1bc = 0; }
        let qb = q1, dqbbe = dq1be, dqbbc = dq1bc;
        if (iIkf > 0 || iIkr > 0) {
            const q2 = cbe * iIkf + cbc * iIkr;
            const arg = 1 + 4 * q2;
            if (arg > 0) {
                const sq = Math.sqrt(arg);
                qb = q1 * (1 + sq) / 2;
                dqbbe = dq1be * (1 + sq) / 2 + q1 * gbe * iIkf / sq;
                dqbbc = dq1bc * (1 + sq) / 2 + q1 * gbc * iIkr / sq;
            } else {
                qb = q1 / 2; dqbbe = dq1be / 2; dqbbc = dq1bc / 2;
            }
        }
        const it = (cbe - cbc) / qb;
        const ditbe = gbe / qb - it * dqbbe / qb;
        const ditbc = -gbc / qb - it * dqbbc / qb;
        return {
            vbe: vbe, vbc: vbc,
            IbBc: cbc / p.Br + cbcn - gmin * vbc,   // B-C junction diode current (without gmin)
            Ic: it - cbc / p.Br - cbcn,
            Ib: cbe / p.Bf + cben + cbc / p.Br + cbcn,
            gIcBe: ditbe,
            gIcBc: ditbc - gbc / p.Br - gbcn,
            gIbBe: gbe / p.Bf + gben,
            gIbBc: gbc / p.Br + gbcn,
            // For the diffusion capacitances (SPICE3/ngspice, XTF = 0):
            // gTf = d(cbe/qb)/dvbe for vbe > 0, else gbe; gbc0 = d(cbc)/dvbc
            gTf: vbe > 0 ? (gbe - (cbe / qb) * dqbbe) / qb : gbe,
            gbc0: gbc,
        };
    }

    // Depletion capacitance as in SPICE: C0 (1 - v/VJ)^-M below FC VJ,
    // linear extension above it.
    function depletionCap(v, C0, Vj, M, Fc) {
        if (!(C0 > 0)) return 0;
        if (v < Fc * Vj) return C0 * Math.pow(1 - v / Vj, -M);
        const f2 = Math.pow(1 - Fc, 1 + M), f3 = 1 - Fc * (1 + M);
        return C0 / f2 * (f3 + M * v / Vj);
    }

    // Operating region from the model itself.
    //   cutoff     : IC < 1 nA or IB <= 0
    //   saturation : the B-C junction is forward biased and its diode current
    //                (cbc/BR + cbcn, the part of IB injected by the B-C junction)
    //                exceeds 0.1 % of IB
    //   active     : otherwise
    // The BC diode current and its small-signal conductance g_mu scale together,
    // so 0.1 % of IB means g_mu ~ 0.1 % of g_pi: the B-C junction starts to act as an
    // internal collector-base feedback resistor. Soft saturation (e.g. VCE2 = 0.2 V,
    // VBC2 = +0.4 V) is labelled saturation even though IC/IB is still near BF.
    function regionOf(d, Ibc) {
        if (!(d.Ic >= IC_OFF) || !(d.Ib > 0)) return 'cutoff';
        if (d.vbc > 0 && Ibc > SAT_IBC_FRAC * d.Ib) return 'saturation';
        return 'active';
    }

    // Transistor summary. DC: IC, IB, VBE, VBC, hfe = IC/IB (DC current gain).
    // Small signal from the model derivatives at the operating point:
    //   g_pi = dIB/dVbe, g_mu = dIB/dVbc, g_m = dIC/dVbe, g_x = dIC/dVbc,
    //   g_o = -g_x (output conductance), beta_ac = g_m/g_pi,
    //   rie = RB + 1/g_pi (small-signal input resistance, RE not included).
    // Capacitances at the operating point (all on the internal nodes, XCJC = 1):
    //   Cbe = Cje(vbe) + TF gTf,   Cbc = Cjc(vbc) + TR gbc0
    function makeQ(d, p) {
        const gpi = d.gIbBe, gmu = d.gIbBc, gm = d.gIcBe, gx = d.gIcBc;
        const go = -gx;
        const Cje = depletionCap(d.vbe, p.Cje, p.Vje, p.Mje, p.Fc);
        const Cjc = depletionCap(d.vbc, p.Cjc, p.Vjc, p.Mjc, p.Fc);
        const Cdf = p.Tf * d.gTf, Cdr = p.Tr * d.gbc0;
        return {
            Cje: Cje, Cjc: Cjc, Cdiff: Cdf, Cdiffr: Cdr, Cbe: Cje + Cdf, Cbc: Cjc + Cdr,
            Ic: d.Ic, Ib: d.Ib, Vbe: d.vbe, Vbc: d.vbc,
            hfe: d.Ic / d.Ib,
            gpi: gpi, gmu: gmu, gm: gm, gx: gx,
            beta_ac: gm / gpi,
            rie: p.Rb + 1 / gpi,
            ro: go > 0 ? 1 / go : Infinity,
            Rb: p.Rb, Re: p.Re, Rc: p.Rc,
            region: regionOf(d, d.IbBc),
        };
    }

    // KCL residuals at B1, C1, C2, E2 in A: current entering the node minus current leaving it.
    // s = { VB1, VC1, VE2, VC2, q1:{Ic,Ib}, q2:{Ic,Ib} }
    function kclResiduals(s, R) {
        const gbc1 = 1 / R.Rbc1, gbc2 = 1 / R.Rbc2;
        const Ibc1 = (s.VC1 - s.VB1) * gbc1;
        const Ibc2 = (s.VC2 - s.VC1) * gbc2;
        const If = (s.VE2 - s.VB1) / R.Rf;
        return {
            B1: If + Ibc1 - s.q1.Ib,
            C1: (R.Vcc - s.VC1) / R.R1 + Ibc2 - s.q1.Ic - s.q2.Ib - Ibc1,
            C2: (R.Vcc - s.VC2) / R.R2 - s.q2.Ic - Ibc2,
            E2: s.q2.Ic + s.q2.Ib - s.VE2 / R.R3 - If,
        };
    }
    function maxAbsRes(res) {
        return Math.max(Math.abs(res.B1), Math.abs(res.C1), Math.abs(res.C2), Math.abs(res.E2));
    }

    // ---------------------------------------------------------------
    // Brent root finder (bracketing, guaranteed convergence).
    // f(a), f(b) must have opposite signs.
    // ---------------------------------------------------------------
    function brent(f, a, b, fa, fb, tol, maxIter) {
        const EPS = 2.220446049250313e-16;
        let c = b, fc = fb, d = b - a, e = d;
        for (let i = 0; i < maxIter; i++) {
            if ((fb > 0 && fc > 0) || (fb < 0 && fc < 0)) {
                c = a; fc = fa; d = b - a; e = d;
            }
            if (Math.abs(fc) < Math.abs(fb)) {
                a = b; b = c; c = a;
                fa = fb; fb = fc; fc = fa;
            }
            const tol1 = 2 * EPS * Math.abs(b) + 0.5 * tol;
            const xm = 0.5 * (c - b);
            if (Math.abs(xm) <= tol1 || fb === 0) return { x: b, fx: fb, iter: i };
            if (Math.abs(e) >= tol1 && Math.abs(fa) > Math.abs(fb)) {
                const s = fb / fa;
                let p, q;
                if (a === c) {
                    p = 2 * xm * s;
                    q = 1 - s;
                } else {
                    const qq = fa / fc, r = fb / fc;
                    p = s * (2 * xm * qq * (qq - r) - (b - a) * (r - 1));
                    q = (qq - 1) * (r - 1) * (s - 1);
                }
                if (p > 0) q = -q; else p = -p;
                const min1 = 3 * xm * q - Math.abs(tol1 * q);
                const min2 = Math.abs(e * q);
                if (2 * p < Math.min(min1, min2)) { e = d; d = p / q; }
                else { d = xm; e = d; }
            } else {
                d = xm; e = d;
            }
            a = b; fa = fb;
            b += Math.abs(d) > tol1 ? d : (xm > 0 ? tol1 : -tol1);
            fb = f(b);
            if (!isFinite(fb)) throw new Error('数値計算が発散した (Brent 法)');
        }
        return { x: b, fx: fb, iter: maxIter };
    }

    function solveLinear(A, b) {
        const n = b.length;
        const M = A.map((row, i) => row.slice().concat([b[i]]));
        for (let k = 0; k < n; k++) {
            let piv = k;
            for (let i = k + 1; i < n; i++) if (Math.abs(M[i][k]) > Math.abs(M[piv][k])) piv = i;
            if (M[piv][k] === 0 || !isFinite(M[piv][k])) return null;
            [M[k], M[piv]] = [M[piv], M[k]];
            for (let i = k + 1; i < n; i++) {
                const f = M[i][k] / M[k][k];
                if (f === 0) continue;
                for (let j = k; j <= n; j++) M[i][j] -= f * M[k][j];
            }
        }
        const x = new Array(n);
        for (let i = n - 1; i >= 0; i--) {
            let s = M[i][n];
            for (let j = i + 1; j < n; j++) s -= M[i][j] * x[j];
            x[i] = s / M[i][i];
        }
        return x;
    }

    // ---------------------------------------------------------------
    // Validity warnings
    // ---------------------------------------------------------------
    function fmtV(v) { return v.toFixed(3) + ' V'; }
    function fmtI(v) {
        const a = Math.abs(v);
        if (a >= 1e-3) return (v * 1e3).toPrecision(3) + ' mA';
        if (a >= 1e-6) return (v * 1e6).toPrecision(3) + ' µA';
        if (a >= 1e-9) return (v * 1e9).toPrecision(3) + ' nA';
        return v.toExponential(2) + ' A';
    }

    function validityWarnings(r) {
        const w = [];
        let acBad = false;
        for (const [name, q, ic] of [['Q1', r.q1, r.Ic1], ['Q2', r.q2, r.Ic2]]) {
            const k = name.slice(1);
            if (q.region === 'saturation') {
                w.push(name + ' が飽和 (V_CE' + k + ' = ' + fmtV(q.Vce) + ', V_BC' + k + ' = ' + fmtV(q.Vbc) + ')');
                acBad = true;
            } else if (q.region === 'cutoff') {
                w.push(name + ' がカットオフ (I_C' + k + ' = ' + fmtI(ic) + ')');
                acBad = true;
            }
        }
        if (acBad) w.push('能動領域外のトランジスタがある: A_v, Z_in はこの動作点での小信号値');
        if (r.nodes.VE2 < 0) w.push('V_E2 が負 (' + fmtV(r.nodes.VE2) + ')');
        if (r.nodes.VC2 < 0) w.push('V_C2 が負 (' + fmtV(r.nodes.VC2) + ')');
        if (r.branch.I1 < 0) w.push('R1 の電流が逆向き (I_1 = ' + fmtI(r.branch.I1) + ')');
        if (r.branch.I2 < 0) w.push('R2 の電流が逆向き (I_2 = ' + fmtI(r.branch.I2) + ')');
        if (r.branch.I3 < 0) w.push('R3 の電流が逆向き (I_3 = ' + fmtI(r.branch.I3) + ')');
        return w;
    }

    // ---------------------------------------------------------------
    // Forward mode: (IC1, IC2, V_R:V_C[:V_E]) -> R1, R2, R3 [, RF]
    // Without veRatio, RF is an input and VE2 follows from KCL B1; V_R:V_C splits
    // Vcc - VE2. With veRatio > 0 (V_R:V_C:V_E, Ishibashi eq. 4.14), VE2 and VC2
    // are fixed by the ratio and RF becomes the output of KCL B1.
    // With the full model, VBE depends weakly on VBC (Early effect, BC
    // currents), so VBE1, VBE2 and the node voltages are found by a short
    // fixed-point iteration on VBC1, VBC2. Each step solves IC(vbe, vbc) = target
    // for vbe by Brent's method; the rest is closed form.
    // ---------------------------------------------------------------
    function vbeForIc(Ic, vbc, p, Vt, gmin) {
        const f = (v) => gpDC(v, vbc, p, Vt, gmin).Ic - Ic;
        let lo = -1, flo = f(lo);
        while (flo >= 0 && lo > -20) { lo -= 4; flo = f(lo); }
        let hi = 0.5, fhi = f(hi);
        while (fhi <= 0 && hi < 20) { hi += 0.5; fhi = f(hi); }
        if (!(flo < 0 && fhi > 0)) throw new Error('V_BE が求まらない (I_C = ' + fmtI(Ic) + ')');
        return brent(f, lo, hi, flo, fhi, 1e-15, 200).x;
    }

    function solveForward(inp) {
        const veIn = inp.veRatio;
        const useVe = !(veIn === undefined || veIn === null || veIn === '' || veIn === 0 ||
            (typeof veIn === 'number' && Number.isNaN(veIn)));
        const c = normalizeCommon(inp, { rfIsOutput: useVe });
        const Ic1 = reqPos(inp.Ic1, 'I_C1');
        const Ic2 = reqPos(inp.Ic2, 'I_C2');
        const vr = reqPos(inp.vrRatio, 'V_R の比');
        const vc = reqPos(inp.vcRatio, 'V_C の比');
        const ve = useVe ? reqPos(veIn, 'V_E の比') : 0;
        const S = vr + vc + ve;

        const gf = 1 / c.Rf, gbc1 = 1 / c.Rbc1;
        const kc = vc / (vr + vc);
        let vbc1 = -1, vbc2 = -1, it = 0, converged = false;
        let d1, d2, VB1, VE2, VC1, VC2;
        for (; it < 300; it++) {
            const vbe1 = vbeForIc(Ic1, vbc1, c.q1, c.Vt, c.gmin);
            const vbe2 = vbeForIc(Ic2, vbc2, c.q2, c.Vt, c.gmin);
            d1 = gpDC(vbe1, vbc1, c.q1, c.Vt, c.gmin);
            d2 = gpDC(vbe2, vbc2, c.q2, c.Vt, c.gmin);
            VB1 = vbe1;
            if (useVe) {
                VE2 = ve / S * c.Vcc;                  // V_R : V_C : V_E = vr : vc : ve
                VC2 = VE2 + vc / S * c.Vcc;
            } else {
                // KCL B1: (VE2-VB1)gf + (VE2+VBE2-VB1)gbc1 = IB1
                VE2 = (d1.Ib + VB1 * gf + (VB1 - vbe2) * gbc1) / (gf + gbc1);
                VC2 = VE2 + kc * (c.Vcc - VE2);       // V_R : V_C = vr : vc
            }
            VC1 = VE2 + vbe2;
            const n1 = VB1 - VC1, n2 = VC1 - VC2;
            const dv = Math.max(Math.abs(n1 - vbc1), Math.abs(n2 - vbc2));
            if (dv < 1e-13) { converged = true; break; }
            const w = it < 50 ? 1 : 0.5;
            vbc1 += w * (n1 - vbc1); vbc2 += w * (n2 - vbc2);
        }
        if (!converged) {
            throw new Error('順方向計算が収束しない: 指定した I_C と V_R:V_C ではトランジスタが深く飽和する');
        }

        if (!(VE2 > 0)) {
            throw new Error('V_E2 ≤ 0 (' + fmtV(VE2) + '): R_BC1 が小さすぎて R3 を決められない');
        }
        if (!(VE2 < c.Vcc)) {
            throw new Error('V_E2 が V_CC 以上 (' + fmtV(VE2) + '): I_B1 R_F が大きすぎる');
        }
        const Ibc1 = (VC1 - VB1) / c.Rbc1;
        if (useVe) {
            // KCL B1 solved for RF: (VE2-VB1)/RF + Ibc1 = IB1
            if (!(VE2 > VB1)) {
                throw new Error('V_E が小さすぎる: V_E2 (' + fmtV(VE2) + ') < V_BE1 (' + fmtV(VB1) + ')');
            }
            if (!(d1.Ib > Ibc1)) {
                throw new Error('R_F が求まらない: R_BC1 の電流が I_B1 を超える');
            }
            c.Rf = (VE2 - VB1) / (d1.Ib - Ibc1);
            if (!(c.Rf > 0) || !isFinite(c.Rf)) throw new Error('R_F が求まらない (' + c.Rf + ')');
        }
        const If = (VE2 - VB1) / c.Rf;
        const I3 = d2.Ic + d2.Ib - If;
        if (!(I3 > 0)) {
            throw new Error('R3 が負になる: I_C2 が小さすぎる (R_F の電流が Q2 エミッタ電流を上回る)');
        }
        const R3 = VE2 / I3;
        const Ibc2 = (VC2 - VC1) / c.Rbc2;
        const I2 = d2.Ic + Ibc2;
        if (!(I2 > 0)) {
            throw new Error('R2 が負になる: R_BC2 を通じて C2 から流れ出す電流が I_C2 を上回る');
        }
        const R2 = (c.Vcc - VC2) / I2;
        if (!(VC1 < c.Vcc)) {
            throw new Error('R1 が負になる: V_C1 が V_CC 以上 (' + fmtV(VC1) + ')');
        }
        const I1 = d1.Ic + d2.Ib + Ibc1 - Ibc2;
        if (!(I1 > 0)) {
            throw new Error('R1 が負になる: R_BC2 から C1 に流れ込む電流が大きすぎる');
        }
        const R1 = (c.Vcc - VC1) / I1;
        for (const [name, v] of [['R1', R1], ['R2', R2], ['R3', R3]]) {
            if (!(v > 0) || !isFinite(v)) throw new Error(name + ' が求まらない (' + v + ')');
        }

        const warnings = [];
        const state = {
            VB1: VB1, VE2: VE2, VC1: VC1, VC2: VC2,
            q1: makeQ(d1, c.q1), q2: makeQ(d2, c.q2),
        };
        return {
            c: c, R1: R1, R2: R2, R3: R3, RfComputed: useVe,
            Ic1: d1.Ic, Ic2: d2.Ic, state: state,
            solver: null, warnings: warnings,
        };
    }

    // ---------------------------------------------------------------
    // Forward-active reverse solver (simplified model, transistorOp).
    // Used only to build the initial guess for the full-model Newton solver.
    //
    // Inner: for fixed IC1 the E2 KCL residual is strictly increasing in IC2
    // with g(0+) < 0 < g(inf): exactly one root (Brent in ln IC2).
    // Outer: the C1 KCL residual h(IC1) has h(0+) > 0 > h(inf); its sign
    // changes on a log grid are refined with Brent in ln IC1.
    // ---------------------------------------------------------------
    const LN10 = Math.LN10;

    function activeState(Ic1, Ic2, c, R2) {
        const q1 = transistorOp(Ic1, c.q1, c.Vt);
        const q2 = transistorOp(Ic2, c.q2, c.Vt);
        const gf = 1 / c.Rf, gbc1 = 1 / c.Rbc1, gbc2 = 1 / c.Rbc2;
        const VB1 = q1.Vbe;
        const VE2 = (q1.Ib + VB1 * gf + (VB1 - q2.Vbe) * gbc1) / (gf + gbc1);
        const VC1 = VE2 + q2.Vbe;
        let VC2 = NaN;
        if (R2 !== undefined) {
            const g2 = 1 / R2;
            VC2 = (c.Vcc * g2 - Ic2 + VC1 * gbc2) / (g2 + gbc2);
        }
        return { q1: q1, q2: q2, VB1: VB1, VE2: VE2, VC1: VC1, VC2: VC2 };
    }

    function solveReverseActive(c, R1, R2, R3) {
        const gbc1 = 1 / c.Rbc1, gbc2 = 1 / c.Rbc2;
        const LN_IC2_LO = Math.log(1e-40);

        function solveIc2(Ic1) {
            const f = (u) => {
                const Ic2 = Math.exp(u), s = activeState(Ic1, Ic2, c);
                return Ic2 + s.q2.Ib - s.VE2 / R3 - (s.VE2 - s.VB1) / c.Rf;
            };
            const fa = f(LN_IC2_LO);
            if (fa >= 0) return Math.exp(LN_IC2_LO);
            let ub = 0, fb = f(ub);
            while (fb <= 0) {
                ub += 2 * LN10;
                if (ub > 40 * LN10) throw new Error('I_C2 が求まらない (I_C1 = ' + fmtI(Ic1) + ')');
                fb = f(ub);
            }
            if (!isFinite(fa) || !isFinite(fb)) throw new Error('数値計算が発散した (I_C2)');
            return Math.exp(brent(f, LN_IC2_LO, ub, fa, fb, 1e-14, 200).x);
        }
        function stateAt(Ic1) { return activeState(Ic1, solveIc2(Ic1), c, R2); }
        function outerH(u) {
            const s = stateAt(Math.exp(u));
            return (c.Vcc - s.VC1) / R1 + (s.VC2 - s.VC1) * gbc2
                - s.q1.Ic - s.q2.Ib - (s.VC1 - s.VB1) * gbc1;
        }

        const step = LN10 / 16;
        let uLo = Math.log(1e-18), uHi = Math.log(10);
        let hLo = outerH(uLo);
        while (!(hLo > 0) && uLo > Math.log(1e-36)) { uLo -= 3 * LN10; hLo = outerH(uLo); }
        let hHi = outerH(uHi);
        while (!(hHi < 0) && uHi < Math.log(1e6)) { uHi += LN10; hHi = outerH(uHi); }
        const roots = [];
        let uPrev = uLo, hPrev = hLo;
        const n = Math.ceil((uHi - uLo) / step);
        for (let i = 1; i <= n; i++) {
            const u = (i === n) ? uHi : uLo + i * step;
            const h = (i === n) ? hHi : outerH(u);
            if (!isFinite(h)) throw new Error('数値計算が発散した');
            if (h === 0) roots.push(u);
            else if (hPrev !== 0 && (h > 0) !== (hPrev > 0)) roots.push(brent(outerH, uPrev, u, hPrev, h, 1e-15, 300).x);
            uPrev = u; hPrev = h;
        }
        return roots.map(u => stateAt(Math.exp(u)));
    }

    // ---------------------------------------------------------------
    // Reverse mode: full Gummel-Poon DC model, nodal Newton-Raphson.
    // Unknowns x = [VB1, VC1, VE2, VC2]. Junctions:
    //   vbe1 = VB1, vbc1 = VB1 - VC1, vbe2 = VC1 - VE2, vbc2 = VC1 - VC2.
    // Each iteration evaluates the devices at junction voltages limited by
    // SPICE pnjlim and linearizes around them (companion model).
    // Strategy: (A) Newton from the forward-active solution, (B) gmin stepping
    // from the same guess if (A) fails, (C) source stepping from 0 V.
    // (C) always runs as an independent start; distinct converged solutions
    // are counted as roots.
    // ---------------------------------------------------------------
    function pnjlim(vnew, vold, vt, vcrit) {
        if (vnew > vcrit && Math.abs(vnew - vold) > 2 * vt) {
            if (vold > 0) {
                const arg = 1 + (vnew - vold) / vt;
                vnew = arg > 0 ? vold + vt * Math.log(arg) : vcrit;
            } else {
                vnew = vt * Math.log(vnew / vt);
            }
        }
        return vnew;
    }

    function junctions(x) { return [x[0], x[0] - x[1], x[1] - x[2], x[1] - x[3]]; }

    function makeCircuit(c, R1, R2, R3) {
        const vcrit = (n, Is) => { const vt = n * c.Vt; return vt * Math.log(vt / (Math.SQRT2 * Is)); };
        return {
            c: c, R1: R1, R2: R2, R3: R3,
            jvt: [c.q1.Nf * c.Vt, c.q1.Nr * c.Vt, c.q2.Nf * c.Vt, c.q2.Nr * c.Vt],
            jvcrit: [vcrit(c.q1.Nf, c.q1.Is), vcrit(c.q1.Nr, c.q1.Is), vcrit(c.q2.Nf, c.q2.Is), vcrit(c.q2.Nr, c.q2.Is)],
        };
    }

    // One Newton solve at source scale lam with shunt conductance gs on every node.
    function dcNewton(ck, x, jv, lam, gs, maxIter) {
        const c = ck.c;
        const gf = 1 / c.Rf, gb1 = 1 / c.Rbc1, gb2 = 1 / c.Rbc2;
        const g1 = 1 / ck.R1, g2 = 1 / ck.R2, g3 = 1 / ck.R3;
        const V = lam * c.Vcc;
        x = x.slice(); jv = jv.slice();
        for (let it = 1; it <= maxIter; it++) {
            const vd = junctions(x);
            const vl = vd.map((v, i) => pnjlim(v, jv[i], ck.jvt[i], ck.jvcrit[i]));
            let limited = false;
            for (let i = 0; i < 4; i++) if (vl[i] !== vd[i]) limited = true;
            const d1 = gpDC(vl[0], vl[1], c.q1, c.Vt, c.gmin);
            const d2 = gpDC(vl[2], vl[3], c.q2, c.Vt, c.gmin);
            const Ic1 = d1.Ic + d1.gIcBe * (vd[0] - vl[0]) + d1.gIcBc * (vd[1] - vl[1]);
            const Ib1 = d1.Ib + d1.gIbBe * (vd[0] - vl[0]) + d1.gIbBc * (vd[1] - vl[1]);
            const Ic2 = d2.Ic + d2.gIcBe * (vd[2] - vl[2]) + d2.gIcBc * (vd[3] - vl[3]);
            const Ib2 = d2.Ib + d2.gIbBe * (vd[2] - vl[2]) + d2.gIbBc * (vd[3] - vl[3]);
            // d(junction)/dx: vbe1=[1,0,0,0] vbc1=[1,-1,0,0] vbe2=[0,1,-1,0] vbc2=[0,1,0,-1]
            const dIc1 = [d1.gIcBe + d1.gIcBc, -d1.gIcBc, 0, 0];
            const dIb1 = [d1.gIbBe + d1.gIbBc, -d1.gIbBc, 0, 0];
            const dIc2 = [0, d2.gIcBe + d2.gIcBc, -d2.gIcBe, -d2.gIcBc];
            const dIb2 = [0, d2.gIbBe + d2.gIbBc, -d2.gIbBe, -d2.gIbBc];
            const [x0, x1, x2, x3] = x;
            const F = [
                (x0 - x2) * gf + (x0 - x1) * gb1 + Ib1 + gs * x0,
                (x1 - V) * g1 + (x1 - x0) * gb1 + (x1 - x3) * gb2 + Ic1 + Ib2 + gs * x1,
                x2 * g3 + (x2 - x0) * gf - Ic2 - Ib2 + gs * x2,
                (x3 - V) * g2 + (x3 - x1) * gb2 + Ic2 + gs * x3,
            ];
            const J = [
                [gf + gb1 + gs, -gb1, -gf, 0],
                [-gb1, g1 + gb1 + gb2 + gs, 0, -gb2],
                [-gf, 0, g3 + gf + gs, 0],
                [0, -gb2, 0, g2 + gb2 + gs],
            ];
            for (let j = 0; j < 4; j++) {
                J[0][j] += dIb1[j];
                J[1][j] += dIc1[j] + dIb2[j];
                J[2][j] -= dIc2[j] + dIb2[j];
                J[3][j] += dIc2[j];
            }
            if (!F.every(isFinite)) return { ok: false, iter: it };
            const dx = solveLinear(J, F.map(v => -v));
            if (!dx || !dx.every(isFinite)) return { ok: false, iter: it };
            let m = 0, mx = 0;
            for (let i = 0; i < 4; i++) { x[i] += dx[i]; m = Math.max(m, Math.abs(dx[i])); mx = Math.max(mx, Math.abs(x[i])); }
            jv = vl;
            if (!limited && m <= 1e-10 * (1 + mx)) return { ok: true, x: x, jv: jv, iter: it };
        }
        return { ok: false, iter: maxIter };
    }

    function gminStepping(ck, x0, jv0) {
        let iters = 0;
        let gs = 1e-2;
        let r = dcNewton(ck, x0, jv0, 1, gs, 200);
        iters += r.iter;
        if (!r.ok) return { ok: false, iter: iters };
        let x = r.x, jv = r.jv, factor = 10;
        while (gs > 0) {
            const gn = gs / factor < 1e-14 ? 0 : gs / factor;
            r = dcNewton(ck, x, jv, 1, gn, 100);
            iters += r.iter;
            if (r.ok) { x = r.x; jv = r.jv; gs = gn; factor = Math.min(factor * 2, 10); }
            else { factor = Math.sqrt(factor); if (factor < 1.001) return { ok: false, iter: iters }; }
        }
        return { ok: true, x: x, jv: jv, iter: iters };
    }

    function sourceStepping(ck) {
        let x = [0, 0, 0, 0], jv = [0, 0, 0, 0], lam = 0, step = 0.1, iters = 0;
        while (lam < 1) {
            const ln = Math.min(1, lam + step);
            const r = dcNewton(ck, x, jv, ln, 0, 100);
            iters += r.iter;
            if (r.ok) { lam = ln; x = r.x; jv = r.jv; step = Math.min(step * 2, 0.5); }
            else { step /= 4; if (step < 1e-7) return { ok: false, iter: iters }; }
        }
        return { ok: true, x: x, jv: jv, iter: iters };
    }

    function solveReverse(inp) {
        const c = normalizeCommon(inp);
        const R1 = reqPos(inp.R1, 'R1');
        // R2; legacy inputs R2t + R2b are accepted when R2 is absent
        let R2;
        if (inp.R2 === undefined && inp.R2t !== undefined) {
            R2 = reqPos(inp.R2t, 'R2t') + reqNonNeg(optDefault(inp.R2b, 0), 'R2b');
        } else R2 = reqPos(inp.R2, 'R2');
        const R3 = reqPos(inp.R3, 'R3');
        const R = { Vcc: c.Vcc, Rf: c.Rf, Rbc1: c.Rbc1, Rbc2: c.Rbc2, R1: R1, R2: R2, R3: R3 };
        const ck = makeCircuit(c, R1, R2, R3);

        // Initial guess from the forward-active solution
        let guess = null;
        try {
            const act = solveReverseActive(c, R1, R2, R3);
            if (act.length) {
                const s = act[0];
                const clamp = (v) => Math.min(Math.max(v, -1), c.Vcc + 1);
                const VE2 = clamp(s.VE2), VC1 = clamp(s.VC1);
                const VC2 = clamp(Math.max(s.VC2, VE2 + 0.05));
                guess = [clamp(s.VB1), VC1, VE2, VC2];
            }
        } catch (e) { guess = null; }

        const found = [];
        let totalIter = 0;
        if (guess) {
            const jv0 = junctions(guess).map((v, i) => Math.min(v, ck.jvcrit[i]));
            let r = dcNewton(ck, guess, jv0, 1, 0, 200);
            totalIter += r.iter;
            if (r.ok) found.push({ x: r.x, path: 'Newton' });
            else {
                r = gminStepping(ck, guess, jv0);
                totalIter += r.iter;
                if (r.ok) found.push({ x: r.x, path: 'gmin stepping' });
            }
        }
        const rs = sourceStepping(ck);
        totalIter += rs.iter;
        if (rs.ok) found.push({ x: rs.x, path: 'source stepping' });

        if (found.length === 0) {
            throw new Error('動作点が求まらない: Newton 法・gmin ステップ・電源ステップのいずれも収束しない');
        }

        // Evaluate candidates with the exact (unlinearized) model; merge duplicates.
        const cands = [];
        for (const f of found) {
            const [VB1, VC1, VE2, VC2] = f.x;
            const d1 = gpDC(VB1, VB1 - VC1, c.q1, c.Vt, c.gmin);
            const d2 = gpDC(VC1 - VE2, VC1 - VC2, c.q2, c.Vt, c.gmin);
            const state = {
                VB1: VB1, VC1: VC1, VE2: VE2, VC2: VC2,
                q1: makeQ(d1, c.q1), q2: makeQ(d2, c.q2),
            };
            const res = kclResiduals(state, R);
            const dup = cands.find(o => Math.max(...f.x.map((v, i) => Math.abs(v - o.x[i]))) < 1e-6 * (1 + c.Vcc));
            if (dup) { dup.paths.push(f.path); continue; }
            cands.push({ x: f.x, state: state, residuals: res, maxResidual: maxAbsRes(res), paths: [f.path] });
        }

        let best = null;
        for (const cand of cands) {
            const r = assemble({ c: c, R1: R1, R2: R2, R3: R3,
                Ic1: cand.state.q1.Ic, Ic2: cand.state.q2.Ic, state: cand.state }, 'reverse');
            cand.nWarn = validityWarnings(r).length;
            if (!best || cand.nWarn < best.nWarn ||
                (cand.nWarn === best.nWarn && cand.maxResidual < best.maxResidual)) best = cand;
        }

        const s = best.state;
        const scale = Math.max(Math.abs(s.q1.Ic), Math.abs(s.q2.Ic), Math.abs((c.Vcc - s.VC1) / R1),
            Math.abs((c.Vcc - s.VC2) / R2), Math.abs(s.VE2 / R3));
        // relative tolerance with an absolute floor (sub-pA circuits, e.g. Vcc = 50 mV)
        if (!(best.maxResidual <= 1e-6 * scale + 1e-15)) {
            throw new Error('収束しない: KCL 残差 ' + best.maxResidual.toExponential(2) + ' A');
        }
        const warnings = [];
        if (cands.length > 1) {
            warnings.push('動作点が ' + cands.length + ' 個ある (I_C1 = ' +
                cands.map(x => fmtI(x.state.q1.Ic)).join(', ') + '): 警告の少ない解を表示');
        }
        if (best.maxResidual > 1e-9 * scale + 1e-17) {
            warnings.push('KCL 残差がやや大きい (' + best.maxResidual.toExponential(2) + ' A)');
        }

        return {
            c: c, R1: R1, R2: R2, R3: R3,
            Ic1: s.q1.Ic, Ic2: s.q2.Ic, state: s,
            solver: {
                method: 'Gummel-Poon DC, Newton (pnjlim) + gmin/source stepping',
                path: best.paths.join(', '),
                roots: cands.length,
                rootsIc1: cands.map(x => x.state.q1.Ic),
                maxResidual: best.maxResidual,
                residuals: best.residuals,
                iterations: totalIter,
            },
            warnings: warnings,
        };
    }

    // ---------------------------------------------------------------
    // AC small-signal nodal analysis (mid-band, coupling capacitors short,
    // junction capacitances ignored).
    // Each transistor is the linearized Gummel-Poon DC model at the operating
    // point, i.e. a full y-parameter two-port between its intrinsic b, c, e:
    //   ib = g_pi vbe + g_mu vbc,   ic = g_m vbe + g_x vbc   (vbc = vb - vc)
    // This includes r_o (= -1/g_x) and the B-C junction conductance g_mu, so the
    // result stays valid in soft saturation. With ohmic = true (default in
    // evaluate, inputs.acOhmic), RB, RE, RC are added as series resistors through
    // internal nodes. The DC solution does not include them; adding them in AC
    // brought the LTspice comparison from <= 0.42 % to <= 0.12 % (README).
    // vin = 1 V ideal source at B1; output is C2 (top of the volume pot RV2).
    // Av = vC2 / vin. The two inverting stages make Av positive in the classic
    // circuit; Av is the magnitude and AvSigned keeps the sign.
    // ---------------------------------------------------------------
    function parallel(a, b) {
        if (a === Infinity) return b;
        if (b === Infinity) return a;
        return a * b / (a + b);
    }

    // p = { R1, R2, R3, Rf, RV1, RV2, Rbc1, Rbc2, ohmic, Rin,
    //       q1:{gpi,gmu,gm,gx,Rb,Re,Rc}, q2:{...} }
    // Rin (optional): source resistance. AvS = vC2/vs = Av Zin/(Rin + Zin), exact
    // because Zin is the input impedance of the linear network at B1.
    // driveRin = true (tests): instead of driving B1 directly, stamp vs = 1 V
    // behind Rin and solve with B1 unknown; AvSigned/Av/Zin are then not returned.
    function analyzeAC(p) {
        const B1 = 0, C1 = 1, E2 = 2, C2 = 3, GND = -1;
        let nNodes = 4;
        const drive = !!p.driveRin && p.Rin > 0;
        const S = drive ? nNodes++ : -1;    // source node (fixed at 1 V)
        const stamps = [];          // deferred until the node count is known
        const cond = (a, b, R) => { if (R !== Infinity) stamps.push(['g', a, b, 1 / R]); };
        const series = (ext, R) => {
            if (!p.ohmic || !(R > 0)) return ext;
            const n = nNodes++;
            cond(ext, n, R);
            return n;
        };
        function transistor(Bx, Cx, Ex, q) {
            const b = series(Bx, q.Rb), c = series(Cx, q.Rc), e = series(Ex, q.Re);
            const ib = [[b, q.gpi + q.gmu], [e, -q.gpi], [c, -q.gmu]];
            const ic = [[b, q.gm + q.gx], [e, -q.gm], [c, -q.gx]];
            stamps.push(['row', b, ib, 1], ['row', c, ic, 1], ['row', e, ib, -1], ['row', e, ic, -1]);
        }

        const RE = parallel(p.R3, p.RV1);
        cond(C1, GND, p.R1);
        cond(C2, GND, p.R2);
        cond(C2, GND, p.RV2);
        cond(E2, GND, RE);
        cond(E2, B1, p.Rf);
        cond(B1, C1, p.Rbc1);
        cond(C1, C2, p.Rbc2);
        transistor(B1, C1, GND, p.q1);
        transistor(C1, C2, E2, p.q2);
        if (drive) cond(S, B1, p.Rin);

        const N = nNodes;
        const G = [];
        for (let i = 0; i < N; i++) G.push(new Array(N).fill(0));
        const add = (r, col, v) => { if (r >= 0 && col >= 0) G[r][col] += v; };
        for (const st of stamps) {
            if (st[0] === 'g') {
                const [, a, b, g] = st;
                add(a, a, g); add(b, b, g); add(a, b, -g); add(b, a, -g);
            } else {
                const [, row, terms, sign] = st;
                for (const [col, v] of terms) add(row, col, sign * v);
            }
        }

        const F = drive ? S : B1;           // node held at 1 V
        if (drive) {
            const idx = [];
            for (let i = 0; i < N; i++) if (i !== F) idx.push(i);
            const xs = solveLinear(idx.map(i => idx.map(j => G[i][j])), idx.map(i => -G[i][F]));
            if (!xs || !xs.every(isFinite)) throw new Error('小信号回路の行列が特異');
            const vs = [];
            idx.forEach((n, k) => { vs[n] = xs[k]; });
            return { AvS: Math.abs(vs[C2]), AvSSigned: vs[C2], vB1: vs[B1] };
        }
        const idx = [];
        for (let i = 1; i < N; i++) idx.push(i);
        const A = idx.map(i => idx.map(j => G[i][j]));
        const rhs = idx.map(i => -G[i][B1]);
        const x = solveLinear(A, rhs);
        if (!x || !x.every(isFinite)) throw new Error('小信号回路の行列が特異');
        const v = [1].concat(x);
        let iin = 0;
        for (let j = 0; j < N; j++) iin += G[B1][j] * v[j];

        const AvSigned = v[C2];
        const Av = Math.abs(AvSigned);
        const Zin = 1 / iin;
        const out = {
            RE: RE, RC: parallel(p.R2, p.RV2), Av: Av, AvSigned: AvSigned, AvdB: 20 * Math.log10(Av),
            Zin: Zin,
            nodes: { vC1: v[C1], vE2: v[E2], vC2: v[C2] },
        };
        if (p.Rin !== undefined) {
            out.AvSSigned = AvSigned * Zin / (p.Rin + Zin);
            out.AvS = Math.abs(out.AvSSigned);
            out.AvSdB = 20 * Math.log10(out.AvS);
        }
        return out;
    }

    // ---------------------------------------------------------------
    // Frequency response (complex nodal analysis)
    // Network: v_s -- R_in -- C_in -- B1;  E2 -- C_E2 -- RV1 -- GND;
    //          C2 -- C_out -- OUT -- RV2 -- GND (volume full up; output = OUT).
    // Transistors: the same y-parameter model as analyzeAC on internal nodes
    // b', c', e' (series RB/RC/RE when ohmic), plus Cbe (Cje + TF diffusion) between
    // b'-e' and Cbc (Cjc + TR diffusion) between b'-c' (XCJC = 1).
    // Optional external C_BC1 (B1-C1) and C_BC2 (C1-C2), outside RB/RC.
    // Zin is the impedance seen by the source after R_in (looking into C_in).
    // ---------------------------------------------------------------
    function csolve(Ar, Ai, br, bi) {
        const n = br.length;
        const R = Ar.map((row, i) => row.slice().concat([br[i]]));
        const I = Ai.map((row, i) => row.slice().concat([bi[i]]));
        for (let k = 0; k < n; k++) {
            let piv = k, best = -1;
            for (let i = k; i < n; i++) {
                const m = R[i][k] * R[i][k] + I[i][k] * I[i][k];
                if (m > best) { best = m; piv = i; }
            }
            if (!(best > 0) || !isFinite(best)) return null;
            [R[k], R[piv]] = [R[piv], R[k]];
            [I[k], I[piv]] = [I[piv], I[k]];
            const pr = R[k][k], pi = I[k][k], pd = pr * pr + pi * pi;
            for (let i = k + 1; i < n; i++) {
                const ar = R[i][k], ai = I[i][k];
                if (ar === 0 && ai === 0) continue;
                const fr = (ar * pr + ai * pi) / pd, fi = (ai * pr - ar * pi) / pd;   // M[i][k] / M[k][k]
                for (let j = k; j <= n; j++) {
                    const xr = R[k][j], xi = I[k][j];
                    R[i][j] -= fr * xr - fi * xi;
                    I[i][j] -= fr * xi + fi * xr;
                }
            }
        }
        const xr = new Array(n), xi = new Array(n);
        for (let i = n - 1; i >= 0; i--) {
            let sr = R[i][n], si = I[i][n];
            for (let j = i + 1; j < n; j++) {
                sr -= R[i][j] * xr[j] - I[i][j] * xi[j];
                si -= R[i][j] * xi[j] + I[i][j] * xr[j];
            }
            const pr = R[i][i], pi = I[i][i], pd = pr * pr + pi * pi;
            xr[i] = (sr * pr + si * pi) / pd;
            xi[i] = (si * pr - sr * pi) / pd;
        }
        return [xr, xi];
    }

    // Admittance of R in series with C at angular frequency w, as [re, im];
    // null means a short (R = 0 and C = infinity).
    function seriesRC(R, C, w) {
        if (R === Infinity || !(C > 0)) return [0, 0];
        if (C === Infinity) return R > 0 ? [1 / R, 0] : null;
        const zr = R, zi = -1 / (w * C), d = zr * zr + zi * zi;
        return [zr / d, -zi / d];
    }

    // One frequency point. p: { R1, R2, R3, Rf, RV1, RV2, Rbc1, Rbc2, Cbc1, Cbc2,
    //   Rin, Cin, Ce2, Cout, ohmic, q1:{gpi,gmu,gm,gx,Rb,Re,Rc,Cbe,Cbc}, q2 }
    function acPoint(p, f) {
        const w = 2 * Math.PI * f;
        const B1 = 0, C1 = 1, E2 = 2, C2 = 3, GND = -1;
        let nN = 4;
        const st = [];                 // [a, b, gr, gi]: admittance between a and b
        const rows = [];               // [row, col, value]: controlled-source entries (real)
        const y = (a, b, gr, gi) => { if (gr !== 0 || gi !== 0) st.push([a, b, gr, gi]); };
        const res = (a, b, R) => { if (R !== Infinity && R > 0) y(a, b, 1 / R, 0); };
        const cap = (a, b, C) => { if (C > 0 && isFinite(C)) y(a, b, 0, w * C); };
        const series = (ext, R) => {
            if (!p.ohmic || !(R > 0)) return ext;
            const n = nN++;
            res(ext, n, R);
            return n;
        };
        function transistor(Bx, Cx, Ex, q) {
            const b = series(Bx, q.Rb), c = series(Cx, q.Rc), e = series(Ex, q.Re);
            const ib = [[b, q.gpi + q.gmu], [e, -q.gpi], [c, -q.gmu]];
            const ic = [[b, q.gm + q.gx], [e, -q.gm], [c, -q.gx]];
            for (const [col, v] of ib) { rows.push([b, col, v]); rows.push([e, col, -v]); }
            for (const [col, v] of ic) { rows.push([c, col, v]); rows.push([e, col, -v]); }
            cap(b, e, q.Cbe);
            cap(b, c, q.Cbc);
        }

        res(C1, GND, p.R1);
        res(C2, GND, p.R2);
        res(E2, GND, p.R3);
        res(E2, B1, p.Rf);
        res(B1, C1, p.Rbc1);
        res(C1, C2, p.Rbc2);
        cap(B1, C1, p.Cbc1);
        cap(C1, C2, p.Cbc2);
        const ye = seriesRC(p.RV1, p.Ce2, w);
        if (ye === null) throw new Error('RV1 = 0 かつ C_E2 = ∞ は扱えない');
        y(E2, GND, ye[0], ye[1]);
        transistor(B1, C1, GND, p.q1);
        transistor(C1, C2, E2, p.q2);

        // Output: C2 -- Cout -- OUT -- RV2 (if RV2 is open, OUT simply follows C2)
        let OUT;
        if (p.Cout === Infinity) { OUT = C2; res(C2, GND, p.RV2); }
        else { OUT = nN++; cap(C2, OUT, p.Cout); res(OUT, GND, p.RV2); }

        // Source: vs = 1 V behind Rin + Cin, or directly at B1
        const ys = seriesRC(p.Rin, p.Cin, w);
        const direct = (ys === null);
        let S = -1;
        if (!direct) { S = nN++; y(S, B1, ys[0], ys[1]); }

        const N = nN, F = direct ? B1 : S;
        const Gr = [], Gi = [];
        for (let i = 0; i < N; i++) { Gr.push(new Array(N).fill(0)); Gi.push(new Array(N).fill(0)); }
        const add = (r, c, vr, vi) => { if (r >= 0 && c >= 0) { Gr[r][c] += vr; Gi[r][c] += vi; } };
        for (const [a, b, gr, gi] of st) { add(a, a, gr, gi); add(b, b, gr, gi); add(a, b, -gr, -gi); add(b, a, -gr, -gi); }
        for (const [r, c, v] of rows) add(r, c, v, 0);

        const idx = [];
        for (let i = 0; i < N; i++) if (i !== F) idx.push(i);
        const sol = csolve(idx.map(i => idx.map(j => Gr[i][j])), idx.map(i => idx.map(j => Gi[i][j])),
            idx.map(i => -Gr[i][F]), idx.map(i => -Gi[i][F]));
        if (!sol) throw new Error('小信号回路の行列が特異 (f = ' + f + ' Hz)');
        const vr = new Array(N).fill(0), vi = new Array(N).fill(0);
        vr[F] = 1;
        idx.forEach((nd, k) => { vr[nd] = sol[0][k]; vi[nd] = sol[1][k]; });

        let zr, zi;
        if (direct) {
            let ir = 0, ii = 0;
            for (let j = 0; j < N; j++) { ir += Gr[B1][j] * vr[j] - Gi[B1][j] * vi[j]; ii += Gr[B1][j] * vi[j] + Gi[B1][j] * vr[j]; }
            const d = ir * ir + ii * ii;
            zr = ir / d; zi = -ii / d;
        } else {
            // i_in = ys (1 - vB1); Z_B1 = vB1 / i_in; Zin = Z_B1 + 1/(jw Cin)
            const dr = 1 - vr[B1], di = -vi[B1];
            const ir = ys[0] * dr - ys[1] * di, ii = ys[0] * di + ys[1] * dr;
            const d = ir * ir + ii * ii;
            zr = (vr[B1] * ir + vi[B1] * ii) / d;
            zi = (vi[B1] * ir - vr[B1] * ii) / d;
            if (isFinite(p.Cin)) zi -= 1 / (w * p.Cin);
        }
        return { avr: vr[OUT], avi: vi[OUT], zr: zr, zi: zi };
    }

    // -3 dB crossing between sweep points i and i+1, interpolated in log f.
    function crossAt(f, dB, i, level) {
        const t = (level - dB[i]) / (dB[i + 1] - dB[i]);
        return Math.pow(10, Math.log10(f[i]) + t * (Math.log10(f[i + 1]) - Math.log10(f[i])));
    }

    // acSweep(inputs, opts) or acSweep(result, inputs, opts) with result = evaluate(inputs).
    // opts: { fStart = 10, fStop = 1e6, n = 200 } (log-spaced).
    function acSweep(a, b, c) {
        let r, inputs, opts;
        if (a && a.ac && a.q1 && a.q1.ss) { r = a; inputs = b || {}; opts = c || {}; }
        else { inputs = a; opts = b || {}; r = evaluate(inputs); }
        const fStart = optDefault(opts.fStart, 10), fStop = optDefault(opts.fStop, 1e6);
        const n = Math.max(2, Math.round(optDefault(opts.n, 200)));
        reqPos(fStart, 'fStart'); reqPos(fStop, 'fStop');
        if (!(fStop > fStart)) throw new Error('fStop は fStart より大きくする');
        const capIn = (v, d, label) => reqPosOrInf(optDefault(v, d), label);
        const p = {
            R1: r.R1, R2: r.R2, R3: r.R3, Rf: r.Rf,
            RV1: reqPosOrInf(inputs.RV1, 'RV1'), RV2: reqPosOrInf(optDefault(inputs.RV2, Infinity), 'RV2'),
            Rbc1: reqPosOrInf(optDefault(inputs.Rbc1, Infinity), 'R_BC1'),
            Rbc2: reqPosOrInf(optDefault(inputs.Rbc2, Infinity), 'R_BC2'),
            Cbc1: reqNonNeg(optDefault(inputs.Cbc1, 0), 'C_BC1'),
            Cbc2: reqNonNeg(optDefault(inputs.Cbc2, 0), 'C_BC2'),
            Rin: reqNonNeg(optDefault(inputs.Rin, 1000), 'R_in'),
            Cin: capIn(inputs.Cin, 1e-6, 'C_in'),
            Ce2: capIn(inputs.Ce2, 20e-6, 'C_E2'),
            Cout: capIn(inputs.Cout, 10e-9, 'C_out'),
            ohmic: optDefault(inputs.acOhmic, true) !== false,
            q1: r.q1.ss, q2: r.q2.ss,
        };
        const fr = [], mag = [], dB = [], ph = [], zm = [], zp = [];
        const deg = 180 / Math.PI;
        let prevPh = null;
        for (let i = 0; i < n; i++) {
            const f = fStart * Math.pow(fStop / fStart, i / (n - 1));
            const x = acPoint(p, f);
            const m = Math.hypot(x.avr, x.avi);
            let phase = Math.atan2(x.avi, x.avr) * deg;
            if (prevPh !== null) {               // unwrap
                while (phase - prevPh > 180) phase -= 360;
                while (phase - prevPh < -180) phase += 360;
            }
            prevPh = phase;
            fr.push(f); mag.push(m); dB.push(20 * Math.log10(m)); ph.push(phase);
            zm.push(Math.hypot(x.zr, x.zi)); zp.push(Math.atan2(x.zi, x.zr) * deg);
        }
        // Reference: the real mid-band A_vS (coupling capacitors shorted, transistor
        // capacitances ignored) from analyzeAC. The -3 dB points are the outermost
        // crossings of (reference - 3.01 dB): f_L is where the response first rises above
        // the level coming from fStart, f_H where it last falls below it before fStop.
        // Peaks and dips between them (LF peaking in the R_F / C_E2 / C_in loop is
        // physical and appears in LTspice too) do not move f_L or f_H.
        // Recomputed from p (not r.ac) so that AC-only overrides such as RV1 in the
        // acSweep(result, inputs) form get their own reference.
        const refDB = analyzeAC(p).AvSdB;
        let k = 0;
        for (let i = 1; i < n; i++) if (dB[i] > dB[k]) k = i;
        // Phase: shift the unwrapped curve so that it lies in (-180, 180] at the point
        // closest to the reference level inside the band (non-inverting amplifier: ~0 deg).
        let kRef = k, best = Infinity;
        for (let i = 0; i < n; i++) {
            const d = Math.abs(dB[i] - refDB);
            if (d < best) { best = d; kRef = i; }
        }
        const shift = 360 * Math.round(ph[kRef] / 360);
        if (shift !== 0) for (let i = 0; i < n; i++) ph[i] -= shift;

        const level = refDB - 10 * Math.log10(2);
        let iLo = -1, iHi = -1;
        for (let i = 0; i < n; i++) if (dB[i] >= level) { iLo = i; break; }
        for (let i = n - 1; i >= 0; i--) if (dB[i] >= level) { iHi = i; break; }
        const f3dB = { low: null, high: null, lowFlag: null, highFlag: null };
        if (iLo < 0) {
            f3dB.lowFlag = f3dB.highFlag = 'noBand';      // never reaches reference - 3 dB
        } else {
            if (iLo === 0) f3dB.lowFlag = '<fStart';
            else f3dB.low = crossAt(fr, dB, iLo - 1, level);
            if (iHi === n - 1) f3dB.highFlag = '>fStop';
            else f3dB.high = crossAt(fr, dB, iHi, level);
        }
        const peakDB = dB[k] - refDB;
        return {
            f: fr,
            AvS: { mag: mag, dB: dB, phaseDeg: ph },
            Zin: { mag: zm, phaseDeg: zp },
            f3dB: f3dB,
            midbandDB: refDB,
            maxDB: dB[k], fMax: fr[k],
            peak: peakDB > 1 ? { dB: peakDB, f: fr[k] } : null,
            result: r,
        };
    }

    // ---------------------------------------------------------------
    // Assemble the public result object
    // ---------------------------------------------------------------
    function assemble(sol, mode) {
        const c = sol.c, s = sol.state;
        const nodes = { VB1: s.VB1, VC1: s.VC1, VE2: s.VE2, VC2: s.VC2 };
        const branch = {
            If: (s.VE2 - s.VB1) / c.Rf,
            Ibc1: (s.VC1 - s.VB1) / c.Rbc1,
            Ibc2: (s.VC2 - s.VC1) / c.Rbc2,
            I1: (c.Vcc - s.VC1) / sol.R1,
            I2: (c.Vcc - s.VC2) / sol.R2,
            I3: s.VE2 / sol.R3,
        };
        const tq = (q, Vce) => ({
            Vbe: q.Vbe, Vbc: q.Vbc, Vce: Vce, Ib: q.Ib, hfe: q.hfe, rie: q.rie,
            beta_ac: q.beta_ac, gm: q.gm, ro: q.ro, region: q.region,
            caps: { Cje: q.Cje, Cjc: q.Cjc, Cdiff: q.Cdiff, Cdiffr: q.Cdiffr },
            ss: { gpi: q.gpi, gmu: q.gmu, gm: q.gm, gx: q.gx, Rb: q.Rb, Re: q.Re, Rc: q.Rc, Cbe: q.Cbe, Cbc: q.Cbc },
        });
        return {
            mode: mode,
            R1: sol.R1, R2: sol.R2, R3: sol.R3, Rf: c.Rf, RfComputed: !!sol.RfComputed,
            Ic1: sol.Ic1, Ic2: sol.Ic2,
            nodes: nodes,
            q1: tq(s.q1, s.VC1),
            q2: tq(s.q2, s.VC2 - s.VE2),
            branch: branch,
            swing: { VR: c.Vcc - s.VC2, VC: s.VC2 - s.VE2, VE: s.VE2 },
        };
    }

    function evaluate(inputs) {
        if (!inputs || typeof inputs !== 'object') throw new Error('入力がない');
        // Source resistance (AC only; C_in blocks DC). Default 1 kΩ, 0 allowed.
        const Rin = reqNonNeg(optDefault(inputs.Rin, 1000), 'R_in');
        let sol;
        if (inputs.mode === 'forward') sol = solveForward(inputs);
        else if (inputs.mode === 'reverse') sol = solveReverse(inputs);
        else throw new Error('mode が不正: forward か reverse を指定 (' + inputs.mode + ')');

        const r = assemble(sol, inputs.mode);
        const c = sol.c;
        const ac = analyzeAC({
            R1: sol.R1, R2: sol.R2, R3: sol.R3, Rf: c.Rf,
            RV1: c.RV1, RV2: c.RV2, Rbc1: c.Rbc1, Rbc2: c.Rbc2,
            ohmic: optDefault(inputs.acOhmic, true) !== false, q1: r.q1.ss, q2: r.q2.ss,
            Rin: Rin,
        });
        r.ac = {
            RE: ac.RE, RC: ac.RC, Av: ac.Av, AvSigned: ac.AvSigned, AvdB: ac.AvdB,
            Zin: ac.Zin, Rin: Rin, AvS: ac.AvS, AvSSigned: ac.AvSSigned, AvSdB: ac.AvSdB,
            valid: r.q1.region === 'active' && r.q2.region === 'active',
        };
        r.solver = sol.solver;
        r.warnings = sol.warnings.concat(validityWarnings(r));
        return r;
    }

    const FFEngine = {
        evaluate: evaluate,
        transistorOp: transistorOp,
        gpDC: gpDC,
        solveForward: solveForward,
        solveReverse: solveReverse,
        analyzeAC: analyzeAC,
        acSweep: acSweep,
        _acPoint: acPoint,
        kclResiduals: kclResiduals,
        // internal, exported for tests
        _normalizeCommon: normalizeCommon,
        _solveReverseActive: solveReverseActive,
    };

    if (typeof module !== 'undefined' && module.exports) module.exports = FFEngine;
    else root.FFEngine = FFEngine;
})(typeof globalThis !== 'undefined' ? globalThis : this);

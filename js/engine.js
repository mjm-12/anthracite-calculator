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

    // r holds NPN-equivalent values. For PNP (pnp = true) the labels name the mirrored
    // quantities (V_EC = -V_CE, V_CB = -V_BC, same numbers) and node voltages / branch
    // currents are printed with their actual (negated) sign.
    function validityWarnings(r, pnp) {
        const w = [];
        let acBad = false;
        const sg = pnp ? -1 : 1;
        const vce = pnp ? 'V_EC' : 'V_CE', vbc = pnp ? 'V_CB' : 'V_BC';
        for (const [name, q, ic] of [['Q1', r.q1, r.Ic1], ['Q2', r.q2, r.Ic2]]) {
            const k = name.slice(1);
            if (q.region === 'saturation') {
                w.push(name + ' が飽和 (' + vce + k + ' = ' + fmtV(q.Vce) + ', ' + vbc + k + ' = ' + fmtV(q.Vbc) + ')');
                acBad = true;
            } else if (q.region === 'cutoff') {
                w.push(name + ' がカットオフ (I_C' + k + ' = ' + fmtI(ic) + ')');
                acBad = true;
            }
        }
        if (acBad) w.push('能動領域外のトランジスタが含まれる: 音が出ない可能性がある');
        const neg = pnp ? 'が正' : 'が負';
        if (r.nodes.VE2 < 0) w.push('V_E2 ' + neg + ' (' + fmtV(sg * r.nodes.VE2) + ')');
        if (r.nodes.VC2 < 0) w.push('V_C2 ' + neg + ' (' + fmtV(sg * r.nodes.VC2) + ')');
        if (r.branch.I1 < 0) w.push('R1 の電流が逆向き (I_1 = ' + fmtI(sg * r.branch.I1) + ')');
        if (r.branch.I2 < 0) w.push('R2 の電流が逆向き (I_2 = ' + fmtI(sg * r.branch.I2) + ')');
        if (r.branch.I3 < 0) w.push('R3 の電流が逆向き (I_3 = ' + fmtI(sg * r.branch.I3) + ')');
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
        const vr = reqPos(inp.vrRatio, 'V_R2 の比');
        const vc = reqPos(inp.vcRatio, 'V_CE2 の比');
        const ve = useVe ? reqPos(veIn, 'V_E2 の比') : 0;
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
            throw new Error('順方向計算が収束しない: 指定した I_C と V_R2:V_CE2 ではトランジスタが深く飽和してしまう');
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
                throw new Error('V_E2 が小さすぎる: V_E2 (' + fmtV(VE2) + ') < V_BE1 (' + fmtV(VB1) + ')');
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

    // ---------------------------------------------------------------
    // Small-signal network (complex MNA at complex frequency s)
    // Elements: admittances (R, C, L, series R-C), voltage-controlled current
    // sources (the transistors' active part, flagged 'active'), independent
    // voltage sources (extra MNA rows) and current injections.
    // ---------------------------------------------------------------
    const cx = {
        add: (a, b) => [a[0] + b[0], a[1] + b[1]],
        sub: (a, b) => [a[0] - b[0], a[1] - b[1]],
        mul: (a, b) => [a[0] * b[0] - a[1] * b[1], a[0] * b[1] + a[1] * b[0]],
        div: (a, b) => { const d = b[0] * b[0] + b[1] * b[1]; return [(a[0] * b[0] + a[1] * b[1]) / d, (a[1] * b[0] - a[0] * b[1]) / d]; },
        abs: (a) => Math.hypot(a[0], a[1]),
        sqrt: (a) => { const r = Math.hypot(a[0], a[1]), t = Math.atan2(a[1], a[0]) / 2, m = Math.sqrt(r); return [m * Math.cos(t), m * Math.sin(t)]; },
    };

    function newNet() {
        const net = { n: 0, el: [], nv: 0, names: {} };
        net.node = (name) => { if (net.names[name] === undefined) net.names[name] = net.n++; return net.names[name]; };
        net.R = (a, b, R) => { if (R === Infinity) return; if (!(R > 0)) throw new Error('internal: R <= 0'); net.el.push({ t: 'Y', a, b, f: () => [1 / R, 0] }); };
        net.G = (a, b, g) => { if (g !== 0) net.el.push({ t: 'Y', a, b, f: () => [g, 0] }); };
        net.C = (a, b, C) => { if (C > 0 && isFinite(C)) net.el.push({ t: 'Y', a, b, f: (s) => [s[0] * C, s[1] * C] }); };
        net.L = (a, b, L) => net.el.push({ t: 'Y', a, b, f: (s) => cx.div([1, 0], [s[0] * L, s[1] * L]) });
        // R in series with C (no internal node): Y = 1 / (R + 1/(sC))
        net.RC = (a, b, R, C) => {
            if (R === Infinity || !(C > 0)) return;
            if (C === Infinity) { net.R(a, b, R); return; }
            net.el.push({ t: 'Y', a, b, f: (s) => cx.div([1, 0], cx.add([R, 0], cx.div([1, 0], [s[0] * C, s[1] * C]))) });
        };
        net.VCCS = (op, on, cp, cn, g, active) => net.el.push({ t: 'VCCS', op, on, cp, cn, g, active: !!active });
        net.V = (a, b, val) => { const k = net.nv++; net.el.push({ t: 'V', a, b, k, val }); return k; };
        net.I = (a, val) => net.el.push({ t: 'I', a, val });
        return net;
    }

    // Assemble the MNA matrix at s. opt.passive: drop active VCCS (Y0).
    function mnaMatrix(net, s, opt) {
        const N = net.n + net.nv;
        const Ar = [], Ai = [], br = new Array(N).fill(0), bi = new Array(N).fill(0);
        for (let i = 0; i < N; i++) { Ar.push(new Array(N).fill(0)); Ai.push(new Array(N).fill(0)); }
        const add = (r, c, v) => { if (r >= 0 && c >= 0) { Ar[r][c] += v[0]; Ai[r][c] += v[1]; } };
        for (const e of net.el) {
            if (e.t === 'Y') {
                const y = e.f(s), m = [-y[0], -y[1]];
                add(e.a, e.a, y); add(e.b, e.b, y); add(e.a, e.b, m); add(e.b, e.a, m);
            } else if (e.t === 'VCCS') {
                if (opt && opt.passive && e.active) continue;
                const g = [e.g, 0], m = [-e.g, 0];
                add(e.op, e.cp, g); add(e.op, e.cn, m); add(e.on, e.cp, m); add(e.on, e.cn, g);
            } else if (e.t === 'V') {
                const r = net.n + e.k;
                add(e.a, r, [1, 0]); add(e.b, r, [-1, 0]); add(r, e.a, [1, 0]); add(r, e.b, [-1, 0]);
                br[r] += e.val;
            } else if (e.t === 'I') {
                if (e.a >= 0) br[e.a] += e.val;
            }
        }
        return { Ar, Ai, br, bi, N };
    }

    function mnaSolve(net, s, opt) {
        const m = mnaMatrix(net, s, opt);
        const x = csolve(m.Ar, m.Ai, m.br, m.bi);
        if (!x) throw new Error('小信号回路の行列が特異');
        return (i) => [x[0][i], x[1][i]];
    }

    // det of the MNA matrix as { logAbs, arg } (LU with partial pivoting)
    function mnaDet(net, s, opt) {
        const m = mnaMatrix(net, s, opt), n = m.N, R = m.Ar, I = m.Ai;
        let logAbs = 0, arg = 0;
        for (let k = 0; k < n; k++) {
            let piv = k, best = -1;
            for (let i = k; i < n; i++) { const v = R[i][k] * R[i][k] + I[i][k] * I[i][k]; if (v > best) { best = v; piv = i; } }
            if (!(best > 0) || !isFinite(best)) return { logAbs: -Infinity, arg: 0 };
            if (piv !== k) { [R[k], R[piv]] = [R[piv], R[k]]; [I[k], I[piv]] = [I[piv], I[k]]; arg += Math.PI; }
            const pr = R[k][k], pi = I[k][k], pd = pr * pr + pi * pi;
            logAbs += 0.5 * Math.log(pd);
            arg += Math.atan2(pi, pr);
            for (let i = k + 1; i < n; i++) {
                const ar = R[i][k], ai = I[i][k];
                if (ar === 0 && ai === 0) continue;
                const fr = (ar * pr + ai * pi) / pd, fi = (ai * pr - ar * pi) / pd;
                for (let j = k; j < n; j++) {
                    const xr = R[k][j], xi = I[k][j];
                    R[i][j] -= fr * xr - fi * xi;
                    I[i][j] -= fr * xi + fi * xr;
                }
            }
        }
        return { logAbs, arg };
    }

    // ---------------------------------------------------------------
    // Signal source
    // { type: 'r' } (default): v_s -- R_in -- C_in -- B1.
    // { type: 'pickup', DCR, Ls, Cp, Rp, vol:{R, pos, taper}, tone:{R, C, pos, taper},
    //   bleed:{R, C}|null, cable }: guitar pickup and controls, wired as in the
    //   measurement-data pickup simulation templates (st-type / lp_335-type):
    //   emf -- Ls -- DCR -- P;  Cp, Rp: P-GND;  tone: P -- (Pt R_tone + 50m) -- C_tone -- GND;
    //   volume: P -- (R_vol (1-Px) + 50m) -- W -- (Px R_vol + 50m) -- GND;
    //   treble bleed R_b || C_b between P and W;  cable: W -- 0.5 ohm -- K, C_cable K-GND;
    //   K -- C_in -- B1.  Knob pos 0..10; taper 'A' (log): (32^(pos/10) - 1)/31, 'B': pos/10.
    // ---------------------------------------------------------------
    function potFrac(pos, taper) {
        const k = pos / 10;
        if (taper === 'B' || taper === 'b' || taper === 'lin') return k;
        return (Math.pow(32, k) - 1) / 31;
    }

    function normalizeSource(src, Rin) {
        if (!src || src.type === undefined || src.type === 'r') return { type: 'r', Rin: Rin };
        if (src.type !== 'pickup') throw new Error('source.type が不正: r か pickup を指定 (' + src.type + ')');
        const pot = (o, label, needC) => {
            if (!o) return null;
            const pos = optDefault(o.pos, 10);
            if (!isNum(pos) || pos < 0 || pos > 10) throw new Error(label + ' の位置が不正: 0〜10 (' + pos + ')');
            const taper = optDefault(o.taper, 'A');
            if (['A', 'B', 'a', 'b', 'log', 'lin'].indexOf(taper) < 0) throw new Error(label + ' のカーブが不正: A か B (' + taper + ')');
            return { R: reqPos(o.R, label + ' の抵抗'), pos: pos, taper: taper, C: needC ? reqPos(o.C, label + ' の容量') : undefined };
        };
        return {
            type: 'pickup', name: src.name,
            DCR: reqPos(src.DCR, 'PU の DCR'), Ls: reqPos(src.Ls, 'PU の Ls'), Cp: reqNonNeg(optDefault(src.Cp, 0), 'PU の Cp'),
            Rp: reqPosOrInf(optDefault(src.Rp, Infinity), 'PU の Rp'),
            vol: pot(src.vol, 'ボリューム', false),
            tone: pot(src.tone, 'トーン', true),
            bleed: src.bleed ? { R: reqPosOrInf(optDefault(src.bleed.R, Infinity), 'トレブルブリードの抵抗'), C: reqNonNeg(optDefault(src.bleed.C, 0), 'トレブルブリードの容量') } : null,
            cable: reqNonNeg(optDefault(src.cable, 650e-12), 'ケーブル容量'),
            cableR: reqNonNeg(optDefault(src.cableR, 0.5), 'ケーブル抵抗'),
        };
    }

    const PICKUP_PRESETS = {
        texasSpecialNeck: {
            type: 'pickup', name: 'Fender Custom Shop Texas Special Neck (beta)',
            DCR: 5.689e3, Ls: 2.196, Cp: 127.35e-12, Rp: 184.34e3,
            vol: { R: 250e3, pos: 10, taper: 'A' }, tone: { R: 250e3, C: 0.022e-6, pos: 10, taper: 'A' },
            bleed: null, cable: 650e-12,
        },
        gibson57ClassicNeck: {
            type: 'pickup', name: 'Gibson 57 Classic Neck (beta)',
            DCR: 7.218e3, Ls: 4.053, Cp: 187.23e-12, Rp: 299.9e3,
            vol: { R: 500e3, pos: 10, taper: 'A' }, tone: { R: 500e3, C: 0.022e-6, pos: 10, taper: 'A' },
            bleed: { R: 680e3, C: 390e-12 }, cable: 650e-12,
        },
    };

    // Build the small-signal network.
    // cfg.src: source value (1 = drive, 0 = nulled); cfg.zin: omit the source network and
    // inject 1 A at the node in front of C_in; cfg.tian: 'v' | 'i' (break R_F at E2).
    // p: { R1, R2, R3, Rf, RV1, RV2, Rbc1, Rbc2, Cbc1, Cbc2, Cin, Ce2, Cout, ohmic, source, q1, q2 }
    function buildNet(p, cfg) {
        const net = newNet(), GND = -1;
        const B1 = net.node('B1'), C1 = net.node('C1'), E2 = net.node('E2'), C2 = net.node('C2');
        net.R(C1, GND, p.R1);
        net.R(C2, GND, p.R2);
        net.R(E2, GND, p.R3);
        if (p.RV1 === 0 && p.Ce2 === Infinity) throw new Error('RV1 = 0 かつ C_E2 = ∞ は扱えない');
        net.RC(E2, GND, p.RV1, p.Ce2);
        let X = E2;
        if (cfg.tian) {
            X = net.node('X');
            net.tianV = net.V(X, E2, cfg.tian === 'v' ? 1 : 0);   // v_X - v_E2 = 1 (voltage test) or 0
            if (cfg.tian === 'i') net.I(E2, 1);
        }
        net.R(X, B1, p.Rf);
        net.R(B1, C1, p.Rbc1);
        net.R(C1, C2, p.Rbc2);
        net.C(B1, C1, p.Cbc1);
        net.C(C1, C2, p.Cbc2);
        net.C(C2, B1, p.Cstray || 0);
        let k = 0;
        const series = (ext, R) => {
            if (!p.ohmic || !(R > 0)) return ext;
            const n = net.node('int' + (k++));
            net.R(ext, n, R);
            return n;
        };
        // Transistor: passive g_pi (b-e), g_mu (b-c), g_o = -(g_x + g_mu) (c-e), Cbe, Cbc,
        // plus the active VCCS g_me = g_m + g_x + g_mu (c -> e, controlled by v_be).
        const transistor = (Bx, Cx, Ex, q) => {
            const b = series(Bx, q.Rb), c = series(Cx, q.Rc), e = series(Ex, q.Re);
            net.G(b, e, q.gpi);
            net.G(b, c, q.gmu);
            net.G(c, e, -(q.gx + q.gmu));
            net.C(b, e, q.Cbe);
            net.C(b, c, q.Cbc);
            net.VCCS(c, e, b, e, q.gm + q.gx + q.gmu, true);
        };
        transistor(B1, C1, GND, p.q1);
        transistor(C1, C2, E2, p.q2);
        let OUT = C2;
        if (p.Cout !== Infinity) { OUT = net.node('OUT'); net.C(C2, OUT, p.Cout); }
        net.R(OUT, GND, p.RV2);
        net.out = OUT;

        // Input coupling: K -- C_in -- B1 (K = B1 when C_in is a short)
        let K = B1;
        if (p.Cin !== Infinity) { K = net.node('K'); net.C(K, B1, p.Cin); }
        net.k = K;
        if (cfg.zin) { net.I(K, 1); return net; }
        const sv = cfg.src;
        const src = p.source || { type: 'r', Rin: p.Rin };
        if (src.type === 'r') {
            if (src.Rin > 0) { const S = net.node('S'); net.R(S, K, src.Rin); net.V(S, GND, sv); }
            else net.V(K, GND, sv);
        } else {
            const V = net.node('emf'), Lm = net.node('Lm'), P = net.node('P'), W = net.node('W');
            net.V(V, GND, sv);
            net.L(V, Lm, src.Ls);
            net.R(Lm, P, src.DCR);
            net.C(P, GND, src.Cp);
            net.R(P, GND, src.Rp);
            if (src.tone) {
                const T = net.node('T');
                net.R(P, T, potFrac(src.tone.pos, src.tone.taper) * src.tone.R + 0.05);
                net.C(T, GND, src.tone.C);
            }
            if (src.vol) {
                const px = potFrac(src.vol.pos, src.vol.taper);
                net.R(P, W, src.vol.R * (1 - px) + 0.05);
                net.R(W, GND, px * src.vol.R + 0.05);
                if (src.bleed) { net.R(P, W, src.bleed.R); net.C(P, W, src.bleed.C); }
            } else {
                net.R(P, W, 0.05);
            }
            if (src.cableR > 0) { net.R(W, K, src.cableR); net.C(K, GND, src.cable); }
            else { net.R(W, K, 1e-6); net.C(K, GND, src.cable); }
        }
        return net;
    }

    // One frequency point: AvS = v_OUT / v_s, Zin looking into C_in.
    function acPoint(p, f) {
        const s = [0, 2 * Math.PI * f];
        const net = buildNet(p, { src: 1 });
        const a = mnaSolve(net, s)(net.out);
        const nz = buildNet(p, { zin: true });
        const z = mnaSolve(nz, s)(nz.k);
        return { avr: a[0], avi: a[1], zr: z[0], zi: z[1] };
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
        if (!(fStop > fStart)) throw new Error('fStart < fStop を満たさない');
        const p = acParams(r, inputs);
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
        let k = 0;
        for (let i = 1; i < n; i++) if (dB[i] > dB[k]) k = i;
        // With a pickup source there is no flat mid-band (the pickup resonance shapes the
        // response), so the reference is the sweep maximum instead.
        const refSource = p.source.type === 'r' ? 'midband' : 'max';
        const refDB = refSource === 'midband' ? analyzeAC(p).AvSdB : dB[k];
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
            midbandDB: refDB, refSource: refSource,
            maxDB: dB[k], fMax: fr[k],
            peak: peakDB > 1 ? { dB: peakDB, f: fr[k] } : null,
            result: r,
        };
    }

    // AC parameters shared by acSweep and stability
    function acParams(r, inputs) {
        const capIn = (v, d, label) => reqPosOrInf(optDefault(v, d), label);
        const Rin = reqNonNeg(optDefault(inputs.Rin, 1000), 'R_in');
        return {
            R1: r.R1, R2: r.R2, R3: r.R3, Rf: r.Rf,
            RV1: reqPosOrInf(inputs.RV1, 'RV1'),
            RV2: reqPosOrInf(optDefault(inputs.RV2, Infinity), 'RV2'),
            Rbc1: reqPosOrInf(optDefault(inputs.Rbc1, Infinity), 'R_BC1'),
            Rbc2: reqPosOrInf(optDefault(inputs.Rbc2, Infinity), 'R_BC2'),
            Cbc1: reqNonNeg(optDefault(inputs.Cbc1, 0), 'C_BC1'),
            Cbc2: reqNonNeg(optDefault(inputs.Cbc2, 0), 'C_BC2'),
            // Stray capacitance from the output C2 back to the input B1 (positive feedback; AC only)
            Cstray: reqNonNeg(optDefault(inputs.Cstray, 0), 'C_stray'),
            Rin: Rin,
            Cin: capIn(inputs.Cin, 1e-6, 'C_in'),
            Ce2: capIn(inputs.Ce2, 20e-6, 'C_E2'),
            Cout: capIn(inputs.Cout, 10e-9, 'C_out'),
            ohmic: optDefault(inputs.acOhmic, true) !== false,
            source: normalizeSource(inputs.source, Rin),
            q1: r.q1.ss, q2: r.q2.ss,
        };
    }

    // ---------------------------------------------------------------
    // Stability
    // (a) Return difference of all loops: F(s) = det Y(s) / det Y0(s), where Y is the
    //     MNA matrix with the signal source nulled and Y0 the same network with the
    //     transistors' active VCCS (g_me = g_m + g_x + g_mu) removed. Y0 is passive
    //     (R, L, C, g_pi, g_mu, g_o >= 0), so det Y0 has no RHP zeros and the common
    //     factors from the reactive elements cancel. The number of clockwise
    //     encirclements of the origin by F(jw), w from -inf to inf, equals the number
    //     of RHP closed-loop poles. With F(-jw) = conj F(jw):
    //       nRhp = -(arg F(j inf) - arg F(j 0+)) / pi   (unwrapped on w > 0).
    // (b) Loop gain of the R_F loop by Tian's double injection at the E2 side of R_F:
    //       Tv = -v_E2 / v_X (series voltage injection, v_X - v_E2 = v_z)
    //       Ti = i_E2 / i_RF  (1 A shunt injection at the joined node)
    //       T  = (Tv Ti - 1) / (Tv + Ti + 2)
    //     with the negative-feedback sign convention (phase margin = 180 deg + arg T).
    // ---------------------------------------------------------------
    const wrapPi = (x) => { while (x > Math.PI) x -= 2 * Math.PI; while (x <= -Math.PI) x += 2 * Math.PI; return x; };

    function Fratio(p, s) {
        const net = buildNet(p, { src: 0 });
        const a = mnaDet(net, s), b = mnaDet(net, s, { passive: true });
        const la = a.logAbs - b.logAbs, ph = wrapPi(a.arg - b.arg);
        return { la: la, ph: ph, v: [Math.exp(la) * Math.cos(ph), Math.exp(la) * Math.sin(ph)] };
    }

    function tianT(p, s) {
        const nv = buildNet(p, { src: 0, tian: 'v' });
        const xv = mnaSolve(nv, s);
        const Tv = cx.div(xv(nv.names.E2), xv(nv.names.X)); Tv[0] = -Tv[0]; Tv[1] = -Tv[1];
        const ni = buildNet(p, { src: 0, tian: 'i' });
        const j = mnaSolve(ni, s)(ni.n + ni.tianV);        // current X -> E2 through the 0 V source
        const Ti = cx.div([1 + j[0], j[1]], [-j[0], -j[1]]);
        const num = cx.sub(cx.mul(Tv, Ti), [1, 0]);
        const den = cx.add(cx.add(Tv, Ti), [2, 0]);
        return { T: cx.div(num, den), Tv: Tv, Ti: Ti };
    }

    // Phase-unwrapped sweep of a complex function g(f) -> { la, ph } with adaptive
    // refinement where the phase or log-magnitude changes fast. Returns arrays.
    function trackPhase(g, fMin, fMax, n0, opt) {
        const maxPts = (opt && opt.maxPts) || 20000, dphMax = (opt && opt.dph) || 0.3, dlaMax = (opt && opt.dla) || 1.0;
        const grid = [];
        for (let i = 0; i < n0; i++) grid.push(fMin * Math.pow(fMax / fMin, i / (n0 - 1)));
        const out = [{ f: grid[0], val: g(grid[0]) }];
        let count = 1, coarse = false;
        function refine(fa, A, fb, B, depth) {
            const ok = Math.abs(wrapPi(B.ph - A.ph)) <= dphMax && Math.abs(B.la - A.la) <= dlaMax;
            if (ok || depth > 50 || fb / fa < 1 + 1e-10 || count > maxPts) {
                if (!ok) coarse = true;
                out.push({ f: fb, val: B }); count++;
                return;
            }
            const fm = Math.sqrt(fa * fb), M = g(fm);
            refine(fa, A, fm, M, depth + 1);
            refine(fm, M, fb, B, depth + 1);
        }
        for (let i = 1; i < grid.length; i++) {
            const A = out[out.length - 1].val, B = g(grid[i]);
            refine(grid[i - 1], A, grid[i], B, 0);
        }
        const phU = [out[0].val.ph];
        for (let i = 1; i < out.length; i++) phU.push(phU[i - 1] + wrapPi(out[i].val.ph - out[i - 1].val.ph));
        return { pts: out, phU: phU, coarse: coarse };
    }

    // Muller's method for a zero of g(s), complex s.
    function muller(g, x0, x1, x2, maxIt) {
        let f0 = g(x0), f1 = g(x1), f2 = g(x2);
        for (let it = 0; it < (maxIt || 100); it++) {
            const h1 = cx.sub(x1, x0), h2 = cx.sub(x2, x1);
            const d1 = cx.div(cx.sub(f1, f0), h1), d2 = cx.div(cx.sub(f2, f1), h2);
            const a = cx.div(cx.sub(d2, d1), cx.add(h2, h1));
            const b = cx.add(cx.mul(a, h2), d2);
            const disc = cx.sqrt(cx.sub(cx.mul(b, b), cx.mul([4, 0], cx.mul(a, f2))));
            const dp = cx.add(b, disc), dm = cx.sub(b, disc);
            const den = cx.abs(dp) > cx.abs(dm) ? dp : dm;
            if (!(cx.abs(den) > 0)) break;
            const dx = cx.div(cx.mul([-2, 0], f2), den);
            const x3 = cx.add(x2, dx);
            if (!isFinite(x3[0]) || !isFinite(x3[1])) return null;
            x0 = x1; f0 = f1; x1 = x2; f1 = f2; x2 = x3; f2 = g(x3);
            if (cx.abs(dx) < 1e-11 * Math.max(cx.abs(x3), 1)) return x3;
        }
        return null;
    }

    // stability(inputs, opts) or stability(result, inputs, opts)
    // opts: { fMin = 1e-3, fMax = 1e10, n = 300 (Nyquist grid, refined adaptively),
    //         loopFStart = 1, loopFStop = 1e8, nLoop = 400 }
    function stability(a, b, c) {
        let r, inputs, opts;
        if (a && a.ac && a.q1 && a.q1.ss) { r = a; inputs = b || {}; opts = c || {}; }
        else { inputs = a; opts = b || {}; r = evaluate(inputs); }
        const p = acParams(r, inputs);
        const warnings = [];
        const fMin = optDefault(opts.fMin, 1e-3), fMax = optDefault(opts.fMax, 1e10);
        reqPos(fMin, 'fMin'); reqPos(fMax, 'fMax');
        if (!(fMax > fMin)) throw new Error('fMin < fMax を満たさない');

        // (a) Nyquist of F
        const gF = (f) => Fratio(p, [0, 2 * Math.PI * f]);
        const tr = trackPhase(gF, fMin, fMax, Math.max(20, Math.round(optDefault(opts.n, 300))));
        const pts = tr.pts, phU = tr.phU, last = pts.length - 1;
        const dPh = phU[last] - phU[0];
        const nRhpRaw = -dPh / Math.PI;
        const nRhp = Math.round(nRhpRaw);
        if (Math.abs(nRhpRaw - nRhp) > 0.05) warnings.push('F の偏角が端点で実軸に戻っていない (' + nRhpRaw.toFixed(3) + '): 周波数範囲を広げる');
        if (tr.coarse) warnings.push('F が原点のごく近くを通る: 虚軸上の極に近い');
        let iMin = 0;
        for (let i = 1; i <= last; i++) if (pts[i].val.la < pts[iMin].val.la) iMin = i;
        const nyq = { f: [], re: [], im: [] };
        for (const q of pts) { nyq.f.push(q.f); nyq.re.push(q.val.v[0]); nyq.im.push(q.val.v[1]); }

        // Closed-loop poles near the jw axis: Muller from the deepest local minima of |F|
        const minima = [];
        for (let i = 1; i < last; i++) if (pts[i].val.la < pts[i - 1].val.la && pts[i].val.la <= pts[i + 1].val.la) minima.push(i);
        minima.sort((x, y) => pts[x].val.la - pts[y].val.la);
        const gs = (s) => Fratio(p, s).v;
        const poles = [];
        for (const i of minima.slice(0, 4)) {
            const w = 2 * Math.PI * pts[i].f;
            const root = muller(gs, [-0.02 * w, 0.98 * w], [0.01 * w, 1.02 * w], [0, w], 200);
            if (!root || !(root[1] > 0)) continue;
            if (cx.abs(gs(root)) > 1e-6) continue;
            if (poles.some(q => cx.abs(cx.sub(q.s, root)) < 1e-6 * cx.abs(root))) continue;
            const real = Math.abs(root[1]) < 1e-9 * cx.abs(root);
            poles.push({ s: root, f: real ? 0 : root[1] / (2 * Math.PI), sigma: root[0], zeta: real ? Math.sign(-root[0]) : -root[0] / cx.abs(root) });
        }
        poles.sort((x, y) => y.sigma - x.sigma);
        if (nRhp > 0 && !poles.some(q => q.sigma > 0)) warnings.push('右半面の極の位置は求まらなかった (実軸上の極の可能性)');

        // (b) Tian loop gain of the R_F loop
        const lf0 = optDefault(opts.loopFStart, 1), lf1 = optDefault(opts.loopFStop, 1e8), nl = Math.max(2, Math.round(optDefault(opts.nLoop, 400)));
        const lf = [], mag = [], dB = [], phD = [];
        let prev = null;
        for (let i = 0; i < nl; i++) {
            const f = lf0 * Math.pow(lf1 / lf0, i / (nl - 1));
            const T = tianT(p, [0, 2 * Math.PI * f]).T;
            let ph = Math.atan2(T[1], T[0]);
            if (prev !== null) ph = prev + wrapPi(ph - prev);
            prev = ph;
            lf.push(f); mag.push(cx.abs(T)); dB.push(20 * Math.log10(cx.abs(T))); phD.push(ph * 180 / Math.PI);
        }
        const lerpF = (i, t) => Math.pow(10, Math.log10(lf[i]) + t * (Math.log10(lf[i + 1]) - Math.log10(lf[i])));
        const pm = [], gm = [];
        for (let i = 0; i < nl - 1; i++) {
            if ((dB[i] >= 0) !== (dB[i + 1] >= 0)) {
                const t = (0 - dB[i]) / (dB[i + 1] - dB[i]);
                let deg = 180 + phD[i] + t * (phD[i + 1] - phD[i]);
                while (deg > 180) deg -= 360; while (deg <= -180) deg += 360;
                pm.push({ f: lerpF(i, t), deg: deg });
            }
            const ka = Math.floor((phD[i] + 180) / 360), kb = Math.floor((phD[i + 1] + 180) / 360);
            if (ka !== kb) {
                const target = -180 + 360 * Math.max(ka, kb);
                const t = (target - phD[i]) / (phD[i + 1] - phD[i]);
                gm.push({ f: lerpF(i, t), dB: -(dB[i] + t * (dB[i + 1] - dB[i])) });
            }
        }
        return {
            stable: nRhp === 0, nRhp: nRhp,
            minAbsF: Math.exp(pts[iMin].val.la), fMinF: pts[iMin].f,
            F0: pts[0].val.v, Finf: pts[last].val.v,
            // poles: closed-loop poles found from the deepest minima of |F(jw)|, sorted by
            // real part (least stable first); f = Im(s)/2pi [Hz], sigma = Re(s) [1/s],
            // zeta = -Re(s)/|s|. Real poles have f = 0. Not an exhaustive list.
            poles: poles.map(q => ({ f: q.f, sigma: q.sigma, zeta: q.zeta })),
            dominant: poles.length ? { f: poles[0].f, sigma: poles[0].sigma, zeta: poles[0].zeta } : null,
            zetaMin: poles.filter(q => q.f > 0).reduce((m, q) => Math.min(m, q.zeta), Infinity),
            nyquist: nyq,
            loop: { f: lf, T: { mag: mag, dB: dB, phaseDeg: phD }, pm: pm, gm: gm, crossover: pm.length > 0 },
            warnings: warnings,
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

    function evaluateNpn(inputs, pnp) {
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
        r.warnings = sol.warnings.concat(validityWarnings(r, pnp));
        return r;
    }

    // ---------------------------------------------------------------
    // Polarity. inputs.polarity = 'npn' (default) | 'pnp'.
    // PNP is the exact mirror of the NPN circuit: supply -|Vcc|, every node voltage,
    // branch current and junction voltage changes sign. The PNP problem is solved as
    // the mirrored NPN problem (same Gummel-Poon core, V_EB / V_CB in place of
    // V_BE / V_BC) and the result is mirrored back.
    // Vcc is signed: positive for NPN, negative for PNP (a contradicting sign is an
    // error). Ic1/Ic2 (and forward-mode targets), q.Ib, hfe, gm, rie, ro, caps and all
    // resistances stay positive magnitudes. Node voltages, branch currents, swing and
    // q.Vbe / q.Vbc / q.Vce are the actual signed values (negative V_BE for PNP).
    // Small-signal quantities (ac, acSweep) are unchanged by the mirror.
    // A model with type 'NPN'/'PNP' (from parseSpiceModel) must match the polarity.
    // ---------------------------------------------------------------
    function polarityOf(inputs) {
        const pol = inputs.polarity === undefined || inputs.polarity === null ? 'npn' : String(inputs.polarity).toLowerCase();
        if (pol !== 'npn' && pol !== 'pnp') throw new Error('polarity が不正: npn か pnp を指定 (' + inputs.polarity + ')');
        for (const [name, q] of [['Q1', inputs.q1], ['Q2', inputs.q2]]) {
            const t = q && q.type ? String(q.type).toUpperCase() : null;
            if (t && t !== pol.toUpperCase()) throw new Error(name + ' のモデルが ' + pol.toUpperCase() + ' ではない (' + t + ')');
        }
        return pol;
    }

    function mirrorInputs(inputs) {
        const v = inputs.Vcc;
        if (typeof v === 'number' && isFinite(v) && v > 0) {
            throw new Error('PNP では V_CC を負の値で指定する (' + v + ' V)');
        }
        return Object.assign({}, inputs, { Vcc: (typeof v === 'number') ? -v : v, polarity: 'npn' });
    }

    function mirrorResult(r) {
        const neg = (o) => { const x = {}; for (const k of Object.keys(o)) x[k] = -o[k]; return x; };
        const q = (t) => Object.assign({}, t, { Vbe: -t.Vbe, Vbc: -t.Vbc, Vce: -t.Vce });
        return Object.assign({}, r, {
            nodes: neg(r.nodes), branch: neg(r.branch), swing: neg(r.swing),
            q1: q(r.q1), q2: q(r.q2),
        });
    }

    function evaluate(inputs) {
        if (!inputs || typeof inputs !== 'object') throw new Error('入力がない');
        const pol = polarityOf(inputs);
        if (pol === 'npn') {
            const r = evaluateNpn(inputs, false);
            r.polarity = 'npn'; r.Vcc = inputs.Vcc;
            return r;
        }
        let r;
        try {
            r = mirrorResult(evaluateNpn(mirrorInputs(inputs), true));
        } catch (e) {
            // Messages from the mirrored solver quote NPN-equivalent (positive) voltages
            if (e && /V_/.test(e.message) && !/PNP では/.test(e.message)) e.message += ' (PNP: 電圧は絶対値)';
            throw e;
        }
        r.polarity = 'pnp'; r.Vcc = inputs.Vcc;
        return r;
    }

    // Sample models. The NPN text is identical to the default in index.html.
    // 2SA9999-W is a virtual PNP complement of 2SC8888-W: slightly larger IS, lower BF,
    // VAF and fT (TF 520 p vs 445 p), larger junction capacitances.
    const SAMPLE_MODELS = {
        npn: '.MODEL 2SC8888-W NPN(IS=25.44f BF=380.43 NF=1.002 VAF=125.5 IKF=385m ISE=4.88f NE=1.35 BR=8.22 NR=1.01 VAR=18.5 IKR=180m ISC=32.5f NC=1.25 RB=12.8 IRB=50u RBM=2 RE=185m RC=880m CJE=15.32p VJE=0.75 MJE=0.34 CJC=5.12p VJC=0.55 MJC=0.32 FC=0.5 TF=445p XTF=8 VTF=12 ITF=300m TR=65n EG=1.11 XTI=3 XTB=1.5 Vceo=60 Icrating=150m mfg=virtual-transistor)',
        pnp: '.MODEL 2SA9999-W PNP(IS=30.12f BF=318.6 NF=1.003 VAF=94.8 IKF=310m ISE=6.05f NE=1.38 BR=6.92 NR=1.01 VAR=15.2 IKR=150m ISC=28.3f NC=1.24 RB=15.6 IRB=40u RBM=2.5 RE=210m RC=950m CJE=18.1p VJE=0.75 MJE=0.35 CJC=7.88p VJC=0.55 MJC=0.33 FC=0.5 TF=520p XTF=6 VTF=10 ITF=250m TR=80n EG=1.11 XTI=3 XTB=1.5 Vceo=60 Icrating=150m mfg=virtual-transistor)',
    };

    const FFEngine = {
        SAMPLE_MODELS: SAMPLE_MODELS,
        evaluate: evaluate,
        transistorOp: transistorOp,
        gpDC: gpDC,
        solveForward: solveForward,
        solveReverse: solveReverse,
        analyzeAC: analyzeAC,
        acSweep: acSweep,
        stability: stability,
        PICKUP_PRESETS: PICKUP_PRESETS,
        _newNet: newNet, _mnaDet: mnaDet, _mnaSolve: mnaSolve, _buildNet: buildNet, _acParams: acParams,
        _trackPhase: trackPhase, _tianT: tianT, _Fratio: Fratio, _potFrac: potFrac,
        _acPoint: acPoint,
        kclResiduals: kclResiduals,
        // internal, exported for tests
        _normalizeCommon: normalizeCommon,
        _solveReverseActive: solveReverseActive,
    };

    if (typeof module !== 'undefined' && module.exports) module.exports = FFEngine;
    else root.FFEngine = FFEngine;
})(typeof globalThis !== 'undefined' ? globalThis : this);

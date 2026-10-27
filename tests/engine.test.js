// Run: node tests/engine.test.js   (no dependencies)
'use strict';

const E = require('../js/engine.js');

let pass = 0, fail = 0;
function check(cond, msg) {
    if (cond) pass++;
    else { fail++; console.log('  FAIL: ' + msg); }
}
function relErr(a, b) { return Math.abs(a - b) / Math.max(Math.abs(a), Math.abs(b), 1e-300); }
function close(a, b, tol, msg) { check(relErr(a, b) <= tol, msg + ' (' + a + ' vs ' + b + ', rel ' + relErr(a, b).toExponential(2) + ')'); }
function section(name) { console.log('\n== ' + name); }
const JP = /[぀-ヿ一-龯]/;

// Deterministic PRNG (mulberry32)
function rng(seed) {
    return function () {
        seed |= 0; seed = seed + 0x6D2B79F5 | 0;
        let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
        t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
        return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
}
const rand = rng(12345);
const logU = (lo, hi) => Math.exp(Math.log(lo) + rand() * (Math.log(hi) - Math.log(lo)));
const uni = (lo, hi) => lo + rand() * (hi - lo);

// Minimal model (BR = 1, NR = 1, ISC = 0 defaults; no Early / IKF)
const QDEF = { Is: 25.44e-15, Bf: 380.43, Nf: 1.002, Ise: 4.88e-15, Ne: 1.35, Rb: 12.8, Re: 0.185 };
const QNF1 = Object.assign({}, QDEF, { Nf: 1 });
// Full 2SC8888-W DC parameters (index.html default .model)
const QFULL = { Is: 25.44e-15, Bf: 380.43, Nf: 1.002, Vaf: 125.5, Ikf: 0.385, Ise: 4.88e-15, Ne: 1.35,
    Br: 8.22, Nr: 1.01, Var: 18.5, Ikr: 0.18, Isc: 32.5e-15, Nc: 1.25, Rb: 12.8, Re: 0.185, Rc: 0.88 };
// Same without Early / high injection (BC junction parameters only)
const QBC = Object.assign({}, QFULL, { Vaf: 0, Var: 0, Ikf: 0, Ikr: 0 });
const BASE = { Vcc: 9, Rf: 100e3, Vt: 25.85e-3, RV1: 1, RV2: 500e3, Rbc1: Infinity, Rbc2: Infinity, q1: QDEF, q2: QDEF };

// ---------------------------------------------------------------
// Old (working-tree calculator.js) formulas, reimplemented for comparison.
// Old VBE = VT ln(IC/IS) ignores NF; compare with NF = 1 only.
// ---------------------------------------------------------------
function oldIb(Ic, p, Vt) {
    const Vbe = Vt * Math.log(Ic / p.Is);
    const Ib = (p.Is / p.Bf) * (Math.exp(Vbe / Vt) - 1) + p.Ise * (Math.exp(Vbe / (p.Ne * Vt)) - 1);
    const hfe = Ic / Ib;
    return { Vbe: Vbe, Ib: Ib, hfe: hfe, rie: p.Rb + hfe * p.Nf * Vt / Ic + (1 + hfe) * p.Re };
}
function oldForward(Vcc, Rf, Vt, Ic1, Ic2, vr, vc, q1p, q2p) {
    const Q1 = oldIb(Ic1, q1p, Vt), Q2 = oldIb(Ic2, q2p, Vt);
    const If = Q1.Ib;
    const I3 = Ic2 + Q2.Ib - If;
    const R3 = (Q1.Vbe + If * Rf) / I3;
    const Ve2 = I3 * R3;
    const R1 = (Vcc - (Ve2 + Q2.Vbe)) / (Ic1 + Q2.Ib);
    const R2 = vr / (vr + vc) * (Vcc - Ve2) / Ic2;
    return { R1, R2, R3, Ve2, Q1, Q2 };
}
// Old closed-form AC (hybrid model: rie B-E, CCCS hfe ib; no divider)
function oldAC(R1, R2, R3, Rf, Rv1, Rv2, Q1, Q2) {
    const par = (a, b) => (b === Infinity ? a : a === Infinity ? b : a * b / (a + b));
    const RE = par(R3, Rv1), RC = par(R2, Rv2);
    const { rie: rie1, hfe: hfe1 } = Q1, { rie: rie2, hfe: hfe2 } = Q2;
    const D = (R1 + rie2) * (Rf + RE) + RE * Rf * (1 + hfe2);
    const Np = R1 * hfe1 * (Rf + RE) + RE * rie1;
    const Av = RC * hfe2 * Np / (rie1 * D);
    const Zin = rie1 * (Rf + RE) * D / ((Rf + RE + rie1) * D + RE * (1 + hfe2) * Np);
    return { RE, RC, Av, Zin };
}
// hybrid (rie, hfe) -> y-parameter small-signal set for analyzeAC
const hyb = (q) => ({ gpi: 1 / q.rie, gmu: 0, gm: q.hfe / q.rie, gx: 0, Rb: 0, Re: 0, Rc: 0 });

function maxKcl(r, inp) {
    const s = { VB1: r.nodes.VB1, VC1: r.nodes.VC1, VE2: r.nodes.VE2, VC2: r.nodes.VC2,
        q1: { Ic: r.Ic1, Ib: r.q1.Ib }, q2: { Ic: r.Ic2, Ib: r.q2.Ib } };
    const R = { Vcc: inp.Vcc, Rf: r.Rf, Rbc1: inp.Rbc1, Rbc2: inp.Rbc2, R1: r.R1, R2: r.R2, R3: r.R3 };
    const res = E.kclResiduals(s, R);
    const m = Math.max(Math.abs(res.B1), Math.abs(res.C1), Math.abs(res.C2), Math.abs(res.E2));
    const scale = Math.max(Math.abs(r.Ic1), Math.abs(r.Ic2), Math.abs(r.branch.I1), Math.abs(r.branch.I2), Math.abs(r.branch.I3));
    return { m, rel: m / scale, res };
}

// ---------------------------------------------------------------
section('1. Forward with R_BC = ∞ equals the working-tree forward (NF = 1)');
{
    const cases = [
        [9, 100e3, 50e-6, 500e-6, 1, 1],
        [9, 100e3, 100e-6, 1e-3, 1, 2],
        [12, 47e3, 20e-6, 300e-6, 3, 2],
        [18, 220e3, 200e-6, 2e-3, 1, 1],
        [6, 100e3, 30e-6, 800e-6, 2, 1],
    ];
    // Silicon models only: with IS = 1e-6 (Ge-like) the Gummel-Poon leakage terms
    // (-IS/BR in IB, +IS(1+1/BR) in IC) are comparable to IB, so no agreement is expected.
    for (const [Vcc, Rf, Ic1, Ic2, vr, vc] of cases) {
        for (const q of [QNF1, Object.assign({}, QBC, { Nf: 1 })]) {
            const r = E.evaluate(Object.assign({}, BASE, { mode: 'forward', Vcc, Rf, Ic1, Ic2, vrRatio: vr, vcRatio: vc, q1: q, q2: q }));
            const o = oldForward(Vcc, Rf, BASE.Vt, Ic1, Ic2, vr, vc, q, q);
            close(r.R1, o.R1, 1e-6, 'R1');
            close(r.R2, o.R2, 1e-6, 'R2');
            close(r.R3, o.R3, 1e-6, 'R3');
            close(r.swing.VR / r.swing.VC, vr / vc, 1e-12, 'V_R:V_C ratio');
            check(r.Rf === Rf && r.RfComputed === false, 'Rf echoed as input');
        }
    }
    const r = E.evaluate(Object.assign({}, BASE, { mode: 'forward', Ic1: 50e-6, Ic2: 500e-6, vrRatio: 1, vcRatio: 1 }));
    const o = oldForward(9, 100e3, BASE.Vt, 50e-6, 500e-6, 1, 1, QDEF, QDEF);
    console.log('  NF=1.002 default: VBE1 new ' + r.q1.Vbe.toFixed(5) + ' V, old ' + o.Q1.Vbe.toFixed(5) + ' V');
    check(r.q1.Vbe > o.Q1.Vbe, 'NF > 1 raises VBE');
    // veRatio absent / 0 / NaN keeps RF as input
    for (const ve of [undefined, 0, NaN, null, '']) {
        const x = E.evaluate(Object.assign({}, BASE, { mode: 'forward', Ic1: 50e-6, Ic2: 500e-6, vrRatio: 1, vcRatio: 1, veRatio: ve }));
        check(x.RfComputed === false && x.R3 === r.R3, 'veRatio ' + ve + ' -> RF input');
    }
}

// ---------------------------------------------------------------
section('2. Forward V_R:V_C:V_E (R_F computed) -> reverse round trip');
{
    let ok = 0, skipped = 0;
    for (const qm of [QDEF, QFULL]) {
        for (const [Rbc1, Rbc2] of [[Infinity, Infinity], [10e6, Infinity], [Infinity, 470e3], [10e6, 1e6]]) {
            for (const [Ic1, Ic2, vr, vc, ve] of [[100e-6, 600e-6, 1, 1, 0.2], [50e-6, 1e-3, 1.2, 1, 0.5], [200e-6, 500e-6, 1, 1, 1]]) {
                const common = Object.assign({}, BASE, { Rf: NaN, Rbc1, Rbc2, q1: qm, q2: qm });
                let f;
                try {
                    f = E.evaluate(Object.assign({}, common, { mode: 'forward', Ic1, Ic2, vrRatio: vr, vcRatio: vc, veRatio: ve }));
                } catch (e) { skipped++; console.log('  forward impossible: ' + e.message); continue; }
                const S = vr + vc + ve;
                check(f.RfComputed === true && f.Rf > 0, 'RF computed');
                close(f.swing.VE, ve / S * 9, 1e-12, 'V_E');
                close(f.swing.VC, vc / S * 9, 1e-12, 'V_C');
                close(f.swing.VR, vr / S * 9, 1e-12, 'V_R');
                check(maxKcl(f, common).rel < 1e-12, 'forward KCL with computed RF');
                const r = E.evaluate(Object.assign({}, common, { Rf: f.Rf, mode: 'reverse', R1: f.R1, R2: f.R2, R3: f.R3 }));
                close(r.Ic1, Ic1, 1e-6, 've round-trip Ic1');
                close(r.Ic2, Ic2, 1e-6, 've round-trip Ic2');
                for (const k of ['VR', 'VC', 'VE']) close(r.swing[k], f.swing[k], 1e-6, 've round-trip ' + k);
                ok++;
            }
        }
    }
    console.log('  round trips: ' + ok + ' ok, ' + skipped + ' forward-impossible');
    check(ok >= 20, 'enough V_E round trips');
    const bad = [
        [{ veRatio: 0.01 }, /V_E が小さすぎる/],
        [{ veRatio: 0.2, Rbc1: 1e5 }, /R_BC1 の電流が I_B1 を超える/],
        [{ veRatio: -1 }, /V_E の比/],
    ];
    for (const [x, re] of bad) {
        let msg = '';
        try { E.evaluate(Object.assign({}, BASE, { Rf: NaN, mode: 'forward', Ic1: 100e-6, Ic2: 600e-6, vrRatio: 1, vcRatio: 1 }, x)); }
        catch (e) { msg = e.message; }
        check(re.test(msg), 'error for ' + JSON.stringify(x) + ': ' + msg);
        console.log('  ' + msg);
    }
}

// ---------------------------------------------------------------
section('3. Forward -> reverse round trip (with/without R_BC)');
{
    let ok = 0, skipped = 0;
    for (const Rbc1 of [Infinity, 1e6, 300e3]) {
        for (const Rbc2 of [Infinity, 1e6, 100e3]) {
            for (const qm of [QDEF, QFULL]) {
                for (const [Ic1, Ic2, vr, vc] of [[50e-6, 500e-6, 1, 1], [100e-6, 1e-3, 2, 3]]) {
                    const common = Object.assign({}, BASE, { Rbc1, Rbc2, q1: qm, q2: qm });
                    let f;
                    try {
                        f = E.evaluate(Object.assign({}, common, { mode: 'forward', Ic1, Ic2, vrRatio: vr, vcRatio: vc }));
                    } catch (e) { skipped++; continue; }
                    check(maxKcl(f, common).rel < 1e-12, 'forward KCL residual');
                    const r = E.evaluate(Object.assign({}, common, { mode: 'reverse', R1: f.R1, R2: f.R2, R3: f.R3 }));
                    const tag = JSON.stringify({ Rbc1, Rbc2, full: qm === QFULL, Ic1, Ic2 });
                    close(r.Ic1, Ic1, 1e-6, 'round-trip Ic1 ' + tag);
                    close(r.Ic2, Ic2, 1e-6, 'round-trip Ic2 ' + tag);
                    close(r.ac.Av, f.ac.Av, 1e-6, 'round-trip Av');
                    const rk = maxKcl(r, common);
                    check(rk.rel < 1e-9, 'reverse KCL residual ' + rk.rel);
                    check(Math.abs(r.solver.maxResidual - rk.m) <= 1e-12 * rk.m + 1e-20 || rk.m < 1e-15, 'solver.maxResidual consistent');
                    ok++;
                }
            }
        }
    }
    console.log('  round trips: ' + ok + ' ok, ' + skipped + ' forward-impossible');
    // legacy R2t + R2b input
    const a = E.evaluate(Object.assign({}, BASE, { mode: 'reverse', R1: 33e3, R2: 8.2e3, R3: 1.1e3 }));
    const b = E.evaluate(Object.assign({}, BASE, { mode: 'reverse', R1: 33e3, R2t: 6e3, R2b: 2.2e3, R3: 1.1e3 }));
    close(a.Ic2, b.Ic2, 1e-12, 'legacy R2t + R2b = R2');
    check(!('R2t' in a) && !('divRatio' in a.ac), 'divider fields removed');
}

// ---------------------------------------------------------------
section('3b. Full Gummel-Poon reverse vs forward-active solver in the active region');
{
    // With BR = 8.22, NR, ISC, NC (no Early / IKF) the BC-junction terms are negligible
    // when both transistors are active, so the Newton solver must reproduce the
    // forward-active nested-bracketing solver.
    let n = 0;
    for (const [R1, R2, R3] of [[33e3, 8.2e3, 1.1e3], [100e3, 6.8e3, 1e3], [47e3, 6.9e3, 820], [150e3, 10e3, 2.2e3]]) {
        for (const [Rbc1, Rbc2] of [[Infinity, Infinity], [1e6, Infinity], [Infinity, 470e3], [2.2e6, 1e6]]) {
            const inp = Object.assign({}, BASE, { mode: 'reverse', q1: QBC, q2: QBC, R1, R2, R3, Rbc1, Rbc2 });
            const r = E.evaluate(inp);
            if (r.q1.region !== 'active' || r.q2.region !== 'active') continue;
            const act = E._solveReverseActive(E._normalizeCommon(inp), R1, R2, R3);
            check(act.length === 1, 'active solver single root');
            close(r.Ic1, act[0].q1.Ic, 1e-6, 'full vs active Ic1 ' + JSON.stringify({ R1, R3, Rbc1, Rbc2 }));
            close(r.Ic2, act[0].q2.Ic, 1e-6, 'full vs active Ic2');
            close(r.nodes.VC2, act[0].VC2, 1e-6, 'full vs active VC2');
            n++;
        }
    }
    console.log('  compared ' + n + ' active-region circuits');
    check(n >= 12, 'enough active-region comparisons');
    const a = E.evaluate(Object.assign({}, BASE, { mode: 'reverse', q1: QBC, q2: QBC, R1: 33e3, R2: 8.2e3, R3: 1.1e3 }));
    const b = E.evaluate(Object.assign({}, BASE, { mode: 'reverse', q1: QFULL, q2: QFULL, R1: 33e3, R2: 8.2e3, R3: 1.1e3 }));
    console.log('  R3=1.1k: IC2 without VAF/IKF ' + (a.Ic2 * 1e3).toFixed(4) + ' mA, with ' + (b.Ic2 * 1e3).toFixed(4) + ' mA');

    // gpDC analytic derivatives vs central differences
    for (const [vbe, vbc] of [[0.6, -3], [0.65, 0.6], [0.2, -0.1], [0.75, 0.7]]) {
        const d = E.gpDC(vbe, vbc, QFULL, BASE.Vt, 1e-12);
        const h = 1e-7;
        const nb = (dv, dc) => E.gpDC(vbe + dv, vbc + dc, QFULL, BASE.Vt, 1e-12);
        const fd = (k, dv, dc) => (nb(dv, dc)[k] - nb(-dv, -dc)[k]) / (2 * h);
        // absolute floor 1e-15 S: central-difference roundoff on currents of ~1e-7 A
        for (const [g, k, dv, dc] of [[d.gIcBe, 'Ic', h, 0], [d.gIcBc, 'Ic', 0, h], [d.gIbBe, 'Ib', h, 0], [d.gIbBc, 'Ib', 0, h]]) {
            const f = fd(k, dv, dc);
            check(Math.abs(g - f) <= 1e-5 * Math.abs(g) + 1e-15, 'd' + k + ' derivative at ' + vbe + '/' + vbc + ': ' + g + ' vs ' + f);
        }
    }
}

// ---------------------------------------------------------------
section('4. AC nodal analysis vs old closed form (R_BC = ∞, hybrid parameters)');
{
    for (const [R1, R2, R3, Rf, Rv1, Rv2] of [
        [33e3, 8.2e3, 390, 100e3, 1, 500e3],
        [100e3, 8e3, 1e3, 100e3, 1, 500e3],
        [47e3, 10e3, 470, 220e3, 10e3, Infinity],
        [150e3, 8e3, 1.1e3, 100e3, 100, 100e3],
        [22e3, 5.17e3, 100, 47e3, Infinity, 1e6],
    ]) {
        for (const [Ic1, Ic2] of [[50e-6, 500e-6], [200e-6, 2e-3]]) {
            const Q1 = E.transistorOp(Ic1, QDEF, BASE.Vt), Q2 = E.transistorOp(Ic2, QDEF, BASE.Vt);
            const p = { R1, R2, R3, Rf, RV1: Rv1, RV2: Rv2, Rbc1: Infinity, Rbc2: Infinity, q1: hyb(Q1), q2: hyb(Q2) };
            const n = E.analyzeAC(p);
            const n2 = E.analyzeAC(Object.assign({}, p, { ohmic: true }));  // RB = RE = RC = 0 -> identical
            const o = oldAC(R1, R2, R3, Rf, Rv1, Rv2, Q1, Q2);
            close(n.Av, o.Av, 1e-9, 'Av');
            close(n.Zin, o.Zin, 1e-9, 'Zin');
            close(n.RC, o.RC, 1e-12, 'RC');
            close(n.RE, o.RE, 1e-12, 'RE');
            close(n2.Av, n.Av, 1e-12, 'ohmic with zero RB/RE/RC');
            check(n.AvSigned > 0, 'Av sign positive (two inverting stages)');
        }
    }
    const Q1 = E.transistorOp(50e-6, QDEF, BASE.Vt), Q2 = E.transistorOp(500e-6, QDEF, BASE.Vt);
    const p = { R1: 100e3, R2: 8e3, R3: 1e3, Rf: 100e3, RV1: 1, RV2: 500e3, Rbc1: Infinity, Rbc2: Infinity, q1: hyb(Q1), q2: hyb(Q2) };
    const a0 = E.analyzeAC(p), a1 = E.analyzeAC(Object.assign({}, p, { Rbc2: 100e3 })), a2 = E.analyzeAC(Object.assign({}, p, { Rbc1: 1e6 }));
    console.log('  Av: Rbc=∞ ' + a0.Av.toFixed(1) + ', Rbc2=100k ' + a1.Av.toFixed(1) + ', Rbc1=1M ' + a2.Av.toFixed(1));
    check(a1.Av < a0.Av, 'Rbc2 reduces Av');
    check(a2.Zin < a0.Zin, 'Rbc1 (shunt feedback) reduces Zin');
}

// ---------------------------------------------------------------
section('4b. AC vs LTspice .ac (1 kHz, full .model, VT 25.8648 mV)');
{
    // Reference values from two independent LTspice runs (full model incl. RB/RE/RC).
    // The engine DC omits RB/RE/RC; the AC model adds them as series resistors.
    const B = Object.assign({}, BASE, { Vt: 25.8648e-3, q1: QFULL, q2: QFULL });
    const ref = [
        ['b', { R1: 33e3, R2: 8.2e3, R3: 1.1e3 }, 15724, 17.47e3],
        ['c', { R1: 150e3, R2: 8.2e3, R3: 1.1e3 }, 4550, 45.32e3],
        ['d', { R1: 150e3, R2: 8.2e3, R3: 1.1e3, Rbc1: 1e6, Rbc2: 220e3 }, 516.7, 41.83e3],
        ['c, RV1 1k', { R1: 150e3, R2: 8.2e3, R3: 1.1e3, RV1: 1e3 }, 2194, 695],
    ];
    for (const [name, x, av, zin] of ref) {
        for (const oh of [true, false]) {
            const r = E.evaluate(Object.assign({}, B, x, { mode: 'reverse', acOhmic: oh }));
            const eAv = (r.ac.Av / av - 1) * 100, eZ = (r.ac.Zin / zin - 1) * 100;
            console.log('  ' + name + (oh ? ' (RB/RE/RC)' : ' (no ohmic)') + ': Av ' + r.ac.Av.toPrecision(5) + ' (' + eAv.toFixed(2) +
                ' %), Zin ' + r.ac.Zin.toPrecision(4) + ' (' + eZ.toFixed(2) + ' %), ' + r.q1.region + '/' + r.q2.region);
            const tol = oh ? 0.2 : 0.5;
            check(Math.abs(eAv) < tol && Math.abs(eZ) < tol, name + ' within ' + tol + ' % of LTspice');
            check(r.ac.valid, name + ' ac.valid');
        }
    }
    // f6: forward design in soft saturation (reviewer: old engine 8149, LTspice 378)
    const f = E.evaluate(Object.assign({}, B, { mode: 'forward', Ic1: 50e-6, Ic2: 500e-6, vrRatio: 1, vcRatio: 0.02 }));
    console.log('  f6: R1 ' + f.R1.toPrecision(5) + ' R2 ' + f.R2.toPrecision(5) + ' R3 ' + f.R3.toPrecision(5) + ', VCE2 ' + f.q2.Vce.toFixed(3) +
        ' V, VBC2 ' + f.q2.Vbc.toFixed(3) + ' V, region ' + f.q2.region + ', Av ' + f.ac.Av.toFixed(1) + ' (LTspice 378), ro2 ' + f.q2.ro.toPrecision(3));
    close(f.ac.Av, 378, 0.02, 'f6 Av vs LTspice');
    check(f.q2.region === 'saturation' && f.ac.valid === false, 'f6 labelled saturation, ac.valid false');
    check(f.warnings.some(w => /Q2 が飽和/.test(w)), 'f6 saturation warning');
    // display fields
    const r = E.evaluate(Object.assign({}, B, { mode: 'reverse', R1: 33e3, R2: 8.2e3, R3: 1.1e3 }));
    for (const q of [r.q1, r.q2]) {
        check(q.beta_ac > 0 && q.gm > 0 && q.ro > 0 && q.rie > 0 && q.hfe > 0, 'q display fields');
        close(q.rie, QFULL.Rb + 1 / q.ss.gpi, 1e-12, 'rie = RB + 1/gpi');
    }
    const rNoE = E.evaluate(Object.assign({}, B, { q1: QBC, q2: QBC, mode: 'reverse', R1: 33e3, R2: 8.2e3, R3: 1.1e3 }));
    check(rNoE.q2.ro > 1e6, 'ro large without VAF (' + rNoE.q2.ro + ')');
}

// ---------------------------------------------------------------
section('4c. Source resistance R_in: AvS = Av Zin/(Rin + Zin) vs MNA with source behind Rin');
{
    const B = Object.assign({}, BASE, { Vt: 25.8648e-3, q1: QFULL, q2: QFULL });
    let n = 0;
    for (const x of [
        { R1: 33e3, R2: 8.2e3, R3: 1.1e3 },
        { R1: 150e3, R2: 8.2e3, R3: 1.1e3, Rbc1: 1e6, Rbc2: 220e3 },
        { R1: 150e3, R2: 8.2e3, R3: 1.1e3, RV1: 1e3, RV2: Infinity },
        { R1: 33e3, R2: 8.2e3, R3: 390 },                       // saturated Q2
    ]) {
        for (const Rin of [0, 1, 1000, 10e3, 470e3]) {
            for (const oh of [true, false]) {
                const r = E.evaluate(Object.assign({}, B, x, { mode: 'reverse', Rin, acOhmic: oh }));
                check(r.ac.Rin === Rin && isFinite(r.ac.AvS) && isFinite(r.ac.AvSdB), 'AvS fields');
                close(r.ac.AvSdB, 20 * Math.log10(r.ac.AvS), 1e-12, 'AvSdB');
                if (Rin === 0) { close(r.ac.AvS, r.ac.Av, 1e-15, 'Rin = 0 -> AvS = Av'); continue; }
                const m = E.analyzeAC({ R1: r.R1, R2: r.R2, R3: r.R3, Rf: r.Rf, RV1: x.RV1 || B.RV1,
                    RV2: x.RV2 !== undefined ? x.RV2 : B.RV2, Rbc1: x.Rbc1 || Infinity, Rbc2: x.Rbc2 || Infinity,
                    ohmic: oh, q1: r.q1.ss, q2: r.q2.ss, Rin, driveRin: true });
                close(r.ac.AvSSigned, m.AvSSigned, 1e-9, 'AvS formula vs MNA (Rin ' + Rin + ')');
                close(m.vB1, r.ac.Zin / (Rin + r.ac.Zin), 1e-9, 'vB1 = Zin/(Rin+Zin)');
                check(r.ac.Av === E.evaluate(Object.assign({}, B, x, { mode: 'reverse', Rin: 0, acOhmic: oh })).ac.Av, 'Av independent of Rin');
                n++;
            }
        }
    }
    console.log('  MNA comparisons: ' + n);
    const d = E.evaluate(Object.assign({}, B, { mode: 'reverse', R1: 33e3, R2: 8.2e3, R3: 1.1e3 }));
    console.log('  default Rin 1k: Av ' + d.ac.Av.toFixed(0) + ', Zin ' + d.ac.Zin.toFixed(0) + ', AvS ' + d.ac.AvS.toFixed(0) + ' (' + d.ac.AvSdB.toFixed(2) + ' dB)');
    check(d.ac.Rin === 1000, 'Rin default 1 kΩ');
    for (const bad of [Infinity, -1, NaN, '1k']) {
        let msg = '';
        try { E.evaluate(Object.assign({}, B, { mode: 'reverse', R1: 33e3, R2: 8.2e3, R3: 1.1e3, Rin: bad })); } catch (e) { msg = e.message; }
        check(/R_in が不正/.test(msg), 'Rin ' + bad + ' rejected: ' + msg);
    }
}

// ---------------------------------------------------------------
section('5. Default circuit (reverse R1=33k R2=8.2k R3=390)');
{
    const inp = Object.assign({}, BASE, { mode: 'reverse', R1: 33e3, R2: 8.2e3, R3: 390, q1: QFULL, q2: QFULL });
    let r;
    try { r = E.evaluate(inp); } catch (e) { check(false, 'default reverse threw: ' + e.message); }
    if (r) {
        console.log('  IC1 = ' + (r.Ic1 * 1e6).toFixed(2) + ' uA, IC2 = ' + (r.Ic2 * 1e3).toFixed(4) + ' mA, VC2 = ' + r.nodes.VC2.toFixed(3) + ' V, roots ' + r.solver.roots + ', maxRes ' + r.solver.maxResidual.toExponential(2));
        console.log('  VB1 ' + r.nodes.VB1.toFixed(4) + ' VC1 ' + r.nodes.VC1.toFixed(4) + ' VE2 ' + r.nodes.VE2.toFixed(4) + ' V, VCE2 ' + r.q2.Vce.toFixed(4) + ' V, VBC2 ' + r.q2.Vbc.toFixed(4) + ' V, regions ' + r.q1.region + '/' + r.q2.region + ', Av ' + r.ac.Av.toFixed(2) + ', path ' + r.solver.path);
        console.log('  warnings: ' + JSON.stringify(r.warnings));
        check(r.solver.roots >= 1, 'root found');
        check(maxKcl(r, inp).rel < 1e-9, 'default KCL');
        check(r.q2.region === 'saturation', 'Q2 saturated in default circuit');
        check(r.q1.region === 'active', 'Q1 active in default circuit');
        check(r.nodes.VC2 > 0 && r.q2.Vce > 0 && r.q2.Vce < 0.2, 'physical VC2 / VCE2');
        check(r.ac.valid === false, 'ac.valid false when saturated');
    }
    const r2 = E.evaluate(Object.assign({}, inp, { R3: 1.1e3 }));
    console.log('  (R3=1.1k) IC1 = ' + (r2.Ic1 * 1e6).toFixed(2) + ' uA, IC2 = ' + (r2.Ic2 * 1e3).toFixed(4) + ' mA, VC2 = ' + r2.nodes.VC2.toFixed(3) + ' V, Av ' + r2.ac.Av.toFixed(0) + ', warnings ' + JSON.stringify(r2.warnings));
    check(r2.q1.region === 'active' && r2.q2.region === 'active' && r2.ac.valid, 'R3=1.1k both active');
    // very small Vcc (sub-pA currents) must not be rejected as non-converged
    for (const Vcc of [0.05, 0.2, 1]) {
        let msg = null, x;
        try { x = E.evaluate(Object.assign({}, inp, { Vcc })); } catch (e) { msg = e.message; }
        check(msg === null, 'Vcc = ' + Vcc + ' solves (' + msg + ')');
        if (x) console.log('  Vcc ' + Vcc + ' V: IC2 ' + x.Ic2.toExponential(2) + ' A, maxRes ' + x.solver.maxResidual.toExponential(1) + ', ' + x.q1.region + '/' + x.q2.region);
    }
}

// ---------------------------------------------------------------
section('6. Small R_BC (10k-1M) reverse: KCL residuals');
{
    let n = 0, err = 0;
    for (const Rbc1 of [Infinity, 1e6, 100e3, 10e3]) {
        for (const Rbc2 of [Infinity, 1e6, 100e3, 10e3]) {
            for (const [R1, R3] of [[33e3, 1e3], [100e3, 470], [470e3, 2.2e3]]) {
                const inp = Object.assign({}, BASE, { mode: 'reverse', R1, R2: 8.2e3, R3, Rbc1, Rbc2 });
                try {
                    const r = E.evaluate(inp);
                    const k = maxKcl(r, inp);
                    check(k.rel < 1e-9 && isFinite(r.ac.Av) && isFinite(r.ac.Zin), 'residual ' + k.rel + ' ' + JSON.stringify({ Rbc1, Rbc2, R1, R3 }));
                    n++;
                } catch (e) { err++; console.log('  error ' + JSON.stringify({ Rbc1, Rbc2, R1, R3 }) + ': ' + e.message); }
            }
        }
    }
    console.log('  solved ' + n + ', errors ' + err);
    check(err === 0, 'no errors on small-R_BC grid');
}

// ---------------------------------------------------------------
section('7. Input validation');
{
    const bad = [
        { mode: 'reverse', R1: NaN, R2: 8e3, R3: 390 },
        { mode: 'reverse', R1: 33e3, R2: 0, R3: 390 },
        { mode: 'reverse', R1: 33e3, R2t: 8e3, R2b: -1, R3: 390 },
        { mode: 'reverse', R1: 33e3, R3: 390 },
        { mode: 'reverse', R1: 33e3, R2: 8e3, R3: 390, Rf: NaN },
        { mode: 'forward', Ic1: 50e-6, Ic2: 500e-6, vrRatio: 0, vcRatio: 1 },
        { mode: 'forward', Ic1: -1, Ic2: 500e-6, vrRatio: 1, vcRatio: 1 },
        { mode: 'forward', Ic1: 50e-6, Ic2: 1e-9, vrRatio: 1, vcRatio: 1 },      // R3 < 0
        { mode: 'forward', Ic1: 50e-6, Ic2: 500e-6, vrRatio: 1, vcRatio: 1, Rbc2: 1e3 }, // R1 or R2 < 0
        { mode: 'bogus' },
        { mode: 'forward', Ic1: 50e-6, Ic2: 500e-6, vrRatio: 1, vcRatio: 1, RV2: 0 },
    ];
    for (const b of bad) {
        let msg = null;
        try { E.evaluate(Object.assign({}, BASE, b)); } catch (e) { msg = e.message; }
        check(msg !== null && JP.test(msg), 'expected Japanese error for ' + JSON.stringify(b));
        if (msg) console.log('  ' + msg);
    }
}

// ---------------------------------------------------------------
section('8. Robustness sweep (random reverse inputs)');
{
    const N = 5000;
    let solved = 0, cleanErr = 0, badErr = 0, nanOut = 0, highRes = 0, multi = 0, warned = 0, maxRel = 0;
    const regions = {}, paths = {}, errKinds = {};
    const t0 = Date.now();
    for (let i = 0; i < N; i++) {
        const ge = rand() < 0.4;
        const mk = () => ({
            Is: ge ? logU(1e-9, 1e-6) : logU(1e-16, 1e-13),
            Bf: uni(50, 300),
            Nf: ge ? uni(1, 1.3) : uni(1, 1.05),
            Ise: rand() < 0.3 ? 0 : (ge ? logU(1e-9, 1e-5) : logU(1e-16, 1e-12)),
            Ne: uni(1.2, 2),
            Rb: rand() < 0.5 ? 0 : uni(0, 200),
            Re: rand() < 0.5 ? 0 : uni(0, 2),
            Rc: rand() < 0.5 ? 0 : uni(0, 20),
            Br: rand() < 0.3 ? undefined : logU(0.1, 50),
            Nr: uni(1, 1.3),
            Isc: rand() < 0.3 ? 0 : (ge ? logU(1e-9, 1e-5) : logU(1e-16, 1e-11)),
            Nc: uni(1.1, 2.5),
            Vaf: rand() < 0.4 ? 0 : logU(10, 300),
            Var: rand() < 0.6 ? 0 : logU(5, 100),
            Ikf: rand() < 0.4 ? 0 : logU(1e-3, 1),
            Ikr: rand() < 0.6 ? 0 : logU(1e-3, 1),
        });
        const q1 = mk(), q2 = rand() < 0.5 ? q1 : mk();
        const legacy = rand() < 0.2;
        const R2 = logU(1e3, 50e3);
        const inp = {
            mode: 'reverse',
            Vcc: uni(5, 18), Rf: logU(10e3, 1e6), Vt: uni(24e-3, 28e-3),
            RV1: rand() < 0.5 ? 1 : logU(1, 10e3), RV2: rand() < 0.2 ? Infinity : logU(10e3, 1e6),
            Rbc1: rand() < 0.5 ? Infinity : logU(10e3, 10e6),
            Rbc2: rand() < 0.5 ? Infinity : logU(10e3, 10e6),
            acOhmic: rand() < 0.8,
            q1, q2,
            R1: logU(1e3, 200e3), R3: logU(50, 5e3),
        };
        if (legacy) { inp.R2t = R2 * 0.7; inp.R2b = R2 * 0.3; } else inp.R2 = R2;
        try {
            const r = E.evaluate(inp);
            const vals = [r.Ic1, r.Ic2, r.nodes.VB1, r.nodes.VC1, r.nodes.VE2, r.nodes.VC2, r.q1.hfe, r.q2.hfe,
                r.q1.rie, r.q2.rie, r.q1.beta_ac, r.q2.gm, r.ac.Av, r.ac.Zin, r.ac.AvdB, r.solver.maxResidual];
            if (vals.some(v => typeof v !== 'number' || Number.isNaN(v) || (!isFinite(v) && v !== Infinity))) { nanOut++; console.log('  NaN: ' + JSON.stringify(vals)); continue; }
            if (![r.ac.Av, r.ac.Zin, r.ac.AvdB].every(isFinite)) { nanOut++; continue; }
            const k = maxKcl(r, inp);
            maxRel = Math.max(maxRel, k.rel);
            if (k.rel > 1e-9) highRes++;
            if (r.solver.roots > 1) multi++;
            if (r.warnings.length) warned++;
            const rk = r.q1.region + '/' + r.q2.region;
            regions[rk] = (regions[rk] || 0) + 1;
            paths[r.solver.path] = (paths[r.solver.path] || 0) + 1;
            solved++;
        } catch (e) {
            if (JP.test(e.message)) {
                cleanErr++;
                const key = e.message.replace(/[\d.e+\-]+/g, '#').slice(0, 40);
                errKinds[key] = (errKinds[key] || 0) + 1;
            } else { badErr++; console.log('  non-Japanese error: ' + e.stack); }
        }
    }
    const dt = (Date.now() - t0) / 1000;
    console.log('  cases ' + N + ': solved ' + solved + ', clean Japanese errors ' + cleanErr + ', unhandled ' + badErr +
        ', NaN outputs ' + nanOut + ', residual>1e-9 rel ' + highRes + ', multiple roots ' + multi +
        ', with warnings ' + warned + ', max rel residual ' + maxRel.toExponential(2) + ', ' + dt.toFixed(1) + ' s');
    console.log('  regions Q1/Q2: ' + JSON.stringify(regions));
    console.log('  solver paths: ' + JSON.stringify(paths));
    if (cleanErr) console.log('  error kinds: ' + JSON.stringify(errKinds));
    check(badErr === 0, 'no unhandled exceptions');
    check(nanOut === 0, 'no NaN outputs');
    check(highRes === 0, 'all residuals < 1e-9 relative');
}

// ---------------------------------------------------------------
section('9. Robustness sweep (random forward inputs, incl. V_E ratio)');
{
    const N = 3000;
    let solved = 0, cleanErr = 0, badErr = 0, nanOut = 0, rtFail = 0, rfOut = 0;
    for (let i = 0; i < N; i++) {
        const useVe = rand() < 0.4;
        const inp = Object.assign({}, BASE, {
            mode: 'forward', q1: rand() < 0.5 ? QDEF : QFULL, q2: rand() < 0.5 ? QDEF : QFULL, Vcc: uni(5, 18),
            Rf: useVe ? NaN : logU(10e3, 1e6),
            Rbc1: rand() < 0.5 ? Infinity : logU(10e3, 10e6), Rbc2: rand() < 0.5 ? Infinity : logU(10e3, 10e6),
            Ic1: logU(5e-6, 1e-3), Ic2: logU(50e-6, 5e-3), vrRatio: uni(0.2, 5), vcRatio: uni(0.2, 5),
            veRatio: useVe ? uni(0.05, 2) : undefined,
        });
        try {
            const r = E.evaluate(inp);
            if ([r.R1, r.R2, r.R3, r.Rf, r.ac.Av, r.ac.Zin].some(v => !isFinite(v))) { nanOut++; continue; }
            solved++;
            if (r.RfComputed) rfOut++;
            if (i % 10 === 0) {   // spot-check round trip
                const b = E.evaluate(Object.assign({}, inp, { mode: 'reverse', Rf: r.Rf, R1: r.R1, R2: r.R2, R3: r.R3 }));
                if (relErr(b.Ic1, inp.Ic1) > 1e-6 || relErr(b.Ic2, inp.Ic2) > 1e-6) {
                    rtFail++;
                    console.log('  round-trip mismatch (roots ' + b.solver.roots + '): ' + JSON.stringify({ Ic1: inp.Ic1, Ic2: inp.Ic2, got1: b.Ic1, got2: b.Ic2 }));
                }
            }
        } catch (e) {
            if (JP.test(e.message)) cleanErr++;
            else { badErr++; console.log('  non-Japanese error: ' + e.stack); }
        }
    }
    console.log('  cases ' + N + ': solved ' + solved + ' (R_F computed ' + rfOut + '), clean Japanese errors ' + cleanErr + ', unhandled ' + badErr + ', NaN ' + nanOut + ', round-trip mismatches ' + rtFail);
    check(badErr === 0 && nanOut === 0, 'forward sweep clean');
    check(rtFail === 0, 'forward sweep round trips');
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);

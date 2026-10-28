// Run: node tests/pnp.test.js   (no dependencies)
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const E = require('../js/engine.js');
const F = require('../js/fit.js');

let pass = 0, fail = 0;
function check(cond, msg) {
    if (cond) pass++;
    else { fail++; console.log('  FAIL: ' + msg); }
}
const relErr = (a, b) => Math.abs(a - b) / Math.max(Math.abs(a), Math.abs(b), 1e-300);
function close(a, b, tol, msg) { check(relErr(a, b) <= tol, msg + ' (' + a + ' vs ' + b + ', rel ' + relErr(a, b).toExponential(2) + ')'); }
function section(name) { console.log('\n== ' + name); }
const wrap = (d) => { while (d > 180) d -= 360; while (d <= -180) d += 360; return d; };
const JP = /[぀-ヿ一-龯]/;

function rng(seed) {
    return function () {
        seed |= 0; seed = seed + 0x6D2B79F5 | 0;
        let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
        t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
        return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
}
const rand = rng(777);
const logU = (lo, hi) => Math.exp(Math.log(lo) + rand() * (Math.log(hi) - Math.log(lo)));
const uni = (lo, hi) => lo + rand() * (hi - lo);

// Parse the sample models with the real parser (browser scripts in a VM context)
const ctx = {};
vm.createContext(ctx);
for (const f of ['utils.js', 'spice-parser.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', f), 'utf8'), ctx);
const NPN = Object.assign({}, ctx.parseSpiceModel(E.SAMPLE_MODELS.npn));
const PNP = Object.assign({}, ctx.parseSpiceModel(E.SAMPLE_MODELS.pnp));
const NPN_AS_PNP = Object.assign({}, NPN, { type: 'PNP' });   // same parameters, relabelled
const VT27 = 25.8648e-3;

// ---------------------------------------------------------------
section('1. Sample models and parser type');
{
    const idx = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
    const m = idx.match(/\.MODEL 2SC8888-W NPN\([^<]*\)/);
    check(m && m[0] === E.SAMPLE_MODELS.npn, 'SAMPLE_MODELS.npn identical to index.html');
    check(NPN.type === 'NPN' && PNP.type === 'PNP', 'parser type NPN / PNP');
    check(ctx.parseSpiceModel('IS=1f BF=100').type === null, 'bare parameters -> type null');
    check(ctx.parseSpiceModel('.model q pnp (IS=1f)').type === 'PNP', 'lower case, space before (');
    check(ctx.parseSpiceModel(E.SAMPLE_MODELS.pnp).found.length === 25 && /mfg=virtual-transistor/.test(E.SAMPLE_MODELS.pnp), '2SA9999-W parses all 25 keys');
    console.log('  ' + E.SAMPLE_MODELS.pnp);
}

// ---------------------------------------------------------------
section('2. Mirror: PNP with the NPN parameters = NPN with negated voltages');
{
    let n = 0, nf = 0, maxAc = 0;
    for (let i = 0; i < 300; i++) {
        const Vcc = uni(5, 18);
        const common = {
            Vt: uni(24e-3, 28e-3), Rf: logU(10e3, 1e6), RV1: rand() < 0.5 ? 1 : logU(1, 1e4), RV2: rand() < 0.3 ? Infinity : logU(1e4, 1e6),
            Rbc1: rand() < 0.5 ? Infinity : logU(1e5, 1e7), Rbc2: rand() < 0.5 ? Infinity : logU(1e5, 1e7), Rin: logU(1, 1e5),
            Cin: logU(1e-8, 1e-5), Ce2: logU(1e-6, 1e-4), Cout: logU(1e-9, 1e-4), Cbc1: rand() < 0.5 ? 0 : logU(1e-12, 1e-9), Cbc2: rand() < 0.5 ? 0 : logU(1e-12, 1e-9),
        };
        const fw = rand() < 0.4;
        const x = fw ? { mode: 'forward', Ic1: logU(10e-6, 300e-6), Ic2: logU(100e-6, 3e-3), vrRatio: uni(0.5, 2), vcRatio: uni(0.5, 2), veRatio: rand() < 0.3 ? uni(0.1, 1) : undefined }
            : { mode: 'reverse', R1: logU(10e3, 300e3), R2: logU(2e3, 30e3), R3: logU(100, 3e3) };
        if (x.veRatio) delete common.Rf;
        const inN = Object.assign({ polarity: 'npn', Vcc: Vcc, q1: NPN, q2: NPN }, common, x);
        const inP = Object.assign({ polarity: 'pnp', Vcc: -Vcc, q1: NPN_AS_PNP, q2: NPN_AS_PNP }, common, x);
        let a, b, ea = null, eb = null;
        try { a = E.evaluate(inN); } catch (e) { ea = e.message; }
        try { b = E.evaluate(inP); } catch (e) { eb = e.message; }
        // PNP errors quoting voltages get ' (PNP: 電圧は絶対値)' appended; otherwise identical
        if (ea || eb) { check(ea !== null && eb !== null && eb.replace(' (PNP: 電圧は絶対値)', '') === ea, 'same error both polarities: ' + ea + ' / ' + eb); nf++; continue; }
        n++;
        check(b.polarity === 'pnp' && b.Vcc === -Vcc && a.polarity === 'npn', 'polarity, Vcc fields');
        for (const k of ['VB1', 'VC1', 'VE2', 'VC2']) check(b.nodes[k] === -a.nodes[k], 'node ' + k);
        for (const k of Object.keys(a.branch)) check(b.branch[k] === -a.branch[k], 'branch ' + k);
        for (const k of ['VR', 'VC', 'VE']) check(b.swing[k] === -a.swing[k], 'swing ' + k);
        for (const q of ['q1', 'q2']) {
            for (const k of ['Vbe', 'Vbc', 'Vce']) check(b[q][k] === -a[q][k], q + '.' + k);
            for (const k of ['Ib', 'hfe', 'rie', 'gm', 'ro', 'beta_ac', 'region']) check(b[q][k] === a[q][k], q + '.' + k);
        }
        for (const k of ['R1', 'R2', 'R3', 'Rf', 'Ic1', 'Ic2']) check(b[k] === a[k], k);
        for (const k of ['Av', 'AvSigned', 'Zin', 'AvS', 'AvSSigned', 'valid']) check(b.ac[k] === a.ac[k], 'ac.' + k);
        check(b.warnings.length === a.warnings.length, 'same number of warnings');
        if (i % 5 === 0) {
            const sa = E.acSweep(inN, { n: 25 }), sb = E.acSweep(inP, { n: 25 });
            check(sa.AvS.dB.every((v, j) => v === sb.AvS.dB[j]) && sa.AvS.phaseDeg.every((v, j) => v === sb.AvS.phaseDeg[j]) &&
                sa.Zin.mag.every((v, j) => v === sb.Zin.mag[j]), 'acSweep identical');
            check(JSON.stringify(sa.f3dB) === JSON.stringify(sb.f3dB), 'f3dB identical');
            maxAc++;
        }
    }
    console.log('  ' + n + ' circuits compared exactly (' + nf + ' failed identically in both polarities), acSweep compared on ' + maxAc);
    check(n > 200, 'enough mirror comparisons');
    // warning labels for PNP
    const sat = { mode: 'reverse', Vt: VT27, Rf: 100e3, RV1: 1, RV2: 500e3, R1: 33e3, R2: 8.2e3, R3: 390 };
    const wn = E.evaluate(Object.assign({ Vcc: 9, q1: NPN, q2: NPN }, sat)).warnings;
    const wp = E.evaluate(Object.assign({ polarity: 'pnp', Vcc: -9, q1: NPN_AS_PNP, q2: NPN_AS_PNP }, sat)).warnings;
    console.log('  NPN: ' + JSON.stringify(wn) + '\n  PNP: ' + JSON.stringify(wp));
    check(/V_CE2/.test(wn.join()) && /V_EC2 = 0\.010 V, V_CB2 = 0\.651 V/.test(wp.join()), 'PNP saturation warning uses V_EC / V_CB');
}

// ---------------------------------------------------------------
section('3. PNP forward <-> reverse round trips (2SA9999-W)');
{
    let ok = 0, imp = 0;
    for (const [Rbc1, Rbc2] of [[Infinity, Infinity], [330e3, Infinity], [1e6, 470e3]]) {
        for (const [Ic1, Ic2, vr, vc, ve] of [[30e-6, 300e-6, 1, 1, undefined], [100e-6, 1e-3, 1.2, 1, undefined], [50e-6, 500e-6, 1, 1, 0.3]]) {
            const common = { polarity: 'pnp', Vcc: -5.6, Vt: VT27, Rf: ve ? NaN : 22e3, RV1: 0.1, Rbc1, Rbc2, q1: PNP, q2: PNP };
            let f;
            try { f = E.evaluate(Object.assign({ mode: 'forward', Ic1, Ic2, vrRatio: vr, vcRatio: vc, veRatio: ve }, common)); }
            catch (e) {
                // V_E2 fixed by the ratio with R_BC1 present: I_BC1 > I_B1 is a correct rejection
                check(ve && Rbc1 < Infinity && /R_BC1 の電流が I_B1 を超える/.test(e.message), 'expected rejection only: ' + e.message);
                imp++; continue;
            }
            const S = vr + vc + (ve || 0);
            check(f.nodes.VC2 < 0 && f.nodes.VE2 < 0 && f.q2.Vce < 0 && f.q1.Vbe < 0, 'PNP signs (V_C2, V_E2, V_CE2, V_BE1 < 0)');
            close(f.swing.VR / f.swing.VC, vr / vc, 1e-12, 'V_R2 : V_CE2 on magnitudes');
            if (ve) close(f.swing.VE, -5.6 * ve / S, 1e-12, 'V_E2 = -|Vcc| ve/S');
            const r = E.evaluate(Object.assign({}, common, { mode: 'reverse', Rf: f.Rf, R1: f.R1, R2: f.R2, R3: f.R3 }));
            close(r.Ic1, Ic1, 1e-6, 'round trip Ic1');
            close(r.Ic2, Ic2, 1e-6, 'round trip Ic2');
            close(r.nodes.VC2, f.nodes.VC2, 1e-6, 'round trip VC2');
            check(r.ac.AvSigned > 0, 'PNP Av positive (non-inverting, same as NPN)');
            ok++;
        }
    }
    console.log('  ' + ok + ' round trips, ' + imp + ' impossible');
    check(ok === 7 && imp === 2, 'PNP round trips: 7 designs, 2 rejected by R_BC1');
}

// ---------------------------------------------------------------
section('4. Polarity / model type errors');
{
    const base = { mode: 'reverse', Vt: VT27, Rf: 100e3, RV1: 1, R1: 33e3, R2: 8.2e3, R3: 1.1e3 };
    const cases = [
        [{ polarity: 'pnp', Vcc: -9, q1: NPN, q2: PNP }, /Q1 のモデルが PNP ではない/],
        [{ polarity: 'pnp', Vcc: -9, q1: PNP, q2: NPN }, /Q2 のモデルが PNP ではない/],
        [{ Vcc: 9, q1: PNP, q2: PNP }, /Q1 のモデルが NPN ではない/],
        [{ polarity: 'pnp', Vcc: 9, q1: PNP, q2: PNP }, /PNP では V_CC を負の値/],
        [{ polarity: 'npn', Vcc: -9, q1: NPN, q2: NPN }, /V_CC/],
        [{ polarity: 'xyz', Vcc: 9, q1: NPN, q2: NPN }, /polarity が不正/],
    ];
    for (const [x, re] of cases) {
        let msg = '';
        try { E.evaluate(Object.assign({}, base, x)); } catch (e) { msg = e.message; }
        check(re.test(msg) && JP.test(msg), JSON.stringify(Object.keys(x)) + ' -> ' + msg);
        console.log('  ' + msg);
    }
    // models without a type (bare parameters) are accepted in either polarity
    const bare = Object.assign({}, PNP); delete bare.type;
    const r = E.evaluate(Object.assign({}, base, { polarity: 'pnp', Vcc: -9, q1: bare, q2: bare }));
    check(r.polarity === 'pnp', 'untyped model accepted');
    let msg = '';
    try { E.acSweep(Object.assign({}, base, { polarity: 'pnp', Vcc: -9, q1: NPN, q2: NPN })); } catch (e) { msg = e.message; }
    check(/PNP ではない/.test(msg), 'acSweep(inputs) checks type too');
}

// ---------------------------------------------------------------
section('5. LTspice cross-check (2SA9999-W, .temp 27, VT 25.8648 mV)');
{
    // DC: LTspice .op with RB/IRB/RBM/RE/RC removed from the model (the engine's DC omits them).
    // AC: LTspice .ac with the full model (V(out)/Vs; Zin = V(nin)/I(Rin)).
    // Observed: nodes <= 26 uV, IC <= 6 ppm; |AvS| <= 0.007 dB, phase <= 0.032 deg, |Zin| <= 0.14 %.
    // Tolerances ~2-3x: 60 uV, 2e-5, 0.02 dB, 0.1 deg, 0.4 %.
    const LT = {"PA":{"case":{"Vcc":-9,"Rf":100000,"R1":33000,"R2":8200,"R3":1100,"RV1":1,"RV2":500000,"Rin":1000,"Cin":0.000001,"Ce2":0.00002,"Cout":1e-8},"dc":{"VB1":-0.591364285,"VC1":-1.29207406,"VE2":-0.67591108,"VC2":-3.97202485,"Ic1":0.000231431129,"Ic2":0.000613167701},"f":[10,100,1000,10000,100000,1000000],"dB":[27.4325485,74.9512286,82.494633,81.5585187,68.4990776,48.4370938],"phase":[-149.212608,132.766273,9.97892031,-25.0146852,-79.8137575,-103.154875],"zin":[15851.6638,1002.42069,6606.52239,15844.4205,9144.82834,3572.79723]},"PB":{"case":{"Vcc":-5.6,"Rf":22000,"R1":137000,"R2":8490,"R3":1660,"RV1":0.1,"RV2":null,"Rin":1000,"Cin":0.000005,"Ce2":0.00001,"Cout":0.0001,"Rbc1":330000,"Cbc2":4.7e-11},"dc":{"VB1":-0.538337766,"VC1":-1.10123779,"VE2":-0.503422135,"VC2":-3.04787974,"Ic1":0.0000300557437,"Ic2":0.000300603093},"f":[10,100,1000,10000,100000,1000000],"dB":[33.2530928,58.75908,65.1193013,50.2326681,30.3246756,10.1525077],"phase":[112.17539,72.6777051,-20.3985458,-80.4096952,-90.6818641,-106.370917],"zin":[3143.33051,294.167337,5576.7849,18521.1343,17182.7706,4529.00394]}};
    const worst = { v: 0, i: 0, dB: 0, deg: 0, z: 0 };
    for (const name of Object.keys(LT)) {
        const L = LT[name], c = Object.assign({}, L.case);
        if (c.RV2 === null) c.RV2 = Infinity;
        const inp = Object.assign({ mode: 'reverse', polarity: 'pnp', Vt: VT27, q1: PNP, q2: PNP }, c);
        const r = E.evaluate(inp);
        check(r.q1.region === 'active' && r.q2.region === 'active', name + ' both active');
        for (const k of ['VB1', 'VC1', 'VE2', 'VC2']) {
            const d = Math.abs(r.nodes[k] - L.dc[k]);
            worst.v = Math.max(worst.v, d);
            check(d < 60e-6, name + ' ' + k + ' ' + r.nodes[k] + ' vs ' + L.dc[k]);
        }
        for (const k of ['Ic1', 'Ic2']) { const e = relErr(r[k], L.dc[k]); worst.i = Math.max(worst.i, e); check(e < 2e-5, name + ' ' + k); }
        L.f.forEach((f, i) => {
            const s = E.acSweep(r, inp, { fStart: f, fStop: f * 1.000001, n: 2 });
            const dd = s.AvS.dB[0] - L.dB[i], dp = wrap(s.AvS.phaseDeg[0] - L.phase[i]), dz = relErr(s.Zin.mag[0], L.zin[i]);
            worst.dB = Math.max(worst.dB, Math.abs(dd)); worst.deg = Math.max(worst.deg, Math.abs(dp)); worst.z = Math.max(worst.z, dz);
            check(Math.abs(dd) < 0.02 && Math.abs(dp) < 0.1 && dz < 4e-3, name + ' ' + f + ' Hz: ' + dd + ' dB, ' + dp + ' deg, Zin ' + dz);
        });
        console.log('  ' + name + ': VC2 ' + r.nodes.VC2.toFixed(5) + ' V (LTspice ' + L.dc.VC2.toFixed(5) + '), IC2 ' + (r.Ic2 * 1e6).toFixed(3) + ' uA (LTspice ' + (L.dc.Ic2 * 1e6).toFixed(3) + '), mid-band ' + r.ac.AvSdB.toFixed(2) + ' dB');
    }
    console.log('  worst: node ' + (worst.v * 1e6).toFixed(1) + ' uV, IC ' + (worst.i * 1e6).toFixed(1) + ' ppm, |AvS| ' + worst.dB.toFixed(4) + ' dB, phase ' + worst.deg.toFixed(3) + ' deg, |Zin| ' + (worst.z * 100).toFixed(3) + ' %');
}

// ---------------------------------------------------------------
section('6. fit.js with PNP measurements');
{
    // Synthesize PNP points from 2SA9999-W: mirrored NPN problem, report signed values
    const eng = E._normalizeCommon({ Vcc: 1, Rf: 1, Vt: 0.02585, RV1: 1, q1: PNP, q2: PNP }).q1;
    function point(Ib, Vce) {
        let lo = 0.1, hi = 1.1;
        for (let i = 0; i < 200; i++) { const m = (lo + hi) / 2; if (E.gpDC(m, m - Vce, eng, 0.02585, 0).Ib < Ib) lo = m; else hi = m; }
        const v = (lo + hi) / 2, d = E.gpDC(v, v - Vce, eng, 0.02585, 0);
        return { Ib: d.Ib, Ic: d.Ic, Vbe: v, Vce: Vce };
    }
    const mags = [point(1e-6, 5), point(10e-6, 5)];
    const signed = mags.map(p => ({ Ib: -p.Ib, Ic: -p.Ic, Vbe: -p.Vbe, Vce: -p.Vce }));
    const base = Object.assign({}, PNP);
    for (const k of ['Is', 'Bf', 'Nf', 'Ise']) delete base[k];
    const a = F.fit(signed, { base: base });
    const b = F.fit(mags, { polarity: 'pnp', base: base });
    check(a.polarity === 'pnp' && /^\.MODEL FIT PNP\(/.test(a.model), 'PNP from base type, .MODEL FIT PNP: ' + a.model);
    for (const [k, K] of [['Is', 'IS'], ['Bf', 'BF'], ['Nf', 'NF'], ['Ise', 'ISE']]) {
        close(a.params[K], PNP[k], 1e-6, 'signed points recover ' + K);
        close(b.params[K], PNP[k], 1e-6, 'magnitude points recover ' + K);
    }
    check(a.engineParams.type === 'PNP', 'engineParams.type PNP');
    const r = E.evaluate({ mode: 'reverse', polarity: 'pnp', Vcc: -9, Vt: 0.02585, Rf: 100e3, RV1: 1, R1: 33e3, R2: 8.2e3, R3: 1.1e3, q1: a.engineParams, q2: a.engineParams });
    check(r.polarity === 'pnp', 'fitted PNP model usable in evaluate');
    let msg = '';
    try { F.fit(mags, { polarity: 'npn', base: base }); } catch (e) { msg = e.message; }
    check(/基準モデルが NPN ではない/.test(msg), 'polarity contradicting base type: ' + msg);
    const n = F.fit(mags.map(p => Object.assign({}, p)), {});
    check(n.polarity === 'npn' && /^\.MODEL FIT NPN\(/.test(n.model), 'default NPN unchanged');
    msg = '';
    try { F.fit(signed, {}); } catch (e) { msg = e.message; }
    check(JP.test(msg), 'negative values without PNP polarity rejected: ' + msg);
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);

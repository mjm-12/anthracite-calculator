// Run: node tests/classic.test.js   (no dependencies)
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const E = require('../js/engine.js');

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

const ctx = {};
vm.createContext(ctx);
for (const f of ['utils.js', 'spice-parser.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', f), 'utf8'), ctx);
const Q = Object.assign({}, ctx.parseSpiceModel(E.SAMPLE_MODELS.npn));
const QP = Object.assign({}, ctx.parseSpiceModel(E.SAMPLE_MODELS.pnp));
const QNP = Object.assign({}, Q, { type: 'PNP' });            // NPN parameters relabelled PNP

// Classic Fuzz Face defaults (UI): R1 33k, R2t 470, R2b 8.2k, RV1 1k (fuzz 10), RF 100k
const CL = { topology: 'classic', Vt: 25.85e-3, Rf: 100e3, Cin: 1e-6, Ce2: 20e-6, Cout: 10e-9, RV2: 500e3, Rin: 1e3, fuzz: 1 };
const NPNX = { Vcc: 9, q1: Q, q2: Q }, PNPX = { polarity: 'pnp', Vcc: -9, q1: QP, q2: QP };
const REV = { mode: 'reverse', R1: 33e3, R2t: 470, R2b: 8.2e3, RV1: 1e3 };

// ---------------------------------------------------------------
section('1. Classic defaults: operating point and forward targets');
{
    for (const [name, x, tgt] of [['NPN 2SC8888-W, +9 V', NPNX, { Ic1: 231.5e-6, Ic2: 668.2e-6, vr: 2.283 }],
                                    ['PNP 2SA9999-W, -9 V', PNPX, { Ic1: 231.1e-6, Ic2: 673.9e-6, vr: 2.354 }]]) {
        const r = E.evaluate(Object.assign({}, CL, x, REV));
        check(r.topology === 'classic' && r.R2 === 8670 && r.R3 === 1000 && r.RV1 === 1000 && r.R2t === 470 && r.R2b === 8200, name + ': classic fields');
        check(r.q1.region === 'active' && r.q2.region === 'active' && r.warnings.length === 0, name + ': both active, no warnings');
        close(Math.abs(r.nodes.VM), 9 - Math.abs(r.branch.I2) * 470, 1e-12, name + ': V_M = Vcc - I_2 R2t');
        console.log('  ' + name + ': I_C1 ' + (r.Ic1 * 1e6).toFixed(1) + ' uA, I_C2 ' + (r.Ic2 * 1e6).toFixed(1) + ' uA, V_C2 ' + r.nodes.VC2.toFixed(3) +
            ' V, V_CE2 ' + r.q2.Vce.toFixed(3) + ' V, V_M ' + r.nodes.VM.toFixed(3) + ' V, V_R2:V_CE2 = ' + (r.swing.VR / r.swing.VC).toFixed(3) + ', A_v ' + r.ac.AvdB.toFixed(2) + ' dB');
        // forward targets (4 digits) reproduce the default resistors
        const f = E.evaluate(Object.assign({}, CL, x, { mode: 'forward', Ic1: tgt.Ic1, Ic2: tgt.Ic2, vrRatio: tgt.vr, vcRatio: 1 }));
        close(f.R1, 33e3, 3e-4, name + ': forward R1');
        close(f.R2, 8670, 3e-4, name + ': forward R2');
        close(f.RV1, 1000, 3e-4, name + ': forward RV1');
        close(f.R2t, 470, 3e-4, name + ': forward R2t (default tap 470/8670)');
        close(f.R2b, 8200, 3e-4, name + ': forward R2b');
    }
}

// ---------------------------------------------------------------
section('2. Forward <-> reverse round trips (classic)');
{
    let n = 0, imp = 0;
    for (const [pol, x] of [['npn', NPNX], ['pnp', PNPX]]) {
        for (const [Ic1, Ic2, vr, vc, ve, frac, Rbc1] of [[231e-6, 670e-6, 2.3, 1, undefined, undefined, Infinity], [100e-6, 1e-3, 1, 1, undefined, 0.2, Infinity],
            [50e-6, 500e-6, 1.5, 1, 0.3, 0.1, Infinity], [150e-6, 800e-6, 1, 1, undefined, 470 / 8670, 1e6]]) {
            const common = Object.assign({}, CL, x, { Rbc1: Rbc1, r2tFrac: frac, Rf: ve ? NaN : 100e3 });
            let f;
            try { f = E.evaluate(Object.assign({ mode: 'forward', Ic1, Ic2, vrRatio: vr, vcRatio: vc, veRatio: ve }, common)); }
            catch (e) { imp++; console.log('  forward impossible: ' + e.message); continue; }
            close(f.R2t / f.R2, frac === undefined ? 470 / 8670 : frac, 1e-12, pol + ': tap fraction');
            close(f.RV1, f.R3, 0, pol + ': RV1 = R3');
            const r = E.evaluate(Object.assign({}, common, { mode: 'reverse', Rf: f.Rf, R1: f.R1, R2t: f.R2t, R2b: f.R2b, RV1: f.RV1 }));
            close(r.Ic1, Ic1, 1e-6, pol + ' round trip Ic1');
            close(r.Ic2, Ic2, 1e-6, pol + ' round trip Ic2');
            close(r.nodes.VM, f.nodes.VM, 1e-6, pol + ' round trip V_M');
            close(r.ac.Av, f.ac.Av, 1e-6, pol + ' round trip A_v');
            n++;
        }
    }
    console.log('  ' + n + ' round trips, ' + imp + ' impossible');
    check(n === 8, 'all classic round trips');
}

// ---------------------------------------------------------------
section('3. NPN / PNP mirror (classic): identical magnitudes, negated voltages, identical AC');
{
    for (const fuzz of [1, 0.5, 0]) {
        const a = E.evaluate(Object.assign({}, CL, NPNX, REV, { fuzz }));
        const b = E.evaluate(Object.assign({}, CL, { polarity: 'pnp', Vcc: -9, q1: QNP, q2: QNP }, REV, { fuzz }));
        for (const k of ['VB1', 'VC1', 'VE2', 'VC2', 'VM']) check(b.nodes[k] === -a.nodes[k], 'fuzz ' + fuzz + ' node ' + k);
        for (const k of ['Ic1', 'Ic2', 'R2t', 'R2b', 'RV1']) check(b[k] === a[k], 'fuzz ' + fuzz + ' ' + k);
        for (const k of ['Av', 'AvSigned', 'Zin', 'AvS', 'RE', 'RC']) check(b.ac[k] === a.ac[k], 'fuzz ' + fuzz + ' ac.' + k);
        const inA = Object.assign({}, CL, NPNX, REV, { fuzz }), inB = Object.assign({}, CL, { polarity: 'pnp', Vcc: -9, q1: QNP, q2: QNP }, REV, { fuzz });
        const sa = E.acSweep(inA, { n: 25 }), sb = E.acSweep(inB, { n: 25 });
        check(sa.AvS.dB.every((v, i) => v === sb.AvS.dB[i]) && sa.Zin.mag.every((v, i) => v === sb.Zin.mag[i]), 'fuzz ' + fuzz + ' acSweep identical');
        const ta = E.stability(inA, { n: 120, nLoop: 80 }), tb = E.stability(inB, { n: 120, nLoop: 80 });
        check(ta.nRhp === tb.nRhp && ta.loop.T.dB.every((v, i) => v === tb.loop.T.dB[i]) && JSON.stringify(ta.poles) === JSON.stringify(tb.poles), 'fuzz ' + fuzz + ' stability identical');
    }
}

// ---------------------------------------------------------------
section('4. Mid-band limits against a hand-built equivalent (anthracite analyzeAC)');
{
    // Classic, mid-band (C_E2, C_out short): emitter to GND through R_a = (RV1-0.1)(1-fuzz)+0.05,
    // collector load R2b + R2t||RV2, output at M = v_C2 (R2t||RV2)/(R2b + R2t||RV2).
    // Equivalent anthracite network: R3 = R_a, RV1 = inf, R2 = R2b + R2t||RV2, RV2 = inf.
    const par = (a, b) => a * b / (a + b);
    for (const fuzz of [1, 0.5, 0]) {
        const r = E.evaluate(Object.assign({}, CL, NPNX, REV, { fuzz }));
        const Ra = (1000 - 0.1) * (1 - fuzz) + 0.05;
        const RL = 8200 + par(470, 500e3), tap = par(470, 500e3) / RL;
        const eq = E.analyzeAC({ R1: 33e3, R2: RL, R3: Ra, Rf: 100e3, RV1: Infinity, RV2: Infinity, Rbc1: Infinity, Rbc2: Infinity,
            ohmic: true, q1: r.q1.ss, q2: r.q2.ss, Rin: 1e3 });
        close(r.ac.AvSigned, eq.AvSigned * tap, 1e-12, 'fuzz ' + fuzz + ': A_v = A_v(C2) x tap');
        close(r.ac.Zin, eq.Zin, 1e-12, 'fuzz ' + fuzz + ': Z_in');
        close(r.ac.RE, Ra, 1e-15, 'fuzz ' + fuzz + ': ac.RE = R_a');
        close(r.ac.RC, RL, 1e-15, 'fuzz ' + fuzz + ': ac.RC = R2b + R2t||RV2');
        console.log('  fuzz ' + fuzz + ': A_v ' + r.ac.AvdB.toFixed(2) + ' dB, Z_in ' + r.ac.Zin.toFixed(0) + ' Ω');
    }
    // sweep with every capacitor shorted, at 1 Hz, equals the mid-band result
    const inp = Object.assign({}, CL, NPNX, REV, { fuzz: 0.5, Cin: Infinity, Ce2: Infinity, Cout: Infinity });
    const r = E.evaluate(inp), s = E.acSweep(r, inp, { fStart: 1, fStop: 2, n: 2 });
    close(s.AvS.mag[0], r.ac.AvS, 1e-7, 'acSweep with shorted caps = mid-band AvS');
    // DC independent of fuzz (R_a + R_b = RV1)
    check(E.evaluate(Object.assign({}, CL, NPNX, REV, { fuzz: 0 })).Ic2 === E.evaluate(Object.assign({}, CL, NPNX, REV, { fuzz: 1 })).Ic2, 'DC independent of fuzz');
    // classic with R2b = 0: output at C2 directly
    const z = E.evaluate(Object.assign({}, CL, NPNX, REV, { R2t: 8670, R2b: 0 }));
    close(z.ac.RC, par(8670, 500e3), 1e-15, 'R2b = 0: RC = R2t || RV2');
}

// ---------------------------------------------------------------
section('5. LTspice reference (classic, full .model, VT 25.8648 mV)');
{
    // DC: .op with RB/IRB/RBM/RE/RC stripped. AC: .ac, full model, V(out)/Vs, Zin = V(k)/I(Rin).
    // Pot: Ra = (RV1-0.1)(1-fuzz)+0.05, Rb = (RV1-0.1) fuzz+0.05, CE2 from the wiper.
    // Transient (NPN, fuzz 1): 10 pA kick into B1, plotwinsize=0, matrix pencil: 110.7-111.2 Hz,
    // sigma -709 ... -715 /s. Observed: nodes <= 30 uV, IC <= 5 ppm, |AvS| <= 0.0064 dB,
    // phase <= 0.034 deg, |Zin| <= 0.16 %. Tolerances: 60 uV, 2e-5, 0.02 dB, 0.1 deg, 0.4 %.
    const LT = {"dc":{"npn":{"VB1":0.595024906,"VC1":1.29218144,"VE2":0.669859796,"VC2":3.20370303,"VM":8.68578321,"Ic1":0.000231508478,"Ic2":0.000668546363},"pnp":{"VB1":-0.591329065,"VC1":-1.29462937,"VE2":-0.67576467,"VC2":-3.15436166,"VM":-8.68310842,"Ic1":0.000231124464,"Ic2":0.00067423741}},"ac":{"npn_1.0":{"re":[-1.23026232,-232.317772,889.393279,772.528729,41.8062104,-3.64711021],"im":[-0.669220199,221.157164,187.528291,-316.507095,-198.941445,-20.1503059],"zin":[15859.9222,1069.2011,5987.65394,24610.0974,11232.2144,4461.93095]},"npn_0.5":{"re":[-0.974584444,11.2297707,62.4614066,63.4645286,49.8388859,-0.226431678],"im":[0.136695914,38.0790691,9.45278894,-2.3965659,-26.8016582,-11.9742468],"zin":[15906.9556,1640.26749,479.964665,455.880344,629.567287,1522.25245]},"pnp_1.0":{"re":[-1.22841351,-224.017069,790.378222,604.195534,19.5783392,-3.09003738],"im":[-0.66582829,235.448133,135.084624,-338.062092,-133.486603,-12.946465],"zin":[15852.5499,1006.45157,6766.68406,20120.8279,10488.1952,3658.47989]},"pnp_0.5":{"re":[-0.971773759,11.4175617,61.4733429,62.2233557,38.3711678,-1.19030771],"im":[0.137348853,37.6665559,9.03641809,-4.01265462,-31.2884138,-7.71667364],"zin":[15905.5711,1643.8831,498.417516,478.031596,788.563092,1427.84432]}},"f":[10,100,1000,10000,100000,1000000],"tran":{"f":110.8,"sigma":-710.6}};
    const worst = { v: 0, i: 0, dB: 0, deg: 0, z: 0 };
    for (const [pol, x] of [['npn', NPNX], ['pnp', PNPX]]) {
        const base = Object.assign({}, CL, x, REV, { Vt: 25.8648e-3 });
        const r = E.evaluate(base), d = LT.dc[pol];
        for (const k of ['VB1', 'VC1', 'VE2', 'VC2', 'VM']) { const dv = Math.abs(r.nodes[k] - d[k]); worst.v = Math.max(worst.v, dv); check(dv < 60e-6, pol + ' DC ' + k + ' ' + r.nodes[k] + ' vs ' + d[k]); }
        for (const k of ['Ic1', 'Ic2']) { const e = relErr(r[k], d[k]); worst.i = Math.max(worst.i, e); check(e < 2e-5, pol + ' ' + k); }
        for (const fuzz of [1, 0.5]) {
            const inp = Object.assign({}, base, { fuzz }), rr = E.evaluate(inp), A = LT.ac[pol + '_' + fuzz.toFixed(1)];
            LT.f.forEach((f, i) => {
                const s = E.acSweep(rr, inp, { fStart: f, fStop: f * 1.000001, n: 2 });
                const dd = s.AvS.dB[0] - 20 * Math.log10(Math.hypot(A.re[i], A.im[i]));
                const dp = wrap(s.AvS.phaseDeg[0] - Math.atan2(A.im[i], A.re[i]) * 180 / Math.PI);
                const dz = relErr(s.Zin.mag[0], A.zin[i]);
                worst.dB = Math.max(worst.dB, Math.abs(dd)); worst.deg = Math.max(worst.deg, Math.abs(dp)); worst.z = Math.max(worst.z, dz);
                check(Math.abs(dd) < 0.02 && Math.abs(dp) < 0.1 && dz < 4e-3, pol + ' fuzz ' + fuzz + ' ' + f + ' Hz: ' + dd + ' dB ' + dp + ' deg Zin ' + dz);
            });
        }
    }
    const st = E.stability(Object.assign({}, CL, NPNX, REV, { Vt: 25.8648e-3 }));
    const d = st.leastDamped;
    check(st.nRhp === 0 && d && relErr(d.f, LT.tran.f) < 3e-3 && relErr(d.sigma, LT.tran.sigma) < 1e-2,
        'classic NPN stable, ringing ' + JSON.stringify(d) + ' vs LTspice ' + JSON.stringify(LT.tran));
    console.log('  worst: nodes ' + (worst.v * 1e6).toFixed(1) + ' uV, IC ' + (worst.i * 1e6).toFixed(1) + ' ppm, |AvS| ' + worst.dB.toFixed(4) + ' dB, phase ' +
        worst.deg.toFixed(3) + ' deg, |Zin| ' + (worst.z * 100).toFixed(3) + ' %; stability: 安定, ' + d.f.toFixed(2) + ' Hz σ ' + d.sigma.toFixed(1) + ' /s (LTspice ' + LT.tran.f + ' Hz σ ' + LT.tran.sigma + ')');
}

// ---------------------------------------------------------------
section('6. Validation, anthracite unchanged');
{
    const bad = [
        Object.assign({}, CL, NPNX, REV, { topology: 'big-muff' }),
        Object.assign({}, CL, NPNX, REV, { fuzz: 1.2 }),
        Object.assign({}, CL, NPNX, REV, { fuzz: -0.1 }),
        Object.assign({}, CL, NPNX, REV, { r2tFrac: 1 }),
        Object.assign({}, CL, NPNX, REV, { RV1: undefined }),
        Object.assign({}, CL, NPNX, REV, { RV1: Infinity }),
        Object.assign({}, CL, NPNX, REV, { R2t: 0 }),
    ];
    for (const x of bad) {
        let msg = '';
        try { E.evaluate(x); } catch (e) { msg = e.message; }
        check(JP.test(msg), 'Japanese error: ' + msg);
        console.log('  ' + msg);
    }
    // explicit 'anthracite' = default
    const AB = { mode: 'reverse', Vcc: 5.6, Rf: 22e3, Vt: 25.85e-3, Rin: 1e3, R1: 137.532e3, R2: 8.48943e3, R3: 1.67354e3,
        Rbc1: 330e3, Cbc2: 47e-12, Cin: 5e-6, Ce2: 10e-6, Cout: 100e-6, RV1: 0.1, RV2: Infinity, q1: Q, q2: Q };
    const a = E.evaluate(AB), b = E.evaluate(Object.assign({}, AB, { topology: 'anthracite', fuzz: 0.3, R2t: 1 }));
    check(JSON.stringify(a) === JSON.stringify(b) && a.topology === 'anthracite' && a.R2t === undefined, "topology 'anthracite' = default; classic inputs ignored");
    const sa = E.stability(AB, { n: 120, nLoop: 80 }), sb = E.stability(Object.assign({}, AB, { topology: 'anthracite' }), { n: 120, nLoop: 80 });
    check(JSON.stringify(sa.poles) === JSON.stringify(sb.poles), 'anthracite stability unchanged by the topology flag');
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);

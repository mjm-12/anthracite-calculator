// Run: node tests/stability.test.js   (no dependencies)
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
const QP = Object.assign({}, Q, { type: 'PNP' });

// Default Anthracite circuit (UI defaults), reverse mode
const BASE = { mode: 'reverse', Vcc: 5.6, Rf: 22e3, Vt: 25.85e-3, Rin: 1e3, R1: 137.532e3, R2: 8.48943e3, R3: 1.67354e3,
    Rbc1: 330e3, Cbc2: 47e-12, Cin: 5e-6, Ce2: 10e-6, Cout: 100e-6, RV1: 0.1, RV2: Infinity, q1: Q, q2: Q };
const P = E.PICKUP_PRESETS;
const vol = (pu, pos) => Object.assign({}, pu, { vol: Object.assign({}, pu.vol, { pos: pos }) });

// ---------------------------------------------------------------
section('1. Return difference F = det Y / det Y0 on small networks with known poles');
{
    // Parallel G0, C, L with a negative conductance -g (VCCS, active):
    //   F(s) = (G0 - g + sC + 1/(sL)) / (G0 + sC + 1/(sL)); RHP pair when g > G0.
    const G0 = 1e-3, C = 1e-8, L = 0.1;
    const mk = (g) => { const n = E._newNet(); const A = n.node('A'); n.R(A, -1, 1 / G0); n.C(A, -1, C); n.L(A, -1, L); n.VCCS(-1, A, A, -1, g, true); return n; };
    const Fnet = (n, s) => { const a = E._mnaDet(n, s), b = E._mnaDet(n, s, { passive: true }); return [Math.exp(a.logAbs - b.logAbs) * Math.cos(a.arg - b.arg), Math.exp(a.logAbs - b.logAbs) * Math.sin(a.arg - b.arg)]; };
    const cdiv = (a, b) => { const d = b[0] * b[0] + b[1] * b[1]; return [(a[0] * b[0] + a[1] * b[1]) / d, (a[1] * b[0] - a[0] * b[1]) / d]; };
    for (const g of [0.5e-3, 1.5e-3]) {
        const n = mk(g);
        for (const s of [[0, 2 * Math.PI * 1e3], [-300, 2 * Math.PI * 5e3], [1000, 2 * Math.PI * 20e3]]) {
            const yl = cdiv([1, 0], [s[0] * L, s[1] * L]);
            const num = [G0 - g + s[0] * C + yl[0], s[1] * C + yl[1]], den = [G0 + s[0] * C + yl[0], s[1] * C + yl[1]];
            const ex = cdiv(num, den), F = Fnet(n, s);
            check(Math.hypot(F[0] - ex[0], F[1] - ex[1]) < 1e-12 * Math.hypot(...ex), 'F closed form g=' + g + ' s=' + s);
        }
        const tr = E._trackPhase((f) => { const s = [0, 2 * Math.PI * f]; const a = E._mnaDet(n, s), b = E._mnaDet(n, s, { passive: true });
            let ph = a.arg - b.arg; while (ph > Math.PI) ph -= 2 * Math.PI; while (ph <= -Math.PI) ph += 2 * Math.PI; return { la: a.logAbs - b.logAbs, ph: ph }; }, 1e-2, 1e8, 200);
        const nRhp = Math.round(-(tr.phU[tr.phU.length - 1] - tr.phU[0]) / Math.PI);
        // exact roots of s^2 LC + s L (G0 - g) + 1
        const re = -(G0 - g) / (2 * C);
        check(nRhp === (g > G0 ? 2 : 0), 'RLC with -g: nRhp ' + nRhp + ' (g ' + g + ', pole real part ' + re.toFixed(1) + ')');
    }
    // R-C with negative conductance: one real RHP pole when g > G0
    for (const [g, want] of [[0.5e-3, 0], [2e-3, 1]]) {
        const n = E._newNet(); const A = n.node('A'); n.R(A, -1, 1 / G0); n.C(A, -1, C); n.VCCS(-1, A, A, -1, g, true);
        const tr = E._trackPhase((f) => { const s = [0, 2 * Math.PI * f]; const a = E._mnaDet(n, s), b = E._mnaDet(n, s, { passive: true });
            let ph = a.arg - b.arg; while (ph > Math.PI) ph -= 2 * Math.PI; while (ph <= -Math.PI) ph += 2 * Math.PI; return { la: a.logAbs - b.logAbs, ph: ph }; }, 1e-2, 1e9, 200);
        const nRhp = Math.round(-(tr.phU[tr.phU.length - 1] - tr.phU[0]) / Math.PI);
        check(nRhp === want, 'RC with -g: nRhp ' + nRhp + ' (want ' + want + ')');
    }
    // Two coupled tanks with a gyrator-like active coupling: compare the count with
    // eigenvalues of the state matrix (brute force)
    {
        const C1 = 1e-8, L1 = 0.1, C2 = 2e-8, L2 = 0.05, G1 = 2e-4, G2 = 3e-4;
        for (const gm of [1e-4, 6e-4, 2e-3]) {
            const n = E._newNet(); const A = n.node('A'), B = n.node('B');
            n.R(A, -1, 1 / G1); n.C(A, -1, C1); n.L(A, -1, L1);
            n.R(B, -1, 1 / G2); n.C(B, -1, C2); n.L(B, -1, L2);
            n.VCCS(-1, B, A, -1, gm, true);          // gm vA injected into B
            n.VCCS(-1, A, B, -1, gm, true);          // gm vB injected into A (positive feedback)
            const tr = E._trackPhase((f) => { const s = [0, 2 * Math.PI * f]; const a = E._mnaDet(n, s), b = E._mnaDet(n, s, { passive: true });
                let ph = a.arg - b.arg; while (ph > Math.PI) ph -= 2 * Math.PI; while (ph <= -Math.PI) ph += 2 * Math.PI; return { la: a.logAbs - b.logAbs, ph: ph }; }, 1e-2, 1e8, 300);
            const nRhp = Math.round(-(tr.phU[tr.phU.length - 1] - tr.phU[0]) / Math.PI);
            // state x = [vA, iL1, vB, iL2]: C1 vA' = -G1 vA - iL1 + gm vB ; L1 iL1' = vA ; ...
            const Am = [[-G1 / C1, -1 / C1, gm / C1, 0], [1 / L1, 0, 0, 0], [gm / C2, 0, -G2 / C2, -1 / C2], [0, 0, 1 / L2, 0]];
            const want = eigRealPartsPositive(Am);
            check(nRhp === want, 'coupled tanks gm=' + gm + ': nRhp ' + nRhp + ' vs eigenvalues ' + want);
        }
    }
}

// Count eigenvalues with positive real part (characteristic polynomial + Routh table)
function eigRealPartsPositive(A) {
    const n = A.length;
    // Faddeev-LeVerrier for the characteristic polynomial
    let M = A.map(r => r.map(() => 0)); const c = [1];
    const I = A.map((r, i) => r.map((_, j) => (i === j ? 1 : 0)));
    for (let k = 1; k <= n; k++) {
        const AM = A.map((r, i) => r.map((_, j) => r.reduce((s, _v, l) => s + A[i][l] * M[l][j], 0)));
        M = AM.map((r, i) => r.map((v, j) => v + c[k - 1] * I[i][j]));
        const AM2 = A.map((r, i) => r.map((_, j) => r.reduce((s, _v, l) => s + A[i][l] * M[l][j], 0)));
        c.push(-AM2.reduce((s, r, i) => s + r[i], 0) / k);
    }
    // Routh: sign changes in the first column
    const rows = [c.filter((_, i) => i % 2 === 0), c.filter((_, i) => i % 2 === 1)];
    while (rows[1].length < rows[0].length) rows[1].push(0);
    for (let k = 2; k <= n; k++) {
        const a = rows[k - 2], b = rows[k - 1], r = [];
        for (let j = 0; j < a.length - 1; j++) r.push((b[0] * a[j + 1] - a[0] * (b[j + 1] || 0)) / b[0]);
        r.push(0);
        rows.push(r);
    }
    let changes = 0;
    for (let k = 1; k <= n; k++) if (Math.sign(rows[k][0]) !== Math.sign(rows[k - 1][0])) changes++;
    return changes;
}

// ---------------------------------------------------------------
section('2. Tian double injection on a unilateral network: T = G / (Yo + YL)');
{
    // Amplifier output node A: VCCS -G v_B into A, output conductance Yo; load B: YL.
    // Break between A (driving) and B (load), same procedure as the engine's tianT.
    for (const [G, Yo, YL] of [[1e-2, 1e-4, 2e-4], [3e-3, 5e-4, 1e-5]]) {
        const run = (kind) => {
            const n = E._newNet(); const A = n.node('A'), B = n.node('B');
            n.G(A, -1, Yo); n.G(B, -1, YL);
            n.VCCS(A, -1, B, -1, G, true);           // current G v_B leaves A (output = -G v_B)
            const k = n.V(B, A, kind === 'v' ? 1 : 0);
            if (kind === 'i') n.I(A, 1);
            const x = E._mnaSolve(n, [0, 1]);
            return { vA: x(A), vB: x(B), j: x(n.n + k) };
        };
        const cdiv = (a, b) => { const d = b[0] * b[0] + b[1] * b[1]; return [(a[0] * b[0] + a[1] * b[1]) / d, (a[1] * b[0] - a[0] * b[1]) / d]; };
        const v = run('v'), i = run('i');
        const Tv = cdiv(v.vA, v.vB).map(x => -x);
        const Ti = cdiv([1 + i.j[0], i.j[1]], [-i.j[0], -i.j[1]]);
        const num = [Tv[0] * Ti[0] - Tv[1] * Ti[1] - 1, Tv[0] * Ti[1] + Tv[1] * Ti[0]], den = [Tv[0] + Ti[0] + 2, Tv[1] + Ti[1]];
        const T = cdiv(num, den);
        close(T[0], G / (Yo + YL), 1e-12, 'Tian T = G/(Yo+YL)');
        check(Math.abs(T[1]) < 1e-12 * Math.abs(T[0]), 'T real');
    }
}

// ---------------------------------------------------------------
section('3. Default Anthracite circuit: verdicts');
{
    const cases = [
        ['R_in 1 kΩ', {}],
        ['Texas Special Neck, Vol 10', { source: P.texasSpecialNeck }],
        ['57 Classic Neck, Vol 10', { source: P.gibson57ClassicNeck }],
        ['Texas Special Neck, Vol 5', { source: vol(P.texasSpecialNeck, 5) }],
        ['57 Classic Neck, Vol 5', { source: vol(P.gibson57ClassicNeck, 5) }],
    ];
    for (const [name, x] of cases) {
        const st = E.stability(Object.assign({}, BASE, x));
        check(st.stable === true && st.nRhp === 0 && st.warnings.length === 0, name + ' stable, no warnings ' + JSON.stringify(st.warnings));
        check(Math.abs(st.F0[1]) < 1e-2 * Math.abs(st.F0[0]) && st.F0[0] > 0, name + ' F(0+) real positive');
        check(Math.abs(st.Finf[0] - 1) < 0.01 && Math.abs(st.Finf[1]) < 0.01, name + ' F(j inf) -> 1');
        const pm = st.loop.pm.map(q => q.f.toFixed(0) + ' Hz ' + q.deg.toFixed(1) + '°').join(', ');
        const d = st.dominant;
        console.log('  ' + name + ': stable, nRhp 0; R_F loop PM ' + (pm || 'no crossover') + '; least-stable pole ' +
            (d ? (d.f > 0 ? d.f.toFixed(0) + ' Hz, ' : 'real, ') + 'σ ' + d.sigma.toFixed(0) + ' /s, ζ ' + d.zeta.toFixed(2) : '-'));
    }
}

// ---------------------------------------------------------------
section('4. LTspice reference (full .model, VT 25.8648 mV, 57 Classic / Texas Special pickup networks)');
{
    // AC: V(out)/emf with the pickup network; Tian: the same two injections (Vz between
    // RF and E2, Iz into E2) in LTspice .ac; modes: matrix-pencil fit of LTspice .tran
    // after a 10 pA, 2 us current kick into B1 (.options plotwinsize=0).
    // Observed: AvS <= 0.0021 dB / 0.015 deg, T <= 0.0020 dB / 0.016 deg,
    // mode f <= 0.03 %, sigma <= 0.3 %. Tolerances: 0.01 dB, 0.05 deg, f 0.1 %, sigma 1 %.
    const LT = {"ac":{"G10":{"re":[7.8064456,66.361843,312.81969,-64.238999,-18.0204,-0.37986811,-0.0031567785,0.000001473784],"im":[17.480783,119.8754,-137.6768,-209.09643,7.6519729,0.84040024,0.025590449,0.00002584745]},"T5":{"re":[0.44415956,0.88142231,37.607405,19.585403,-9.2979622,0.11437579,0.0032430791,3.5854854e-7],"im":[0.51240734,4.6254465,25.885653,-53.015718,2.151314,0.32955637,0.0013169727,-1.0722558e-8]},"G5":{"re":[0.38015568,0.48567752,19.216109,106.28811,-12.877407,-0.33165645,-0.0029406683,0.00000100076],"im":[0.40643131,3.8616578,44.759493,-119.99684,2.5582786,0.56342183,0.018456344,0.000018786322]},"NR":{"re":[8.3116515,67.383503,434.21556,-302.47719,-16.536233,-0.36606677,-0.0031174474,0.0000014431002],"im":[18.943841,132.61591,-56.41798,-360.09347,10.697816,0.87912988,0.0267695,0.000027057339]},"U3":{"re":[7.8059602,66.189114,285.5854,121.28431,2.054281,-0.014961742,0.000039528609,0.0000018510371],"im":[17.480594,119.67262,-94.334252,-161.48392,46.495877,1.0037673,0.02587306,0.000025685603]},"U1n":{"re":[7.8045597,65.718011,291.08501,122.50688,41.630579,13.23068,0.09752055,0.000027019503],"im":[17.480198,119.40799,-70.93937,-132.444,-50.4661,6.1240386,0.36845926,0.0003715301]},"S26":{"re":[7.806025,66.212098,289.25767,109.68832,-11.303281,-0.072763858,-0.00038988787,0.0000018012191],"im":[17.480619,119.69962,-99.213431,-183.59692,44.130007,0.99976889,0.025881431,0.000025707748]}},"tian":{"G10":{"re":[8.5352634,4.1646308,0.019953976,-0.25403281,-0.038925122,-0.0012950747,-0.00005570582,-4.9593242e-7],"im":[-1.9468226,-3.8526011,-1.2402979,-0.28539289,0.013125614,0.0015854333,0.000040032528,-8.8978843e-7]},"T5":{"re":[10.890172,6.3637787,-0.31537955,-0.2393719,-0.033277294,-0.0018192533,-0.000074141174,-6.2309227e-7],"im":[-1.0225721,-5.6240893,-1.2199042,-0.19451645,0.0040006231,0.0014082321,0.0000442298,-0.0000011409592]},"G5":{"re":[11.331516,6.9231494,-0.33061604,-0.26869977,-0.036327263,-0.0014638672,-0.000060784621,-5.3096153e-7],"im":[-0.94832856,-5.7793391,-1.3597728,-0.20987235,0.009206055,0.0015424971,0.000041367765,-9.5831187e-7]},"NR":{"re":[25.956313,5.9903785,-0.42964857,-0.50829795,-0.036531329,-0.0012875549,-0.000057920916,-5.1960869e-7],"im":[-15.362032,-10.083027,-2.5515276,-0.21378742,0.019546479,0.0016764432,0.000042262114,-9.3103221e-7]},"U3":{"re":[8.5344902,4.1657401,0.33471271,0.066542837,-0.012192953,-0.00061793546,-0.00005139615,-5.1631693e-7],"im":[-1.9445332,-3.7818776,-1.1498439,-0.51978178,0.10014031,0.0021434078,0.000046215635,-9.3505083e-7]},"U1n":{"re":[8.5315817,4.2025315,0.50489594,0.13724582,0.089784449,0.026660851,-0.00031243967,-0.000005260622],"im":[-1.9404471,-3.6502492,-1.2029546,-0.46489624,-0.12837602,0.019731886,0.00092873229,-3.9950333e-8]},"S26":{"re":[8.5345934,4.1656692,0.2976558,-0.0060860231,-0.037969913,-0.00073796919,-0.000052058607,-5.135317e-7],"im":[-1.9448384,-3.7912406,-1.1706981,-0.52589757,0.088254024,0.0021012364,0.000045454802,-9.2907539e-7]}},"modes":{"G10":{"f":1906.2891,"sigma":-13986.155},"NR":{"f":2426.0639,"sigma":-4820.1986},"S26":{"f":6651.3332,"sigma":-1194.2802},"U3":{"f":6800.2645,"sigma":3726.731},"U1n":{"f":20482.614,"sigma":83043.569}},"f":[10,100,1000,3000,10000,30000,100000,1000000]};
    const PU = {
        gibson: P.gibson57ClassicNeck, texas: P.texasSpecialNeck,
    };
    const CASES = {
        G10: [PU.gibson, 10, {}], T5: [PU.texas, 5, {}], G5: [PU.gibson, 5, {}], NR: [PU.gibson, 10, { Rbc1: Infinity }],
        U3: [PU.gibson, 10, { Cstray: 3e-12 }], U1n: [PU.gibson, 10, { Cstray: 1e-12, Cbc2: 0 }], S26: [PU.gibson, 10, { Cstray: 2.6e-12 }],
    };
    const inputsOf = (k) => { const [pu, pos, x] = CASES[k]; return Object.assign({}, BASE, { Vt: 25.8648e-3, source: vol(pu, pos) }, x); };
    let wa = 0, wap = 0, wt = 0, wtp = 0;
    for (const k of Object.keys(CASES)) {
        const inp = inputsOf(k), r = E.evaluate(inp), p = E._acParams(r, inp);
        LT.f.forEach((f, i) => {
            const a = E._acPoint(p, f), lt = [LT.ac[k].re[i], LT.ac[k].im[i]];
            const d = 20 * Math.log10(Math.hypot(a.avr, a.avi) / Math.hypot(...lt)), dp = wrap((Math.atan2(a.avi, a.avr) - Math.atan2(lt[1], lt[0])) * 180 / Math.PI);
            wa = Math.max(wa, Math.abs(d)); wap = Math.max(wap, Math.abs(dp));
            check(Math.abs(d) < 0.01 && Math.abs(dp) < 0.05, k + ' AvS at ' + f + ' Hz: ' + d + ' dB, ' + dp + ' deg');
            const T = E._tianT(p, [0, 2 * Math.PI * f]).T, lT = [LT.tian[k].re[i], LT.tian[k].im[i]];
            const dt = 20 * Math.log10(Math.hypot(...T) / Math.hypot(...lT)), dtp = wrap((Math.atan2(T[1], T[0]) - Math.atan2(lT[1], lT[0])) * 180 / Math.PI);
            wt = Math.max(wt, Math.abs(dt)); wtp = Math.max(wtp, Math.abs(dtp));
            check(Math.abs(dt) < 0.01 && Math.abs(dtp) < 0.05, k + ' Tian T at ' + f + ' Hz: ' + dt + ' dB, ' + dtp + ' deg');
        });
        const st = E.stability(r, inp);
        if (LT.modes[k]) {
            const m = LT.modes[k], d = st.dominant;
            check(d && relErr(d.f, m.f) < 1e-3 && relErr(d.sigma, m.sigma) < 1e-2, k + ' dominant pole ' + JSON.stringify(d) + ' vs LTspice ' + JSON.stringify(m));
            check((st.nRhp > 0) === (m.sigma > 0), k + ' verdict: nRhp ' + st.nRhp + ', LTspice transient ' + (m.sigma > 0 ? 'grows' : 'decays'));
            console.log('  ' + k + ': ' + (st.stable ? '安定' : '不安定 (右半面 ' + st.nRhp + ')') + ', engine ' + d.f.toFixed(1) + ' Hz σ ' + d.sigma.toFixed(0) +
                ' /s | LTspice tran ' + m.f.toFixed(1) + ' Hz σ ' + m.sigma.toFixed(0) + ' /s');
        }
    }
    console.log('  worst: AvS ' + wa.toFixed(4) + ' dB / ' + wap.toFixed(3) + ' deg, Tian T ' + wt.toFixed(4) + ' dB / ' + wtp.toFixed(3) + ' deg');
    // The R_F-loop margin alone does not see U1n's instability (C_stray loop): all-loop F is needed
    const u1 = E.stability(inputsOf('U1n'));
    check(u1.nRhp === 2 && u1.loop.pm.every(q => q.deg > 0), 'U1n: unstable although every R_F-loop PM is positive');
}

// ---------------------------------------------------------------
section('5. Source model, presets, API forms, validation');
{
    // pot taper
    close(E._potFrac(10, 'A'), 1, 1e-15, 'A taper at 10');
    close(E._potFrac(5, 'A'), (Math.sqrt(32) - 1) / 31, 1e-15, 'A taper at 5');
    close(E._potFrac(5, 'B'), 0.5, 1e-15, 'B taper at 5');
    // pickup acSweep: reference is the sweep maximum
    const sw = E.acSweep(Object.assign({}, BASE, { source: P.gibson57ClassicNeck }), { n: 41 });
    check(sw.refSource === 'max' && sw.midbandDB === sw.maxDB, 'pickup acSweep reference = max');
    const sr = E.acSweep(BASE, { n: 41 });
    check(sr.refSource === 'midband', 'R_in acSweep reference = mid-band');
    // source {type:'r'} equals no source
    const a = E.stability(BASE), b = E.stability(Object.assign({}, BASE, { source: { type: 'r' } }));
    check(a.nRhp === b.nRhp && a.loop.T.dB.every((v, i) => v === b.loop.T.dB[i]), "source {type:'r'} = default");
    // result form
    const r = E.evaluate(Object.assign({}, BASE, { source: P.texasSpecialNeck }));
    const c = E.stability(r, Object.assign({}, BASE, { source: P.texasSpecialNeck }));
    const d = E.stability(Object.assign({}, BASE, { source: P.texasSpecialNeck }));
    check(c.nRhp === d.nRhp && c.loop.T.dB.every((v, i) => v === d.loop.T.dB[i]), 'stability(result, inputs) = stability(inputs)');
    // PNP mirror: identical small-signal network -> identical stability
    const pn = E.stability(Object.assign({}, BASE, { polarity: 'pnp', Vcc: -5.6, q1: QP, q2: QP, source: P.gibson57ClassicNeck }));
    const nn = E.stability(Object.assign({}, BASE, { source: P.gibson57ClassicNeck }));
    check(pn.nRhp === nn.nRhp && pn.loop.T.dB.every((v, i) => v === nn.loop.T.dB[i]) && pn.nyquist.re.every((v, i) => v === nn.nyquist.re[i]), 'PNP mirror: identical stability');
    // DC unaffected by the source
    check(E.evaluate(Object.assign({}, BASE, { source: P.gibson57ClassicNeck })).Ic2 === E.evaluate(BASE).Ic2, 'DC unaffected by source');
    // presets
    check(P.gibson57ClassicNeck.bleed.R === 680e3 && P.texasSpecialNeck.bleed === null && P.texasSpecialNeck.Cp === 127.35e-12, 'preset values');
    // validation
    const bad = [
        { source: { type: 'xyz' } }, { source: Object.assign({}, P.texasSpecialNeck, { Ls: 0 }) },
        { source: vol(P.texasSpecialNeck, 11) }, { source: Object.assign({}, P.texasSpecialNeck, { vol: { R: 250e3, pos: 5, taper: 'C' } }) },
        { Cstray: -1e-12 },
    ];
    for (const x of bad) {
        let msg = '';
        try { E.stability(Object.assign({}, BASE, x)); } catch (e) { msg = e.message; }
        check(JP.test(msg), 'Japanese error: ' + msg);
        console.log('  ' + msg);
    }
}

// ---------------------------------------------------------------
section('6. Large C_BC2: low-frequency oscillation of the R_F bias loop (source R_in)');
{
    // C_BC2 is AC-only, so the DC point is unchanged. Its Miller capacitance (x Q2's gain
    // C1 -> C2) adds a low-frequency pole at C1 to the lags already in the R_F loop
    // (E2 driving C_E2 + RV1, B1 loaded by C_in + R_in). With ~21 dB of low-frequency
    // loop gain, three lags give a negative R_F-loop phase margin: a slow oscillation
    // ("motorboating"). Removing C_E2 or C_in from the loop removes it.
    // LTspice: .tran with a 10 pA kick into B1, plotwinsize=0, matrix-pencil fit of V(c2).
    //   C_BC2 10 nF : grows,  45.532 Hz, sigma +5.391 /s (window 0.80-2.64 s)
    //   C_BC2 100 nF: grows,  16.839 Hz, sigma +7.267 /s (window 0.67-2.21 s)
    //   C_BC2 3 nF  : decays, 78.874 Hz, sigma -43.8 /s  (window 10-60 ms; fit spread ~3 %)
    // LTspice .op is identical in all three (V_C2 = 3.05173 V).
    const LTLF = { '1e-8': { f: 45.532, sigma: 5.391 }, '1e-7': { f: 16.839, sigma: 7.267 }, '3e-9': { f: 78.874, sigma: -43.8, sigTol: 0.06 } };
    const d0 = E.evaluate(BASE);
    for (const cbc2 of [3e-9, 10e-9, 100e-9]) {
        const inp = Object.assign({}, BASE, { Cbc2: cbc2, Vt: 25.8648e-3 });
        const st = E.stability(inp), m = LTLF[String(cbc2)], d = st.dominant;
        check(st.result.Ic2 === E.evaluate(Object.assign({}, BASE, { Vt: 25.8648e-3 })).Ic2, 'C_BC2 ' + cbc2 + ': DC unchanged');
        check((st.nRhp > 0) === (m.sigma > 0), 'C_BC2 ' + cbc2 + ': verdict nRhp ' + st.nRhp + ' vs LTspice ' + (m.sigma > 0 ? 'grows' : 'decays'));
        check(relErr(d.f, m.f) < 1e-3 && relErr(d.sigma, m.sigma) < (m.sigTol || 1e-2), 'C_BC2 ' + cbc2 + ': pole ' + d.f + ' Hz, ' + d.sigma + ' /s vs LTspice ' + m.f + ', ' + m.sigma);
        console.log('  C_BC2 ' + (cbc2 * 1e9) + ' nF: ' + (st.stable ? '安定' : '不安定 (右半面 ' + st.nRhp + ')') + ', engine ' + d.f.toFixed(3) + ' Hz σ ' + d.sigma.toFixed(3) +
            ' /s | LTspice ' + m.f + ' Hz σ ' + m.sigma + ' /s; R_F loop PM ' + st.loop.pm.map(q => q.deg.toFixed(1) + '° at ' + q.f.toFixed(1) + ' Hz').join(', '));
    }
    const u = E.stability(Object.assign({}, BASE, { Cbc2: 10e-9 }));
    check(u.nRhp === 2 && u.loop.pm.some(q => q.deg < 0), '10 nF: R_F loop phase margin negative');
    check(E.stability(Object.assign({}, BASE, { Cbc2: 10e-9, Ce2: Infinity })).nRhp === 0, '10 nF with C_E2 shorted (E2 grounded, no R_F loop gain): stable');
    check(E.stability(Object.assign({}, BASE, { Cbc2: 10e-9, Cin: Infinity })).nRhp === 0, '10 nF with C_in shorted (one lag fewer): stable');
    check(E.stability(Object.assign({}, BASE, { Cbc2: 100e-9, RV1: 100 })).nRhp === 2, '100 nF, RV1 100 Ω: unstable');
    check(d0.Ic2 > 0 && E.stability(BASE).nRhp === 0, 'default 47 pF: stable');
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);

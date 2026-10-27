// Run: node tests/bode.test.js   (no dependencies)
'use strict';

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

// 2SC8888-W full .model (index.html default), incl. capacitances
const Q = { Is: 25.44e-15, Bf: 380.43, Nf: 1.002, Vaf: 125.5, Ikf: 0.385, Ise: 4.88e-15, Ne: 1.35, Br: 8.22, Nr: 1.01,
    Var: 18.5, Ikr: 0.18, Isc: 32.5e-15, Nc: 1.25, Rb: 12.8, Re: 0.185, Rc: 0.88,
    Cje: 15.32e-12, Vje: 0.75, Mje: 0.34, Cjc: 5.12e-12, Vjc: 0.55, Mjc: 0.32, Fc: 0.5, Tf: 445e-12, Tr: 65e-9 };
const VT27 = 25.8648e-3;   // kT/q at 300.15 K (.temp 27)

// LTspice reference (.ac, full .model incl. IRB/RBM/XTF/VTF/ITF, .temp 27, tnom 27).
// Netlist: Vs -- Rin -- Cin -- b1; CE2 e2-x, RV1 x-0; Cout c2-out, RV2 out-0.
// dB/phase: V(out)/Vs; zin: V(nin)/I(Rin) (looking into Cin).
// midbandDB: LTspice with Cin = CE2 = Cout = 1 F at 10 Hz (coupling caps shorted).
// f3dB: outermost crossings of midbandDB - 3.01 dB in .ac dec 200 10 1meg; maxDB/fMax: peak.
// P, P2: Cin = 100 nF, physical LF peaking (+5.0 / +8.7 dB) in the R_F / C_E2 / C_in loop.
const LT = {"A":{"case":{"Vcc":9,"Rf":100000,"RV2":500000,"Rin":1000,"Cin":0.000001,"Ce2":0.00002,"Cout":1e-8,"R1":33000,"R2":8200,"R3":1100,"RV1":1},"f":[10,30,100,300,1000,3000,10000,30000,100000,300000,1000000],"dB":[27.4522,52.05971,74.85055,83.17053,83.49933,83.4594,82.96914,80.09284,71.95616,62.67983,52.11437],"phase":[-149.1305,-163.4239,135.4951,48.74113,11.90656,-1.639041,-18.76294,-47.45942,-75.69181,-88.22019,-99.92723],"zin":[15858.7,5135.434,1061.229,1434.507,5932.178,14111.59,17392.78,12257.77,9780.518,8323.548,4332.297],"zinPhase":[-88.54559,-85.48579,-66.51897,65.92201,67.28664,40.381,-1.759222,-18.13003,-18.23479,-33.28811,-63.93528],"f3dB":{"low":156.549,"high":27783.26},"midbandDB":83.45366,"maxDB":83.4996,"fMax":1083.927},"B":{"case":{"Vcc":9,"Rf":100000,"RV2":500000,"Rin":1000,"Cin":0.000001,"Ce2":0.00002,"Cout":1e-8,"R1":150000,"R2":8200,"R3":1100,"RV1":1000},"f":[10,30,100,300,1000,3000,10000,30000,100000,300000,1000000],"dB":[27.76571,45.39932,55.95585,58.64508,59.05125,59.0838,59.03475,58.59272,55.36645,47.86894,37.61367],"phase":[173.9853,126.0552,62.666,23.79498,6.672563,0.417229,-6.030004,-19.3835,-50.48653,-77.58269,-96.90219],"zin":[15843.73,5306.369,1722.558,869.0052,709.809,695.6625,711.9332,853.9695,1777.491,4213.013,4280.822],"zinPhase":[-87.72631,-82.59425,-66.2375,-36.88711,-11.64449,-0.7437512,10.46727,30.03097,48.95592,28.38922,-36.26241],"f3dB":{"low":102.554,"high":85924.36},"midbandDB":59.08658,"maxDB":59.08382,"fMax":2917.427},"C":{"case":{"Vcc":9,"Rf":100000,"RV2":500000,"Rin":1000,"Cin":0.000001,"Ce2":0.00002,"Cout":1e-8,"R1":150000,"R2":8200,"R3":1100,"RV1":1,"Rbc1":1000000,"Rbc2":220000},"f":[10,30,100,300,1000,3000,10000,30000,100000,300000,1000000],"dB":[26.85954,54.80946,54.32496,54.08645,54.06217,54.05959,54.05385,54.00581,53.49382,50.5266,42.20266],"phase":[-156.7612,126.0526,25.46143,8.304322,2.283593,0.1619005,-1.995334,-6.631275,-21.53266,-51.53614,-86.07626],"zin":[14416.71,2313.843,14073.86,31719.72,40631.93,41781.27,41656.9,39557.81,27656.36,13612.53,5275.694],"zinPhase":[-83.15096,-14.62622,59.57252,37.34057,12.82391,2.718262,-4.766642,-17.22058,-43.09332,-61.04103,-76.5044],"f3dB":{"low":25.06798,"high":267746.3},"midbandDB":54.06013,"maxDB":56.06911,"fMax":36.72823},"D":{"case":{"Vcc":9,"Rf":100000,"RV2":500000,"Rin":1000,"Cin":0.000001,"Ce2":0.00002,"Cout":1e-8,"R1":150000,"R2":8200,"R3":1100,"RV1":1,"Rbc1":1000000,"Rbc2":220000,"Cbc1":1e-10,"Cbc2":2.2e-10},"f":[10,30,100,300,1000,3000,10000,30000,100000,300000,1000000],"dB":[26.86261,54.89325,54.33591,54.06564,53.73618,51.70388,44.50382,35.40786,24.97523,15.19052,2.726454],"phase":[-156.7967,125.7077,23.75128,3.453155,-13.41163,-39.78306,-71.04863,-85.36055,-95.09341,-110.4018,-151.3774],"zin":[14413.22,2284.572,14209.73,33118.31,42737.52,39738.31,34162.55,25568.31,10644.38,3703.112,1117.502],"zinPhase":[-83.16151,-14.3895,60.62647,37.88445,8.411653,-7.888592,-20.14721,-44.20993,-72.43132,-83.49182,-86.40629],"f3dB":{"low":25.01536,"high":3532.913},"midbandDB":54.06009,"maxDB":56.14086,"fMax":36.72823},"P":{"case":{"Vcc":9,"Rf":100000,"RV2":500000,"Rin":1000,"Cin":1e-7,"Ce2":0.00002,"Cout":1e-8,"R1":33000,"R2":8200,"R3":1100,"RV1":1},"f":[10,30,100,300,1000,3000,10000,30000,100000,300000,1000000],"dB":[7.455247,32.09269,55.85118,77.81285,85.2657,83.62928,82.96691,80.08373,71.95285,62.67758,52.11232],"phase":[-144.58,-149.6074,-174.1945,153.7192,20.05125,-0.1599762,-18.31701,-47.26138,-75.61856,-88.19434,-99.91713],"zin":[159093.5,52867.53,15303.14,3514.034,4643.921,13807.05,17397.77,12272.72,9785.01,8326.169,4333.583],"zinPhase":[-89.85504,-89.56195,-88.41666,-80.41292,60.44664,38.87152,-2.230733,-18.34187,-18.31445,-33.31557,-63.9436],"f3dB":{"low":335.4187,"high":27722.84},"midbandDB":83.45366,"maxDB":88.43986,"fMax":537.0318},"P2":{"case":{"Vcc":9,"Rf":100000,"RV2":500000,"Rin":1000,"Cin":1e-7,"Ce2":0.00002,"Cout":1e-8,"R1":150000,"R2":8200,"R3":1100,"RV1":1},"f":[10,30,100,300,1000,3000,10000,30000,100000,300000,1000000],"dB":[7.521853,32.2271,56.81503,81.04477,73.56526,72.97739,72.22555,68.60565,59.8961,50.53712,39.98784],"phase":[-144.695,-149.9723,-176.3096,60.95789,4.93569,-5.189858,-23.16592,-52.96832,-78.25356,-89.01093,-99.8209],"zin":[158937.9,52400.92,13755.35,1781.956,18975.58,41106.14,44557.99,32862.4,25947.32,15874.36,5610.234],"zinPhase":[-89.81127,-89.41896,-87.41822,39.09031,62.17991,31.16667,-5.759789,-19.74338,-31.21798,-57.77203,-78.97862],"f3dB":{"low":176.3223,"high":22778.64},"midbandDB":72.97816,"maxDB":81.6604,"fMax":275.4229}};

function inputsFor(c) {
    return Object.assign({ mode: 'reverse', Vt: VT27, q1: Q, q2: Q, Rbc1: Infinity, Rbc2: Infinity }, c);
}
const at = (r, inp, f) => E.acSweep(r, inp, { fStart: f, fStop: f * 1.000001, n: 2 });

// ---------------------------------------------------------------
section('1. acSweep vs LTspice .ac (A: R1 33k; B: R1 150k RV1 1k; C: + R_BC1 1M, R_BC2 220k; D: C + C_BC1 100p, C_BC2 220p; P/P2: Cin 100n)');
{
    // Tolerances. The engine's DC omits ohmic RB/RE/RC (LTspice includes them) and uses a
    // constant RB in AC (LTspice: IRB/RBM modulation); XTF/VTF/ITF are ignored. Observed
    // differences: <= 0.006 dB, <= 0.023 deg, Zin <= 0.061 %, f3dB <= 0.06 %. Tolerances are
    // set at about 3x the observed values so that the test catches real modelling errors
    // (a missing capacitance or a wrong node shifts f3dB_high by percent, not 0.1 %).
    const TOL = { dB: 0.02, deg: 0.1, zin: 2e-3, f3: 2e-3 };
    const worst = { dB: 0, deg: 0, zin: 0, zdeg: 0, f3: 0 };
    for (const name of Object.keys(LT)) {
        const L = LT[name], inp = inputsFor(L.case);
        const r = E.evaluate(inp);
        check(r.q1.region === 'active' && r.q2.region === 'active', name + ': both active');
        L.f.forEach((f, i) => {
            const s = at(r, inp, f);
            const dd = s.AvS.dB[0] - L.dB[i], dp = wrap(s.AvS.phaseDeg[0] - L.phase[i]);
            const dz = relErr(s.Zin.mag[0], L.zin[i]), dzp = wrap(s.Zin.phaseDeg[0] - L.zinPhase[i]);
            worst.dB = Math.max(worst.dB, Math.abs(dd)); worst.deg = Math.max(worst.deg, Math.abs(dp));
            worst.zin = Math.max(worst.zin, dz); worst.zdeg = Math.max(worst.zdeg, Math.abs(dzp));
            check(Math.abs(dd) < TOL.dB, name + ' ' + f + ' Hz |AvS| dB diff ' + dd);
            check(Math.abs(dp) < TOL.deg, name + ' ' + f + ' Hz phase diff ' + dp);
            check(dz < TOL.zin, name + ' ' + f + ' Hz |Zin| rel diff ' + dz);
            check(Math.abs(dzp) < TOL.deg, name + ' ' + f + ' Hz Zin phase diff ' + dzp);
        });
        const sw = E.acSweep(r, inp, { fStart: 10, fStop: 1e6, n: 1001 });   // same grid as .ac dec 200
        const el = relErr(sw.f3dB.low, L.f3dB.low), eh = relErr(sw.f3dB.high, L.f3dB.high);
        worst.f3 = Math.max(worst.f3, el, eh);
        check(el < TOL.f3 && eh < TOL.f3, name + ' f3dB ' + JSON.stringify(sw.f3dB) + ' vs ' + JSON.stringify(L.f3dB));
        check(Math.abs(sw.midbandDB - L.midbandDB) < TOL.dB, name + ' mid-band reference dB');
        check(sw.f3dB.lowFlag === null && sw.f3dB.highFlag === null, name + ' no flags');
        const lp = L.maxDB - L.midbandDB;
        if (lp > 1) {
            check(sw.peak && Math.abs(sw.peak.dB - lp) < TOL.dB && relErr(sw.peak.f, L.fMax) < 0.02, name + ' peak ' + JSON.stringify(sw.peak) + ' vs ' + lp + ' at ' + L.fMax);
        } else check(sw.peak === null, name + ' no peak reported');
        console.log('  ' + name + ': mid-band ' + sw.midbandDB.toFixed(3) + ' dB (LTspice ' + L.midbandDB.toFixed(3) + '), f3dB ' +
            sw.f3dB.low.toFixed(2) + ' Hz / ' + sw.f3dB.high.toFixed(0) + ' Hz (LTspice ' + L.f3dB.low.toFixed(2) + ' / ' + L.f3dB.high.toFixed(0) + ')' +
            (sw.peak ? ', peak +' + sw.peak.dB.toFixed(2) + ' dB at ' + sw.peak.f.toFixed(0) + ' Hz' : ''));
    }
    console.log('  worst over 66 points: |AvS| ' + worst.dB.toFixed(4) + ' dB, phase ' + worst.deg.toFixed(3) + ' deg, |Zin| ' +
        (100 * worst.zin).toFixed(3) + ' %, Zin phase ' + worst.zdeg.toFixed(3) + ' deg, f3dB ' + (100 * worst.f3).toFixed(3) + ' %');
}

// ---------------------------------------------------------------
section('2. Consistency with the mid-band real analysis and API forms');
{
    const inp = inputsFor({ Vcc: 9, Rf: 100e3, RV1: 1, RV2: 500e3, Rin: 1000, R1: 33e3, R2: 8.2e3, R3: 1.1e3 });
    const r = E.evaluate(inp);
    // All coupling caps shorted and a low frequency: equals analyzeAC (transistor caps negligible)
    const s = E.acSweep(Object.assign({}, inp, { Cin: Infinity, Ce2: Infinity, Cout: Infinity }), { fStart: 1, fStop: 2, n: 2 });
    close(s.AvS.mag[0], r.ac.AvS, 1e-8, 'AvS at 1 Hz with shorted caps = mid-band AvS');
    close(s.Zin.mag[0], r.ac.Zin, 1e-8, 'Zin at 1 Hz with shorted caps = mid-band Zin');
    // ~0 deg: the junction capacitances still add a few millidegrees of lag at 1 Hz
    check(Math.abs(s.AvS.phaseDeg[0]) < 0.01, 'phase ~ 0 (non-inverting) ' + s.AvS.phaseDeg[0]);
    // Rin = 0 with Cin shorted: B1 driven directly, AvS = Av
    const s0 = E.acSweep(Object.assign({}, inp, { Rin: 0, Cin: Infinity, Ce2: Infinity, Cout: Infinity }), { fStart: 1, fStop: 2, n: 2 });
    close(s0.AvS.mag[0], r.ac.Av, 1e-8, 'Rin 0, Cin ∞: AvS = Av');
    close(s0.Zin.mag[0], r.ac.Zin, 1e-8, 'Rin 0, Cin ∞: Zin = mid-band Zin');
    // acSweep(inputs) and acSweep(result, inputs) agree
    const a = E.acSweep(inp, { n: 21 }), b = E.acSweep(r, inp, { n: 21 });
    check(a.AvS.dB.every((v, i) => v === b.AvS.dB[i]), 'acSweep(inputs) = acSweep(result, inputs)');
    check(a.f.length === 21 && a.f[0] === 10 && Math.abs(a.f[20] - 1e6) < 1e-6, 'default range 10 Hz - 1 MHz');
    check(E.acSweep(inp).f.length === 200, 'default n = 200');
    // phase near 0 at the mid-band peak
    const k = a.AvS.dB.indexOf(Math.max.apply(null, a.AvS.dB));
    check(Math.abs(a.AvS.phaseDeg[k]) < 45, 'phase at mid-band peak ' + a.AvS.phaseDeg[k]);
    // C_BC = 0 is the same as absent
    const c0 = E.acSweep(Object.assign({}, inp, { Cbc1: 0, Cbc2: 0 }), { n: 21 });
    check(c0.AvS.dB.every((v, i) => v === a.AvS.dB[i]), 'Cbc = 0 equals absent');
    // C_BC2 lowers the upper -3 dB frequency; DC and mid-band real analysis unaffected
    const cb = E.acSweep(Object.assign({}, inp, { Cbc2: 100e-12 }), { n: 201 });
    check(cb.f3dB.high < a.f3dB.high * 0.5, 'C_BC2 100p lowers f3dB_high: ' + a.f3dB.high.toFixed(0) + ' -> ' + cb.f3dB.high.toFixed(0));
    check(cb.result.Ic2 === r.Ic2 && cb.result.ac.Av === r.ac.Av, 'C_BC does not change DC or mid-band Av');
    // no roll-off in range -> null
    const nar = E.acSweep(inp, { fStart: 2e3, fStop: 4e3, n: 11 });
    check(nar.f3dB.low === null && nar.f3dB.high === null && nar.f3dB.lowFlag === '<fStart' && nar.f3dB.highFlag === '>fStop',
        'f3dB null with flags when the corners are outside the range ' + JSON.stringify(nar.f3dB));
    check(nar.midbandDB === r.ac.AvSdB, 'midbandDB = real mid-band AvSdB');
    // model without capacitances: no HF roll-off from the transistors
    const Q0 = Object.assign({}, Q, { Cje: 0, Cjc: 0, Tf: 0, Tr: 0 });
    const s1 = E.acSweep(Object.assign({}, inp, { q1: Q0, q2: Q0 }), { fStart: 1e4, fStop: 1e7, n: 31 });
    check(s1.f3dB.high === null && s1.f3dB.highFlag === '>fStop', 'no transistor caps -> no HF -3 dB point (' + JSON.stringify(s1.f3dB) + ')');
}

// ---------------------------------------------------------------
section('3. Capacitances at the operating point (SPICE formulas)');
{
    const inp = inputsFor({ Vcc: 9, Rf: 100e3, RV1: 1, RV2: 500e3, R1: 33e3, R2: 8.2e3, R3: 1.1e3 });
    const r = E.evaluate(inp);
    for (const [name, q] of [['Q1', r.q1], ['Q2', r.q2]]) {
        const vbe = q.Vbe, vbc = q.Vbc;
        const cje = vbe < 0.5 * Q.Vje ? Q.Cje * Math.pow(1 - vbe / Q.Vje, -Q.Mje)
            : Q.Cje / Math.pow(0.5, 1 + Q.Mje) * (1 - 0.5 * (1 + Q.Mje) + Q.Mje * vbe / Q.Vje);
        const cjc = Q.Cjc * Math.pow(1 - vbc / Q.Vjc, -Q.Mjc);
        close(q.caps.Cje, cje, 1e-12, name + ' Cje');
        close(q.caps.Cjc, cjc, 1e-12, name + ' Cjc');
        check(q.caps.Cdiff > 0 && relErr(q.caps.Cdiff, Q.Tf * q.gm) < 0.02, name + ' Cdiff ~ TF gm (' + q.caps.Cdiff + ' vs ' + Q.Tf * q.gm + ')');
        check(q.caps.Cdiffr < 1e-20, name + ' TR diffusion negligible in active region');
        console.log('  ' + name + ': Vbe ' + vbe.toFixed(4) + ' V, Cje ' + (q.caps.Cje * 1e12).toFixed(2) + ' pF, Vbc ' + vbc.toFixed(3) +
            ' V, Cjc ' + (q.caps.Cjc * 1e12).toFixed(3) + ' pF, TF gm ' + (q.caps.Cdiff * 1e12).toFixed(2) + ' pF');
    }
    // saturated Q2: TR diffusion capacitance becomes significant
    const rs = E.evaluate(inputsFor({ Vcc: 9, Rf: 100e3, RV1: 1, RV2: 500e3, R1: 33e3, R2: 8.2e3, R3: 390 }));
    check(rs.q2.region === 'saturation' && rs.q2.caps.Cdiffr > 1e-9, 'saturated Q2: TR diffusion ' + rs.q2.caps.Cdiffr);
    const ss = E.acSweep(rs, inputsFor({ Vcc: 9, Rf: 100e3, RV1: 1, RV2: 500e3, R1: 33e3, R2: 8.2e3, R3: 390 }), { n: 41 });
    check(ss.AvS.dB.every(isFinite) && ss.Zin.mag.every(isFinite), 'sweep finite in saturation');
}

// ---------------------------------------------------------------
section('4. Validation');
{
    const inp = inputsFor({ Vcc: 9, Rf: 100e3, RV1: 1, RV2: 500e3, R1: 33e3, R2: 8.2e3, R3: 1.1e3 });
    const bad = [
        [{ Cin: -1 }, {}], [{ Cout: 0 }, {}], [{ Ce2: NaN }, {}], [{ Cbc1: -1e-12 }, {}],
        [{}, { fStart: 0 }], [{}, { fStart: 1e3, fStop: 10 }], [{ RV1: 0 }, {}],
    ];
    for (const [x, o] of bad) {
        let msg = '';
        try { E.acSweep(Object.assign({}, inp, x), o); } catch (e) { msg = e.message; }
        check(/[぀-ヿ一-龯]/.test(msg), 'Japanese error for ' + JSON.stringify(x) + JSON.stringify(o) + ': ' + msg);
        console.log('  ' + msg);
    }
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);

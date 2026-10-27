// Run: node tests/fit.test.js   (no dependencies)
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
const pct = (a, b) => ((a / b - 1) * 100);
const fp = (v) => (v >= 0 ? '+' : '') + v.toFixed(2) + ' %';
const JP = /[぀-ヿ一-龯]/;

function rng(seed) {
    return function () {
        seed |= 0; seed = seed + 0x6D2B79F5 | 0;
        let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
        t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
        return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
}
const rand = rng(2024);

// True model: 2SC8888-W (index.html default .model), DC parameters
const TRUE = { IS: 25.44e-15, BF: 380.43, NF: 1.002, VAF: 125.5, IKF: 0.385, ISE: 4.88e-15, NE: 1.35,
    BR: 8.22, NR: 1.01, VAR: 18.5, IKR: 0.18, ISC: 32.5e-15, NC: 1.25 };
const Vt = 0.02585;
const TP = F.fullParams(TRUE);
const TENG = { Is: TP.IS, Bf: TP.BF, Nf: TP.NF, Ise: TP.ISE, Ne: TP.NE, Vaf: TP.VAF, Br: TP.BR, Nr: TP.NR,
    Isc: TP.ISC, Nc: TP.NC, Var: TP.VAR, Ikf: TP.IKF, Ikr: TP.IKR };
// Base model handed to the fitter: everything the fitter never estimates
const BASE_NONFIT = { BR: 8.22, NR: 1.01, VAR: 18.5, IKR: 0.18, ISC: 32.5e-15, NC: 1.25, IKF: 0.385 };

// Synthesize a measurement at given IB and VCE from the true model
function point(Ib, Vce) {
    let lo = 0.1, hi = 1.1;
    for (let i = 0; i < 200; i++) {
        const m = 0.5 * (lo + hi);
        if (E.gpDC(m, m - Vce, TENG, Vt, 0).Ib < Ib) lo = m; else hi = m;
    }
    const v = 0.5 * (lo + hi), d = E.gpDC(v, v - Vce, TENG, Vt, 0);
    return { Ib: d.Ib, Ic: d.Ic, Vbe: v, Vce: Vce };
}
function noisy(p) {
    return { Ib: p.Ib * (1 + 0.02 * (rand() - 0.5)), Ic: p.Ic * (1 + 0.02 * (rand() - 0.5)),
        Vbe: p.Vbe + 1e-3 * (rand() - 0.5), Vce: p.Vce };
}

// Circuit check: reverse solution of the Fuzz Face with a given model
const CIRCUITS = [
    ['R1 33k R2 8.2k R3 1.1k', { R1: 33e3, R2: 8.2e3, R3: 1.1e3 }],
    ['R1 150k R2 8.2k R3 1.1k', { R1: 150e3, R2: 8.2e3, R3: 1.1e3 }],
    ['R1 100k R2 10k R3 470', { R1: 100e3, R2: 10e3, R3: 470 }],
];
function circuit(q, x) {
    return E.evaluate(Object.assign({ mode: 'reverse', Vcc: 9, Rf: 100e3, Vt: Vt, RV1: 1, RV2: 500e3, q1: q, q2: q }, x));
}
const TRUE_RES = CIRCUITS.map(([, x]) => circuit(TENG, x));
function circuitErr(fitRes) {
    return CIRCUITS.map(([, x], i) => {
        const r = circuit(fitRes.engineParams, x);
        return [pct(r.Ic1, TRUE_RES[i].Ic1), pct(r.Ic2, TRUE_RES[i].Ic2)];
    });
}
function showCircuit(label, errs) {
    console.log('  circuit (' + label + '): ' + errs.map((e, i) => CIRCUITS[i][0] + ': IC1 ' + fp(e[0]) + ', IC2 ' + fp(e[1])).join(' | '));
}
const maxAbs = (errs) => Math.max.apply(null, errs.map(e => Math.max(Math.abs(e[0]), Math.abs(e[1]))));

const P1u = point(1e-6, 5), P10u = point(10e-6, 5), P100u = point(100e-6, 5);
console.log('Synthetic points (2SC8888-W, VCE 5 V):');
for (const p of [P1u, P10u, P100u]) console.log('  IB ' + p.Ib.toExponential(2) + ' A, IC ' + p.Ic.toExponential(4) + ' A, VBE ' + p.Vbe.toFixed(5) + ' V, beta ' + (p.Ic / p.Ib).toFixed(1));

// ---------------------------------------------------------------
section('1. Two points (IB 1 uA, 10 uA): free IS, NF, BF, ISE');
{
    // (a) NE and the non-fitted parameters known from the base model: exactly determined
    const a = F.fit([P1u, P10u], { Vt, base: Object.assign({ VAF: 125.5, NE: 1.35 }, BASE_NONFIT) });
    check(a.free.join() === 'IS,BF,NF,ISE', 'auto free set ' + a.free);
    for (const k of ['IS', 'NF', 'BF', 'ISE']) close(a.params[k], TRUE[k], 1e-6, '(a) ' + k);
    check(a.converged && a.rms < 1e-10, '(a) converged, rms ' + a.rms);
    console.log('  (a) NE, VAF and BR.. from base: exact recovery, rms ' + a.rms.toExponential(1) + ', ' + a.iterations + ' iterations');
    console.log('  model: ' + a.model);
    showCircuit('a', circuitErr(a));
    check(maxAbs(circuitErr(a)) < 1e-4, '(a) circuit IC within 1e-4 %');

    // (b) NE defaults to 1.5: IS, NF still exact (IC does not depend on NE), BF/ISE biased
    const b = F.fit([P1u, P10u], { Vt, base: Object.assign({ VAF: 125.5 }, BASE_NONFIT) });
    close(b.params.IS, TRUE.IS, 1e-6, '(b) IS');
    close(b.params.NF, TRUE.NF, 1e-6, '(b) NF');
    console.log('  (b) NE fixed 1.5 (true 1.35): IS ' + fp(pct(b.params.IS, TRUE.IS)) + ', NF ' + fp(pct(b.params.NF, TRUE.NF)) +
        ', BF ' + fp(pct(b.params.BF, TRUE.BF)) + ', ISE ' + fp(pct(b.params.ISE, TRUE.ISE)) + ', rms ' + b.rms.toExponential(1));
    const eb = circuitErr(b);
    showCircuit('b', eb);
    check(maxAbs(eb) < 2, '(b) circuit IC within 2 %');

    // (c) no base model at all: VAF = ∞, BR = 1, ISC = 0, IKF = ∞
    const c = F.fit([P1u, P10u], { Vt });
    console.log('  (c) no base model: IS ' + fp(pct(c.params.IS, TRUE.IS)) + ', NF ' + fp(pct(c.params.NF, TRUE.NF)) +
        ', BF ' + fp(pct(c.params.BF, TRUE.BF)) + ', ISE ' + fp(pct(c.params.ISE, TRUE.ISE)) + ', rms ' + c.rms.toExponential(1));
    const ec = circuitErr(c);
    showCircuit('c', ec);
    check(maxAbs(ec) < 5, '(c) circuit IC within 5 %');
}

// ---------------------------------------------------------------
section('2. Three points (IB 1, 10, 100 uA): + NE');
{
    const r = F.fit([P1u, P10u, P100u], { Vt, free: ['IS', 'BF', 'NF', 'ISE', 'NE'], base: Object.assign({ VAF: 125.5 }, BASE_NONFIT) });
    check(r.free.join() === 'IS,BF,NF,ISE,NE', 'auto free set ' + r.free);
    for (const k of ['IS', 'NF', 'BF', 'ISE', 'NE']) close(r.params[k], TRUE[k], 1e-6, k);
    console.log('  exact recovery of IS, NF, BF, ISE, NE: rms ' + r.rms.toExponential(1) + ', ' + r.iterations + ' iterations');
    // IKF matters at 100 uA base current (IC ~ 30 mA): without it the fit is biased
    const r2 = F.fit([P1u, P10u, P100u], { Vt, free: ['IS', 'BF', 'NF', 'ISE', 'NE'], base: { VAF: 125.5, BR: 8.22, NR: 1.01, ISC: 32.5e-15, NC: 1.25 } });
    console.log('  without IKF in base: IS ' + fp(pct(r2.params.IS, TRUE.IS)) + ', NF ' + fp(pct(r2.params.NF, TRUE.NF)) + ', BF ' + fp(pct(r2.params.BF, TRUE.BF)) +
        ', ISE ' + fp(pct(r2.params.ISE, TRUE.ISE)) + ', NE ' + fp(pct(r2.params.NE, TRUE.NE)) + ', rms ' + r2.rms.toExponential(2));
    showCircuit('no IKF', circuitErr(r2));
}

// ---------------------------------------------------------------
section('3. VCE pair (IB 10 uA at VCE 2 V and 8 V): + VAF');
{
    const pts = [P1u, point(10e-6, 2), point(10e-6, 8), P100u];
    const r = F.fit(pts, { Vt, free: ['IS', 'BF', 'NF', 'ISE', 'NE', 'VAF'], base: BASE_NONFIT });
    check(r.free.indexOf('VAF') >= 0, 'VAF selected');
    for (const k of ['IS', 'NF', 'BF', 'ISE', 'NE', 'VAF']) close(r.params[k], TRUE[k], 1e-6, k);
    console.log('  exact recovery incl. VAF = ' + r.params.VAF.toFixed(3) + ' V, rms ' + r.rms.toExponential(1));
    const r2 = F.fit([point(10e-6, 2), point(10e-6, 8)], { Vt, base: BASE_NONFIT });
    console.log('  2 points at one IB: free ' + r2.free + ', VAF ' + r2.params.VAF.toFixed(2) + ' V (true 125.5)');
    close(r2.params.VAF, 125.5, 1e-6, 'VAF from a VCE pair alone');
}

// ---------------------------------------------------------------
section('4. Noise (VBE ±0.5 mV, currents ±1 %, uniform), 200 trials');
{
    function spread(name, cfg) {
        const vals = {}, circ = [];
        for (let t = 0; t < 200; t++) {
            const r = F.fit(cfg.pts().map(noisy), { Vt, base: cfg.base });
            for (const k of r.free) (vals[k] = vals[k] || []).push(pct(r.params[k], TRUE[k]));
            circ.push(circuitErr(r).map(e => e[1]));   // IC2 error per circuit
        }
        const q = (a, p) => { const s = a.slice().sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
        console.log('  ' + name + ' (5th / 50th / 95th percentile of the error):');
        for (const k of Object.keys(vals)) console.log('    ' + k.padEnd(4) + fp(q(vals[k], 0.05)) + ' / ' + fp(q(vals[k], 0.5)) + ' / ' + fp(q(vals[k], 0.95)));
        CIRCUITS.forEach(([lab], i) => {
            const e = circ.map(c => c[i]);
            console.log('    IC2 ' + lab + ': ' + fp(q(e, 0.05)) + ' / ' + fp(q(e, 0.5)) + ' / ' + fp(q(e, 0.95)));
        });
        return { vals, circ, q };
    }
    const s2 = spread('2 points, NE from base', { pts: () => [P1u, P10u], base: Object.assign({ VAF: 125.5, NE: 1.35 }, BASE_NONFIT) });
    const s3 = spread('3 points', { pts: () => [P1u, P10u, P100u], base: Object.assign({ VAF: 125.5 }, BASE_NONFIT) });
    const worstIc2 = Math.max.apply(null, s2.circ.map(c => Math.max.apply(null, c.map(Math.abs))));
    console.log('  worst |IC2 error| over 200 two-point trials: ' + worstIc2.toFixed(2) + ' %');
    check(worstIc2 < 10, 'noisy two-point fits keep circuit IC2 within 10 %');
}

// ---------------------------------------------------------------
section('5. Single point (IB 10 uA)');
{
    const r = F.fit([P10u], { Vt });
    check(r.free.join() === 'IS,BF', 'free IS, BF');
    check(r.params.NF === 1 && r.params.ISE === 0, 'NF = 1, ISE = 0 fixed');
    close(r.points[0].Ic_model, P10u.Ic, 1e-10, 'reproduces IC');
    close(r.points[0].Ib_model, P10u.Ib, 1e-10, 'reproduces IB');
    check(Math.abs(r.points[0].dVbe) < 1e-9, 'dVbe ~ 0');
    console.log('  IS ' + fp(pct(r.params.IS, TRUE.IS)) + ', BF ' + fp(pct(r.params.BF, TRUE.BF)) + ' (beta at that point; ISE and NF absorbed)');
    const e = circuitErr(r);
    showCircuit('1 point, no base', e);
    const r2 = F.fit([P10u], { Vt, base: Object.assign({ VAF: 125.5, NE: 1.35, NF: 1.002, ISE: 4.88e-15 }, BASE_NONFIT), fixed: { NF: 1.002, ISE: 4.88e-15 } });
    close(r2.params.IS, TRUE.IS, 1e-6, 'IS with NF, ISE fixed to truth');
    close(r2.params.BF, TRUE.BF, 1e-6, 'BF with NF, ISE fixed to truth');
}

// ---------------------------------------------------------------
section('6. Options, warnings, validation, output');
{
    // free / fixed overrides
    const r = F.fit([P1u, P10u, P100u], { Vt, base: Object.assign({ VAF: 125.5 }, BASE_NONFIT), free: ['IS', 'BF'] });
    check(r.free.join() === 'IS,BF', 'opts.free');
    const r2 = F.fit([P1u, P10u, P100u], { Vt, base: Object.assign({ VAF: 125.5 }, BASE_NONFIT), fixed: { NE: 1.35 } });
    check(r2.free.indexOf('NE') < 0 && r2.params.NE === 1.35, 'opts.fixed removes NE from the free set');
    check(r2.fixedNames.indexOf('NE') >= 0, 'fixedNames lists NE');
    // saturated point excluded
    const sat = Object.assign({}, P10u, { Vce: 0.1 });
    const r3 = F.fit([P1u, P10u, sat], { Vt, base: Object.assign({ VAF: 125.5, NE: 1.35 }, BASE_NONFIT) });
    check(r3.warnings.some(w => /飽和/.test(w)) && r3.points[2].excluded, 'saturated point excluded with warning');
    close(r3.params.IS, TRUE.IS, 1e-6, 'fit unaffected by the excluded point');
    // under-determined warning
    const r4 = F.fit([P10u], { Vt, free: ['IS', 'BF', 'NF'] });
    check(r4.warnings.some(w => /一意/.test(w)), 'under-determined warning');
    // validation
    const bad = [
        [], [{ Ib: 1e-6, Ic: 1e-7, Vbe: 0.6, Vce: 5 }], [{ Ib: 1e-6, Ic: 1e-4, Vbe: 0.1, Vce: 5 }],
        [{ Ib: 1e-6, Ic: 1e-4, Vbe: 1.5, Vce: 5 }], [{ Ib: -1, Ic: 1e-4, Vbe: 0.6, Vce: 5 }],
        [{ Ib: 1e-6, Ic: NaN, Vbe: 0.6, Vce: 5 }], [{ Ib: 1e-6, Ic: 1e-4, Vbe: 0.6, Vce: 0.1 }],
    ];
    for (const b of bad) {
        let msg = '';
        try { F.fit(b, { Vt }); } catch (e) { msg = e.message; }
        check(JP.test(msg), 'Japanese error for ' + JSON.stringify(b) + ': ' + msg);
        console.log('  ' + msg);
    }
    let msg = '';
    try { F.fit([P10u], { free: ['BR'] }); } catch (e) { msg = e.message; }
    check(/推定できない/.test(msg), 'free BR rejected');

    // .MODEL text round trip through js/spice-parser.js (browser scripts loaded in a VM context)
    const ctx = {};
    vm.createContext(ctx);
    for (const f of ['utils.js', 'spice-parser.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', f), 'utf8'), ctx);
    const a = F.fit([P1u, P10u, P100u], { Vt, free: ['IS', 'BF', 'NF', 'ISE', 'NE'], base: Object.assign({ VAF: 125.5 }, BASE_NONFIT) });
    const parsed = ctx.parseSpiceModel(a.model);
    for (const [k, K] of [['Is', 'IS'], ['Bf', 'BF'], ['Nf', 'NF'], ['Ise', 'ISE'], ['Ne', 'NE'], ['Vaf', 'VAF'], ['Br', 'BR'], ['Ikf', 'IKF']]) {
        close(parsed[k], a.params[K], 6e-4, 'parsed ' + K + ' from model text');
    }
    console.log('  ' + a.model);
    check(!/RB=|RE=|RC=/.test(a.model), 'RB/RE/RC omitted when not in base');
    const withR = F.fit([P1u, P10u], { Vt, base: Object.assign({ RB: 12.8, RE: 0.185, RC: 0.88, NE: 1.35 }, BASE_NONFIT) });
    check(/RB=12\.8 RE=185m RC=880m/.test(withR.model), 'base RB/RE/RC carried into the model text: ' + withR.model);
    // camelCase parsed base (with .found) only carries explicitly set keys
    const pb = ctx.parseSpiceModel('.MODEL X NPN(BR=8.22 IKF=385m)');
    const withParsed = F.fit([P10u], { Vt, base: pb });
    check(/BR=8\.22/.test(withParsed.model) && !/NR=|ISC=/.test(withParsed.model), 'parsed base: only found keys in model text: ' + withParsed.model);

    // spiceNum
    for (const [v, s] of [[25.44e-15, '25.44f'], [380.43, '380.4'], [0.385, '385m'], [1.002, '1.002'], [125.5, '125.5'], [1e6, '1meg'], [4.7e3, '4.7k'], [1, '1']]) {
        check(F.spiceNum(v) === s, 'spiceNum(' + v + ') = ' + F.spiceNum(v) + ', expected ' + s);
    }

    // betaCurve agrees with the model at the measured points
    const bc = F.betaCurve(a.params, Vt, 5, P1u.Ic, P100u.Ic, 3);
    check(bc.length === 3, 'betaCurve length');
    close(bc[0].beta, P1u.Ic / P1u.Ib, 1e-6, 'betaCurve at IB 1 uA point');
    close(bc[2].beta, P100u.Ic / P100u.Ib, 1e-6, 'betaCurve at IB 100 uA point');
    const curve = F.betaCurve(TRUE, Vt, 5, 1e-6, 0.1, 30);
    const bmax = curve.reduce((m, p) => (p.beta > m.beta ? p : m));
    console.log('  betaCurve (true model, VCE 5 V): beta peaks at ' + bmax.beta.toFixed(1) + ' near IC ' + bmax.Ic.toExponential(1) + ' A, ' + curve[0].beta.toFixed(1) + ' at 1 uA, ' + curve[curve.length - 1].beta.toFixed(1) + ' at 100 mA');
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);

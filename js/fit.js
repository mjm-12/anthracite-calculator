// FFFit: estimate Gummel-Poon DC parameters (IS, BF, NF, ISE, NE, VAF) from a few
// DC measurements {Ib, Ic, Vbe, Vce}. Uses FFEngine.gpDC as the device model.
// Works as a browser <script> after js/engine.js (global FFFit) and as a Node module.
//
// For every point the model is evaluated at the measured vbe and vbc = Vbe - Vce;
// residuals are ln(Ic_model/Ic) and ln(Ib_model/Ib). Levenberg-Marquardt runs on
// transformed parameters: log for IS, ISE, BF, VAF; logit within bounds for NF, NE.

(function (root) {
    'use strict';

    const Eng = (typeof FFEngine !== 'undefined') ? FFEngine
        : (typeof require !== 'undefined' ? require('./engine.js') : null);
    if (!Eng || typeof Eng.gpDC !== 'function') {
        throw new Error('FFFit: js/engine.js (FFEngine) を先に読み込むこと');
    }

    const VT_DEFAULT = 0.02585;
    const SAT_VCE = 0.3;

    // Parameter set. kind 'log' = positive, fitted as ln(v); 'logit' = bounded.
    const FIT_PARAMS = {
        IS: { kind: 'log', lo: 1e-30, hi: 1e-1 },
        BF: { kind: 'log', lo: 1, hi: 1e5 },
        NF: { kind: 'logit', lo: 0.9, hi: 2 },
        ISE: { kind: 'log', lo: 1e-35, hi: 1e-1 },
        NE: { kind: 'logit', lo: 1, hi: 4 },
        VAF: { kind: 'log', lo: 1, hi: 1e5 },
    };
    const ALL_KEYS = ['IS', 'BF', 'NF', 'ISE', 'NE', 'VAF', 'BR', 'NR', 'ISC', 'NC', 'VAR', 'IKF', 'IKR', 'RB', 'RE', 'RC'];
    const SPICE_DEFAULTS = {
        IS: 1e-16, BF: 100, NF: 1, ISE: 0, NE: 1.5, VAF: Infinity,
        BR: 1, NR: 1, ISC: 0, NC: 2, VAR: Infinity, IKF: Infinity, IKR: Infinity, RB: 0, RE: 0, RC: 0,
    };
    // Defaults for parameters that are neither free nor given (auto selection rules)
    const AUTO_DEFAULTS = { NF: 1, ISE: 0, NE: 1.5, VAF: Infinity };
    const INF_ZERO = { VAF: 1, VAR: 1, IKF: 1, IKR: 1 };   // SPICE: 0 means infinite

    // Accept parsed models with camelCase keys (Is, Bf, ...) or SPICE names (IS, BF, ...).
    // Returns { values:{IS..RC}, set:[names that were explicitly given] }.
    function normalizeBase(base) {
        const values = {}, set = [];
        if (!base || typeof base !== 'object') return { values, set };
        const found = Array.isArray(base.found) ? base.found.map(k => k.toUpperCase()) : null;
        for (const k of Object.keys(base)) {
            const K = k.toUpperCase();
            if (ALL_KEYS.indexOf(K) < 0) continue;
            let v = base[k];
            if (typeof v !== 'number' || Number.isNaN(v)) continue;
            if (INF_ZERO[K] && v === 0) v = Infinity;
            values[K] = v;
            if (!found || found.indexOf(K) >= 0) set.push(K);
        }
        return { values, set };
    }

    function toEngine(P) {
        return {
            Is: P.IS, Bf: P.BF, Nf: P.NF, Ise: P.ISE, Ne: P.NE, Vaf: P.VAF,
            Br: P.BR, Nr: P.NR, Isc: P.ISC, Nc: P.NC, Var: P.VAR, Ikf: P.IKF, Ikr: P.IKR,
            Rb: P.RB, Re: P.RE, Rc: P.RC,
        };
    }

    function fullParams(p) {
        const n = normalizeBase(p).values;
        const P = {};
        for (const k of ALL_KEYS) P[k] = (n[k] !== undefined) ? n[k] : SPICE_DEFAULTS[k];
        return P;
    }

    // ---------------------------------------------------------------
    // Transforms
    // ---------------------------------------------------------------
    function toX(name, v) {
        const d = FIT_PARAMS[name];
        if (d.kind === 'log') return Math.log(Math.min(Math.max(v, d.lo), d.hi));
        const t = Math.min(Math.max((v - d.lo) / (d.hi - d.lo), 1e-9), 1 - 1e-9);
        return Math.log(t / (1 - t));
    }
    function fromX(name, x) {
        const d = FIT_PARAMS[name];
        if (d.kind === 'log') return Math.min(Math.max(Math.exp(x), d.lo), d.hi);
        return d.lo + (d.hi - d.lo) / (1 + Math.exp(-x));
    }

    // ---------------------------------------------------------------
    // Small linear solver (Gaussian elimination, partial pivoting)
    // ---------------------------------------------------------------
    function solve(A, b) {
        const n = b.length;
        const M = A.map((r, i) => r.slice().concat([b[i]]));
        for (let k = 0; k < n; k++) {
            let p = k;
            for (let i = k + 1; i < n; i++) if (Math.abs(M[i][k]) > Math.abs(M[p][k])) p = i;
            if (!(Math.abs(M[p][k]) > 0)) return null;
            [M[k], M[p]] = [M[p], M[k]];
            for (let i = k + 1; i < n; i++) {
                const f = M[i][k] / M[k][k];
                for (let j = k; j <= n; j++) M[i][j] -= f * M[k][j];
            }
        }
        const x = new Array(n);
        for (let i = n - 1; i >= 0; i--) {
            let s = M[i][n];
            for (let j = i + 1; j < n; j++) s -= M[i][j] * x[j];
            x[i] = s / M[i][i];
        }
        return x.every(isFinite) ? x : null;
    }

    // Bisection on a monotone increasing f over [lo, hi] (expanded if needed).
    function rootInc(f, lo, hi) {
        let flo = f(lo), fhi = f(hi);
        for (let k = 0; k < 40 && flo > 0; k++) { lo -= 0.25; flo = f(lo); }
        for (let k = 0; k < 40 && fhi < 0; k++) { hi += 0.25; fhi = f(hi); }
        if (!(flo <= 0 && fhi >= 0)) return NaN;
        for (let i = 0; i < 200 && hi - lo > 1e-15; i++) {
            const m = 0.5 * (lo + hi);
            if (f(m) < 0) lo = m; else hi = m;
        }
        return 0.5 * (lo + hi);
    }

    // vbe that gives collector current Ic at fixed Vce (vbc = vbe - Vce)
    function vbeForIc(P, Vt, Ic, Vce, guess) {
        const ep = toEngine(P);
        const g = isFinite(guess) ? guess : 0.6;
        return rootInc((v) => Eng.gpDC(v, v - Vce, ep, Vt, 0).Ic - Ic, g - 0.3, g + 0.3);
    }

    // ---------------------------------------------------------------
    // Input validation
    // ---------------------------------------------------------------
    function fmt(v, d) {
        const x = Number(v), ax = Math.abs(x);
        return (ax !== 0 && (ax < 1e-3 || ax >= 1e4)) ? x.toExponential((d || 3) - 1) : x.toPrecision(d || 3);
    }

    function validatePoints(points) {
        if (!Array.isArray(points) || points.length === 0) throw new Error('測定点がない');
        return points.map((p, i) => {
            const k = (i + 1) + ' 点目';
            if (!p || typeof p !== 'object') throw new Error(k + ' が不正');
            for (const name of ['Ib', 'Ic', 'Vbe', 'Vce']) {
                const v = p[name];
                if (typeof v !== 'number' || !isFinite(v) || v <= 0) {
                    throw new Error(k + ' の ' + name + ' が不正: 正の有限値が必要 (' + v + ')');
                }
            }
            if (!(p.Ic > p.Ib)) throw new Error(k + ': I_C (' + fmt(p.Ic) + ' A) が I_B (' + fmt(p.Ib) + ' A) 以下');
            if (p.Vbe < 0.2 || p.Vbe > 1.2) throw new Error(k + ': V_BE = ' + fmt(p.Vbe) + ' V は範囲外 (0.2〜1.2 V)');
            return { Ib: p.Ib, Ic: p.Ic, Vbe: p.Vbe, Vce: p.Vce };
        });
    }

    // Number of distinct IC levels (consecutive sorted values differing by more than 2x)
    function distinctLevels(vals) {
        const s = vals.slice().sort((a, b) => a - b);
        let n = s.length ? 1 : 0;
        for (let i = 1; i < s.length; i++) if (s[i] > 2 * s[i - 1]) n++;
        return n;
    }

    function hasVcePair(pts) {
        for (let i = 0; i < pts.length; i++) {
            for (let j = i + 1; j < pts.length; j++) {
                const a = pts[i], b = pts[j];
                if (Math.abs(a.Ib - b.Ib) <= 0.1 * Math.max(a.Ib, b.Ib) && Math.abs(a.Vce - b.Vce) > 1) return true;
            }
        }
        return false;
    }

    // ---------------------------------------------------------------
    // SPICE number formatting (4 significant digits)
    // ---------------------------------------------------------------
    const SUFFIX = [[1e12, 't'], [1e9, 'g'], [1e6, 'meg'], [1e3, 'k'], [1, ''], [1e-3, 'm'], [1e-6, 'u'],
        [1e-9, 'n'], [1e-12, 'p'], [1e-15, 'f']];
    function spiceNum(v) {
        if (v === 0) return '0';
        const a = Math.abs(v);
        if (a < 1e-15 * 0.9995) return v.toExponential(3).replace(/\.?0+e/, 'e');
        for (const [m, s] of SUFFIX) {
            if (a >= m * 0.9995) {
                let t = (v / m).toPrecision(4);
                if (t.indexOf('e') >= 0) t = String(Number(t));
                if (t.indexOf('.') >= 0) t = t.replace(/0+$/, '').replace(/\.$/, '');
                return t + s;
            }
        }
        return v.toExponential(3);
    }

    // ---------------------------------------------------------------
    // Fit
    // ---------------------------------------------------------------
    function fit(points, opts) {
        opts = opts || {};
        const Vt = opts.Vt === undefined ? VT_DEFAULT : opts.Vt;
        if (typeof Vt !== 'number' || !isFinite(Vt) || Vt <= 0) throw new Error('V_T が不正 (' + Vt + ')');
        const wIc = opts.wIc === undefined ? 1 : opts.wIc, wIb = opts.wIb === undefined ? 1 : opts.wIb;
        const warnings = [];

        const all = validatePoints(points);
        const pts = [];
        all.forEach((p, i) => {
            if (p.Vce < SAT_VCE) warnings.push((i + 1) + ' 点目は V_CE = ' + fmt(p.Vce) + ' V で飽和の可能性: 除外した');
            else pts.push(p);
        });
        if (pts.length === 0) throw new Error('使える測定点がない (すべて V_CE < ' + SAT_VCE + ' V)');

        const base = normalizeBase(opts.base);
        const fixed = {};
        if (opts.fixed) {
            const f = normalizeBase(opts.fixed).values;
            for (const k of Object.keys(f)) fixed[k] = f[k];
        }

        // Free parameter selection
        let free;
        if (Array.isArray(opts.free)) {
            free = opts.free.map(s => String(s).toUpperCase());
            for (const k of free) {
                if (!FIT_PARAMS[k]) throw new Error('推定できないパラメータ: ' + k + ' (IS, BF, NF, ISE, NE, VAF のみ)');
            }
        } else {
            const nIc = distinctLevels(pts.map(p => p.Ic));
            free = ['IS', 'BF'];
            if (nIc >= 2) free.push('NF', 'ISE');
            // NE is not auto-freed: with ±1 % current noise the β differences between
            // a few points are as small as the noise, so NE/ISE/BF cannot be separated.
            if (hasVcePair(pts)) free.push('VAF');
        }
        free = free.filter(k => fixed[k] === undefined);
        if (free.length === 0) throw new Error('推定するパラメータがない');

        // Parameter values: fixed > base > auto default > SPICE default
        const P = {};
        for (const k of ALL_KEYS) {
            if (fixed[k] !== undefined) P[k] = fixed[k];
            else if (base.values[k] !== undefined) P[k] = base.values[k];
            else if (AUTO_DEFAULTS[k] !== undefined) P[k] = AUTO_DEFAULTS[k];
            else P[k] = SPICE_DEFAULTS[k];
        }

        // Start values
        const hi = pts.reduce((a, b) => (b.Ic > a.Ic ? b : a));
        const lo = pts.reduce((a, b) => (b.Ic < a.Ic ? b : a));
        if (free.indexOf('NF') >= 0) P.NF = 1;
        if (free.indexOf('IS') >= 0) P.IS = hi.Ic * Math.exp(-hi.Vbe / (P.NF * Vt));
        if (free.indexOf('BF') >= 0) P.BF = Math.max.apply(null, pts.map(p => p.Ic / p.Ib));
        if (free.indexOf('NE') >= 0) P.NE = 1.5;
        if (free.indexOf('ISE') >= 0) P.ISE = Math.max(0.1 * lo.Ib * Math.exp(-lo.Vbe / (P.NE * Vt)), 1e-30);
        if (free.indexOf('VAF') >= 0 && !(isFinite(P.VAF))) P.VAF = 100;

        const nRes = 2 * pts.length;
        if (free.length > nRes) {
            warnings.push('推定パラメータ数 (' + free.length + ') が残差の数 (' + nRes + ') より多い: 解が一意に決まらない');
        }

        const model = (x) => {
            const Q = Object.assign({}, P);
            free.forEach((k, i) => { Q[k] = fromX(k, x[i]); });
            return Q;
        };
        const residuals = (Q) => {
            const ep = toEngine(Q);
            const r = [];
            for (const p of pts) {
                const d = Eng.gpDC(p.Vbe, p.Vbe - p.Vce, ep, Vt, 0);
                r.push(wIc * Math.log(Math.max(d.Ic, 1e-300) / p.Ic));
                r.push(wIb * Math.log(Math.max(d.Ib, 1e-300) / p.Ib));
            }
            return r;
        };
        const cost = (r) => r.reduce((s, v) => s + v * v, 0);

        // Levenberg-Marquardt
        let x = free.map(k => toX(k, P[k]));
        let r = residuals(model(x)), C = cost(r);
        let lambda = 1e-3, it = 0, converged = false;
        const MAX_IT = 500;
        for (; it < MAX_IT; it++) {
            if (C < 1e-26) { converged = true; break; }
            // numeric Jacobian (central differences in transformed space)
            const J = r.map(() => new Array(x.length).fill(0));
            for (let j = 0; j < x.length; j++) {
                const h = 1e-6 * Math.max(1, Math.abs(x[j]));
                const xp = x.slice(), xm = x.slice();
                xp[j] += h; xm[j] -= h;
                const rp = residuals(model(xp)), rm = residuals(model(xm));
                for (let i = 0; i < r.length; i++) J[i][j] = (rp[i] - rm[i]) / (2 * h);
            }
            const n = x.length;
            const JtJ = [], Jtr = new Array(n).fill(0);
            for (let a = 0; a < n; a++) {
                JtJ.push(new Array(n).fill(0));
                for (let b = 0; b < n; b++) for (let i = 0; i < r.length; i++) JtJ[a][b] += J[i][a] * J[i][b];
                for (let i = 0; i < r.length; i++) Jtr[a] += J[i][a] * r[i];
            }
            const gnorm = Math.sqrt(Jtr.reduce((s, v) => s + v * v, 0));
            if (gnorm < 1e-14) { converged = true; break; }
            let accepted = false;
            while (lambda < 1e16) {
                const A = JtJ.map((row, a) => row.map((v, b) => v + (a === b ? lambda * (JtJ[a][a] + 1e-12) : 0)));
                const dx = solve(A, Jtr.map(v => -v));
                if (dx) {
                    const xn = x.map((v, i) => v + dx[i]);
                    const rn = residuals(model(xn)), Cn = cost(rn);
                    if (isFinite(Cn) && Cn < C) {
                        const rel = (C - Cn) / Math.max(C, 1e-300);
                        const step = Math.max.apply(null, dx.map(Math.abs));
                        x = xn; r = rn; C = Cn;
                        lambda = Math.max(lambda / 3, 1e-12);
                        accepted = true;
                        if (rel < 1e-12 && step < 1e-10) converged = true;
                        break;
                    }
                }
                lambda *= 4;
            }
            if (!accepted) { converged = true; break; }   // no further decrease possible
            if (converged) break;
        }

        const Q = model(x);
        for (const k of free) {
            const d = FIT_PARAMS[k];
            if (Q[k] <= d.lo * 1.0001 || Q[k] >= d.hi * 0.9999) {
                warnings.push(k + ' が探索範囲の端に張り付いた (' + spiceNum(Q[k]) + '): 推定値は信頼できない');
            }
        }
        if (!converged) warnings.push('反復が上限 (' + MAX_IT + ') に達した');
        const rms = Math.sqrt(C / r.length);
        if (rms > 0.05) warnings.push('残差が大きい (RMS ' + rms.toFixed(3) + '): 測定値かモデルの前提を確認');

        // Per-point report
        const ep = toEngine(Q);
        const outPts = all.map(p => {
            const d = Eng.gpDC(p.Vbe, p.Vbe - p.Vce, ep, Vt, 0);
            const v = vbeForIc(Q, Vt, p.Ic, p.Vce, p.Vbe);
            return {
                Ib: p.Ib, Ic: p.Ic, Vbe: p.Vbe, Vce: p.Vce,
                Ic_model: d.Ic, Ib_model: d.Ib,
                beta: p.Ic / p.Ib, beta_model: d.Ic / d.Ib,
                dVbe: v - p.Vbe,
                excluded: p.Vce < SAT_VCE,
            };
        });

        // .MODEL text: fitted and auto-set core parameters, plus base parameters given explicitly
        const parts = [];
        for (const k of ALL_KEYS) {
            const core = ['IS', 'BF', 'NF', 'ISE', 'NE', 'VAF'].indexOf(k) >= 0;
            const include = core ? true : (base.set.indexOf(k) >= 0 || fixed[k] !== undefined);
            if (!include) continue;
            const v = Q[k];
            if (!isFinite(v)) continue;            // infinite VAF etc. omitted
            if (k === 'ISE' && v === 0) continue;
            parts.push(k + '=' + spiceNum(v));
        }

        return {
            params: Q,
            engineParams: toEngine(Q),
            free: free.slice(),
            fixedNames: ALL_KEYS.filter(k => free.indexOf(k) < 0),
            points: outPts,
            rms: rms,
            iterations: it,
            converged: converged,
            warnings: warnings,
            model: '.MODEL FIT NPN(' + parts.join(' ') + ')',
        };
    }

    // beta = IC/IB versus IC at fixed VCE, log-spaced from IcMin to IcMax.
    function betaCurve(params, Vt, Vce, IcMin, IcMax, n) {
        const P = fullParams(params);
        Vt = Vt || VT_DEFAULT;
        n = Math.max(2, n || 50);
        const ep = toEngine(P);
        const out = [];
        let guess = 0.6;
        for (let i = 0; i < n; i++) {
            const Ic = IcMin * Math.pow(IcMax / IcMin, i / (n - 1));
            const v = vbeForIc(P, Vt, Ic, Vce, guess);
            if (!isFinite(v)) continue;
            guess = v;
            const d = Eng.gpDC(v, v - Vce, ep, Vt, 0);
            out.push({ Ic: Ic, beta: d.Ic / d.Ib, Vbe: v });
        }
        return out;
    }

    const FFFit = { fit: fit, betaCurve: betaCurve, spiceNum: spiceNum, vbeForIc: vbeForIc, fullParams: fullParams };
    if (typeof module !== 'undefined' && module.exports) module.exports = FFFit;
    else root.FFFit = FFFit;
})(typeof globalThis !== 'undefined' ? globalThis : this);

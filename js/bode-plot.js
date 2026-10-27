// --- Bode plot (|A_vs| dB + phase vs log f), shared by the dialog in index.html and bode.html ---
// FFBode.draw({ svg, sum, msg }, inputs, { fStart, fStop }, gainUnit, result?, { sweep })
//   inputs   : the object passed to FFEngine.evaluate (incl. Cin/Ce2/Cout/Cbc1/Cbc2)
//   gainUnit : 'dB' | 'x' (numbers only; the magnitude axis stays in dB)
//   result   : FFEngine.evaluate(inputs) if already known (used for region warnings)
//   sweep    : true = overlay RV1 = 1 Ω … 10 kΩ (one per decade, other inputs as current)
(function (root) {
    'use strict';

    const N = 200;
    const RV1_SWEEP = [1, 10, 100, 1e3, 10e3];
    const RV1_LABEL = ['1', '10', '100', '1k', '10k'];
    // sequential ramp of the single accent hue: light (1 Ω) -> dark (10 kΩ)
    const RAMP = [
        'color-mix(in srgb, var(--accent) 35%, white)',
        'color-mix(in srgb, var(--accent) 62%, white)',
        'color-mix(in srgb, var(--accent) 88%, white)',
        'color-mix(in srgb, var(--accent) 75%, black)',
        'color-mix(in srgb, var(--accent) 50%, black)',
    ];
    const SWEEP_KEY = 'ffop.bode.sweep';

    const fHz = (v) => (v > 0 && isFinite(v) ? formatSI(v, 'Hz', 3) : '–');

    // -3 dB edge with the engine's flag: below / above the sweep range, or no band at all
    function fEdge(v, flag, rg) {
        if (v > 0 && isFinite(v)) return fHz(v);
        if (flag === '<fStart') return '&lt; ' + fHz(rg.fStart);
        if (flag === '>fStop') return '&gt; ' + fHz(rg.fStop);
        return '—';
    }

    const fmtMid = (db, unit) => (!isFinite(db) ? '–' : unit === 'x'
        ? Number(Math.pow(10, db / 20).toPrecision(4)) + '×' : db.toFixed(1) + ' dB');
    const fmtPeak = (pk, unit, withF) => (pk && isFinite(pk.dB)   // peak.dB is relative to the mid-band level
        ? (unit === 'x' ? '×' + Math.pow(10, pk.dB / 20).toFixed(2) : (pk.dB >= 0 ? '+' : '−') + Math.abs(pk.dB).toFixed(1) + ' dB') +
          (withF ? ' @ ' + formatSI(pk.f, 'Hz', 3) : '') : '–');

    function niceStep(span, target) {
        const raw = span / target, e = Math.pow(10, Math.floor(Math.log10(raw)));
        for (const m of [1, 2, 2.5, 5, 10]) if (m * e >= raw) return m * e;
        return 10 * e;
    }

    function draw(el, inp, rg, unit, res, opt) {
        const msg = el.msg, sum = el.sum, svg = el.svg;
        const sweep = !!(opt && opt.sweep);
        if (typeof FFEngine === 'undefined' || typeof FFEngine.acSweep !== 'function') {
            msg.textContent = 'engine に acSweep が無い';
            return false;
        }
        const o = { fStart: rg.fStart, fStop: rg.fStop, n: N };
        let curves;
        try {
            if (!res) res = FFEngine.evaluate(inp);
            if (sweep) {
                curves = RV1_SWEEP.map((rv, i) => ({
                    // acSweep(result, inputs) would reuse the DC point, but its midbandDB / f3dB
                    // then refer to the result's own RV1; a full call per value is ~2 ms.
                    sw: FFEngine.acSweep(Object.assign({}, inp, { RV1: rv }), o),
                    label: RV1_LABEL[i],
                    color: rv === inp.RV1 ? 'var(--accent)' : RAMP[i],
                    width: rv === inp.RV1 ? 2.2 : 1.2,
                }));
            } else {
                curves = [{ sw: FFEngine.acSweep(res, inp, o), color: 'var(--accent)', width: 1.8 }];
            }
        } catch (e) {
            msg.textContent = e && e.message ? e.message : String(e);
            svg.classList.add('stale');
            return false;
        }
        svg.classList.remove('stale');
        const inactive = [res.q1, res.q2].some((q) => q && q.region && q.region !== 'active');
        msg.textContent = inactive ? (res.warnings || []).join(' / ') : '';

        if (sweep) {
            sum.innerHTML = '<table class="bsw"><thead><tr><th>RV<sub>1</sub></th><th>mid</th><th>f<sub>L</sub></th><th>f<sub>H</sub></th><th>peak</th></tr></thead><tbody>' +
                curves.map((c) => {
                    const f3 = c.sw.f3dB || {};
                    return '<tr><th><i class="sw" style="background:' + c.color + '"></i>' + c.label + '</th><td>' + fmtMid(c.sw.midbandDB, unit) +
                        '</td><td>' + fEdge(f3.low, f3.lowFlag, rg) + '</td><td>' + fEdge(f3.high, f3.highFlag, rg) +
                        '</td><td>' + fmtPeak(c.sw.peak, unit, false) + '</td></tr>';
                }).join('') + '</tbody></table>';
        } else {
            const sw = curves[0].sw, f3 = sw.f3dB || {};
            sum.innerHTML = '<dl>' +
                '<dt>A<sub>vs</sub> mid</dt><dd>' + fmtMid(sw.midbandDB, unit) + '</dd>' +
                '<dt>f<sub>L</sub></dt><dd>' + fEdge(f3.low, f3.lowFlag, rg) + '</dd>' +
                '<dt>f<sub>H</sub></dt><dd>' + fEdge(f3.high, f3.highFlag, rg) + '</dd>' +
                (sw.peak && isFinite(sw.peak.dB) ? '<dt>peak</dt><dd>' + fmtPeak(sw.peak, unit, true) + '</dd>' : '') + '</dl>';
        }
        plot(svg, curves, rg, sweep);
        svg._bode = { curves: curves, sweep: sweep };   // kept for CSV export
        return true;
    }

    // ---------- CSV export of the plotted data (one rectangular table) ----------
    function stamp(d) {
        const p = (x) => String(x).padStart(2, '0');
        return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
    }

    function csv(svg) {
        const b = svg && svg._bode;
        if (!b || !b.curves.length) return null;
        const f = b.curves[0].sw.f || [];
        const num = (v) => (v === undefined || v === null ? '' : String(v));
        let head, rowOf;
        if (b.sweep) {
            head = ['f_Hz'];
            for (const c of b.curves) head.push('RV1=' + c.label + '_dB', 'RV1=' + c.label + '_deg', 'RV1=' + c.label + '_Zin_ohm');
            rowOf = (i) => [num(f[i])].concat(...b.curves.map((c) => [num(c.sw.AvS.dB[i]), num(c.sw.AvS.phaseDeg[i]), num(c.sw.Zin && c.sw.Zin.mag[i])]));
        } else {
            const sw = b.curves[0].sw;
            head = ['f_Hz', 'AvS_dB', 'AvS_phase_deg', 'Zin_ohm', 'Zin_phase_deg'];
            rowOf = (i) => [num(f[i]), num(sw.AvS.dB[i]), num(sw.AvS.phaseDeg[i]), num(sw.Zin && sw.Zin.mag[i]), num(sw.Zin && sw.Zin.phaseDeg[i])];
        }
        const rows = [head];
        for (let i = 0; i < f.length; i++) rows.push(rowOf(i));
        return { text: '﻿' + toCsv(rows), name: 'fuzzface_bode' + (b.sweep ? '_rv1sweep' : '') + '_' + stamp(new Date()) + '.csv' };
    }

    function exportCsv(svg) {
        const c = csv(svg);
        if (!c) return false;
        const url = URL.createObjectURL(new Blob([c.text], { type: 'text/csv;charset=utf-8' }));
        const a = document.createElement('a');
        a.href = url;
        a.download = c.name;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        return true;
    }

    function plot(svg, curves, rg, sweep) {
        const box = svg.getBoundingClientRect();
        const W = Math.max(300, Math.round(box.width)), H = Math.max(200, Math.round(box.height));
        svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
        const L = 52, R = sweep ? 34 : 16, T = 8, B = 26, GAP = 18;
        const hTop = Math.round((H - T - B - GAP) * 0.62);
        const top = { y0: T, y1: T + hTop }, bot = { y0: T + hTop + GAP, y1: H - B };
        const lx0 = Math.log10(rg.fStart), lx1 = Math.log10(rg.fStop);
        const X = (f) => L + (Math.log10(f) - lx0) / (lx1 - lx0) * (W - L - R);
        const fin = (a) => a.filter((v) => isFinite(v));
        const allDB = [], allPh = [], mids = [];
        for (const c of curves) {
            allDB.push.apply(allDB, fin((c.sw.AvS && c.sw.AvS.dB) || []));
            allPh.push.apply(allPh, fin((c.sw.AvS && c.sw.AvS.phaseDeg) || []));
            if (isFinite(c.sw.midbandDB)) mids.push(c.sw.midbandDB);
        }
        // dB range: 10 dB grid, at most ~80 dB below the top
        let dmax = Math.max.apply(null, allDB.concat(mids, [0]));
        let dmin = Math.min.apply(null, allDB.concat([dmax - 10]));
        dmax = Math.ceil(dmax / 10) * 10; dmin = Math.max(Math.floor(dmin / 10) * 10, dmax - 80);
        const dstep = niceStep(dmax - dmin, 5);
        let pmax = Math.max.apply(null, allPh.concat([0])), pmin = Math.min.apply(null, allPh.concat([0]));
        pmax = Math.ceil(pmax / 45) * 45; pmin = Math.floor(pmin / 45) * 45;
        if (pmax - pmin < 90) { pmax += 45; pmin -= 45; }
        const pstep = (pmax - pmin) > 180 ? 90 : 45;
        const Yd = (v) => top.y0 + (dmax - Math.min(Math.max(v, dmin), dmax)) / (dmax - dmin) * (top.y1 - top.y0);
        const Yp = (v) => bot.y0 + (pmax - Math.min(Math.max(v, pmin), pmax)) / (pmax - pmin) * (bot.y1 - bot.y0);
        let s = '';
        for (let d = Math.ceil(lx0); d <= Math.floor(lx1); d++) {
            const x = X(Math.pow(10, d)).toFixed(1);
            s += '<line class="g" x1="' + x + '" y1="' + top.y0 + '" x2="' + x + '" y2="' + top.y1 + '"/>';
            s += '<line class="g" x1="' + x + '" y1="' + bot.y0 + '" x2="' + x + '" y2="' + bot.y1 + '"/>';
            s += '<text class="t" x="' + x + '" y="' + (H - 8) + '" text-anchor="middle">' + formatSI(Math.pow(10, d), 'Hz', 1) + '</text>';
        }
        for (let v = dmin; v <= dmax + 1e-9; v += dstep) {
            const y = Yd(v).toFixed(1);
            s += '<line class="g" x1="' + L + '" y1="' + y + '" x2="' + (W - R) + '" y2="' + y + '"/>';
            s += '<text class="t" x="' + (L - 6) + '" y="' + (+y + 4) + '" text-anchor="end">' + Math.round(v) + '</text>';
        }
        for (let v = pmin; v <= pmax + 1e-9; v += pstep) {
            const y = Yp(v).toFixed(1);
            s += '<line class="g" x1="' + L + '" y1="' + y + '" x2="' + (W - R) + '" y2="' + y + '"/>';
            s += '<text class="t" x="' + (L - 6) + '" y="' + (+y + 4) + '" text-anchor="end">' + Math.round(v) + '°</text>';
        }
        s += '<rect class="ax" x="' + L + '" y="' + top.y0 + '" width="' + (W - L - R) + '" height="' + (top.y1 - top.y0) + '"/>';
        s += '<rect class="ax" x="' + L + '" y="' + bot.y0 + '" width="' + (W - L - R) + '" height="' + (bot.y1 - bot.y0) + '"/>';
        s += '<text class="t" x="' + (L + 6) + '" y="' + (top.y0 + 14) + '">|A<tspan dy="3" font-size="8">vs</tspan><tspan dy="-3">| dB</tspan></text>';
        s += '<text class="t" x="' + (L + 6) + '" y="' + (bot.y0 + 14) + '">∠A<tspan dy="3" font-size="8">vs</tspan></text>';
        const path = (f, ys, Y) => {
            let d = '', pen = false;
            for (let i = 0; i < f.length; i++) {
                if (!(f[i] > 0) || !isFinite(ys[i])) { pen = false; continue; }
                d += (pen ? 'L' : 'M') + X(f[i]).toFixed(1) + ',' + Y(ys[i]).toFixed(1);
                pen = true;
            }
            return d;
        };
        if (!sweep) {
            // reference: mid-band level (dashed) and its -3 dB level (faint)
            const sw = curves[0].sw;
            if (isFinite(sw.midbandDB)) {
                for (const [v, cls] of [[sw.midbandDB, 'ref'], [sw.midbandDB - 3, 'ref3']]) {
                    if (v < dmin || v > dmax) continue;
                    const y = Yd(v).toFixed(1);
                    s += '<line class="' + cls + '" x1="' + L + '" y1="' + y + '" x2="' + (W - R) + '" y2="' + y + '"/>';
                }
            }
        }
        // thin curves first, the emphasised one (current RV1 / single curve) last
        const order = curves.slice().sort((a, b) => a.width - b.width);
        for (const c of order) {
            const f = c.sw.f || [], A = c.sw.AvS || {};
            const st = ' style="stroke:' + c.color + ';stroke-width:' + c.width + '"';
            s += '<path class="l"' + st + ' d="' + path(f, A.dB || [], Yd) + '"/>';
            s += '<path class="l"' + st + ' d="' + path(f, A.phaseDeg || [], Yp) + '"/>';
        }
        if (sweep) {
            // inline labels at the right end of each magnitude curve, nudged apart
            const labs = curves.map((c) => {
                const dB = (c.sw.AvS && c.sw.AvS.dB) || [];
                let k = dB.length - 1;
                while (k > 0 && !isFinite(dB[k])) k--;
                return { y: Yd(dB[k]), text: c.label, color: c.color };
            }).sort((a, b) => a.y - b.y);
            const GAPY = 11;
            for (let i = 1; i < labs.length; i++) if (labs[i].y - labs[i - 1].y < GAPY) labs[i].y = labs[i - 1].y + GAPY;
            const over = labs.length ? labs[labs.length - 1].y - (top.y1 - 2) : 0;
            if (over > 0) for (const l of labs) l.y -= over;
            for (const l of labs) {
                s += '<text class="sl" x="' + (W - R + 3) + '" y="' + (l.y + 4).toFixed(1) + '" style="fill:' + l.color + '">' + l.text + '</text>';
            }
        } else {
            // -3 dB markers
            const f3 = curves[0].sw.f3dB || {};
            for (const [k, lbl] of [['low', 'f<tspan dy="3" font-size="8">L</tspan>'], ['high', 'f<tspan dy="3" font-size="8">H</tspan>']]) {
                const v = f3[k];
                if (!(v >= rg.fStart && v <= rg.fStop)) continue;
                const x = X(v).toFixed(1);
                s += '<line class="mk" x1="' + x + '" y1="' + top.y0 + '" x2="' + x + '" y2="' + bot.y1 + '"/>';
                const right = X(v) < (L + W - R) / 2;
                s += '<text class="mt" x="' + (+x + (right ? 4 : -4)) + '" y="' + (k === 'low' ? top.y1 - 6 : top.y0 + 30) +
                    '" text-anchor="' + (right ? 'start' : 'end') + '">' + lbl + '<tspan dy="-3"> ' + formatSI(v, 'Hz', 3) + '</tspan></text>';
            }
        }
        svg.innerHTML = s;
    }

    // f range fields -> { fStart, fStop } or null (marks invalid fields)
    function range(a, b) {
        const fa = parseEngineering(a.value), fb = parseEngineering(b.value);
        a.classList.toggle('bad', !(fa > 0 && isFinite(fa)));
        b.classList.toggle('bad', !(fb > 0 && isFinite(fb)) || (fa > 0 && !(fb > fa)));
        return fa > 0 && fb > fa && isFinite(fb) ? { fStart: fa, fStop: fb } : null;
    }

    // RV1-sweep toggle button (aria-pressed), persisted; Alt+R toggles while focus is inside `scope`.
    // Shared state: every change is broadcast on BroadcastChannel('ffop') (and mirrored by the
    // localStorage 'storage' event), so the dialog and all pop-out windows stay in step.
    function sweepToggle(btn, scope, onChange) {
        let on = false;
        try { on = localStorage.getItem(SWEEP_KEY) === '1'; } catch (e) { /* ignore */ }
        const ch = typeof BroadcastChannel === 'function' ? new BroadcastChannel('ffop') : null;
        const paint = () => btn.setAttribute('aria-pressed', String(on));
        const set = (v, remote) => {
            if (v === on && remote) return;
            on = v;
            paint();
            if (!remote) {
                try { localStorage.setItem(SWEEP_KEY, on ? '1' : '0'); } catch (e) { /* ignore */ }
                if (ch) ch.postMessage({ type: 'sweep', on: on });
            }
            onChange(on);
        };
        if (ch) ch.addEventListener('message', (e) => { if (e.data && e.data.type === 'sweep') set(!!e.data.on, true); });
        window.addEventListener('storage', (e) => { if (e.key === SWEEP_KEY && e.newValue !== null) set(e.newValue === '1', true); });
        btn.addEventListener('click', () => set(!on));
        scope.addEventListener('keydown', (e) => {
            if (e.altKey && !e.ctrlKey && !e.metaKey && (e.code === 'KeyR' || e.key === 'r' || e.key === 'R')) {
                e.preventDefault();
                set(!on);
            }
        });
        paint();
        return () => on;
    }

    // JSON with Infinity / NaN preserved (for localStorage)
    function toJSON(o) {
        return JSON.stringify(o, (k, v) => (typeof v === 'number' && !isFinite(v) ? { $num: String(v) } : v));
    }
    function fromJSON(s) {
        return JSON.parse(s, (k, v) => (v && typeof v === 'object' && typeof v.$num === 'string' ? Number(v.$num) : v));
    }

    root.FFBode = {
        draw: draw, range: range, sweepToggle: sweepToggle, toJSON: toJSON, fromJSON: fromJSON, csv: csv, exportCsv: exportCsv,
        RV1_SWEEP: RV1_SWEEP, CHANNEL: 'ffop', STATE_KEY: 'ffop.bode.state',
    };
})(typeof globalThis !== 'undefined' ? globalThis : this);

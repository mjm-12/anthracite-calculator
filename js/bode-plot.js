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
        const src = (opt && opt.src) || srcState;
        inp = withSource(inp, src);
        const stabView = src.view === 'stab' && el.stab;
        if (el.stab) { el.stab.hidden = !stabView; svg.style.display = stabView ? 'none' : ''; }
        if (stabView) return drawStability(el, inp, res, unit);
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
        const st = svg && svg._stab;
        if (st && svg.style.display === 'none') {   // stability view: loop gain T(jw)
            const L = st.loop, rows = [['f_Hz', 'T_dB', 'T_phase_deg']];
            for (let i = 0; i < L.f.length; i++) rows.push([String(L.f[i]), String(L.T.dB[i]), String(L.T.phaseDeg[i])]);
            return { text: '\uFEFF' + toCsv(rows), name: 'anthracite_loop_' + stamp(new Date()) + '.csv' };
        }
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
        return { text: '﻿' + toCsv(rows), name: 'anthracite_bode' + (b.sweep ? '_rv1sweep' : '') + '_' + stamp(new Date()) + '.csv' };
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

    // ---------- signal source + view (shared by the dialog and every pop-out) ----------
    // { source: 'r' | PICKUP_PRESETS key, vol: 0..10, tone: 0..10, view: 'bode' | 'stab' }
    const SRC_KEY = 'ffop.bode.src';
    const SRC_DEFAULT = { source: 'r', vol: 10, tone: 10, view: 'bode' };
    let srcState = Object.assign({}, SRC_DEFAULT);
    try { Object.assign(srcState, JSON.parse(localStorage.getItem(SRC_KEY) || '{}')); } catch (e) { /* ignore */ }
    const srcListeners = [];
    const srcCh = typeof BroadcastChannel === 'function' ? new BroadcastChannel('ffop') : null;
    function setSrc(part, remote) {
        const next = Object.assign({}, srcState, part);
        if (JSON.stringify(next) === JSON.stringify(srcState)) return;
        srcState = next;
        if (!remote) {
            try { localStorage.setItem(SRC_KEY, JSON.stringify(srcState)); } catch (e) { /* ignore */ }
            if (srcCh) srcCh.postMessage({ type: 'src', state: srcState });
        }
        for (const f of srcListeners) f(srcState);
    }
    if (srcCh) srcCh.addEventListener('message', (e) => { if (e.data && e.data.type === 'src' && e.data.state) setSrc(e.data.state, true); });
    window.addEventListener('storage', (e) => {
        if (e.key === SRC_KEY && e.newValue) { try { setSrc(JSON.parse(e.newValue), true); } catch (x) { /* ignore */ } }
    });

    // inputs + chosen pickup preset (knob positions applied); R_in source = inputs unchanged
    function withSource(inp, st) {
        if (!st || st.source === 'r' || typeof FFEngine === 'undefined' || !FFEngine.PICKUP_PRESETS) return inp;
        const pre = FFEngine.PICKUP_PRESETS[st.source];
        if (!pre) return inp;
        const s = JSON.parse(JSON.stringify(pre));
        if (s.vol) s.vol.pos = st.vol;
        if (s.tone) s.tone.pos = st.tone;
        return Object.assign({}, inp, { source: s });
    }

    // wire the selector / knob fields / view toggle inside `root`; onChange() after every change
    function bindSource(root, onChange) {
        const q = (id) => root.querySelector('#' + id);
        const sel = q('bsrc'), vol = q('bvol'), tone = q('btone'), knobs = q('bknobs'), view = q('bview');
        function paint(st) {
            sel.value = st.source;
            knobs.hidden = st.source === 'r';
            if (document.activeElement !== vol) vol.value = String(st.vol);
            if (document.activeElement !== tone) tone.value = String(st.tone);
            view.setAttribute('aria-pressed', String(st.view === 'stab'));
        }
        const knob = (el, key) => {
            const v = Number(el.value);
            const ok = el.value.trim() !== '' && isFinite(v) && v >= 0 && v <= 10;
            el.classList.toggle('bad', !ok);
            if (ok) setSrc({ [key]: v });
        };
        sel.addEventListener('change', () => setSrc({ source: sel.value }));
        vol.addEventListener('change', () => knob(vol, 'vol'));
        tone.addEventListener('change', () => knob(tone, 'tone'));
        for (const [el, key] of [[vol, 'vol'], [tone, 'tone']]) {
            el.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') { e.preventDefault(); knob(el, key); }
                if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && !e.altKey && !e.ctrlKey) {
                    e.preventDefault(); e.stopPropagation();
                    const v = Math.min(10, Math.max(0, Math.round((Number(el.value) || 0) + (e.key === 'ArrowUp' ? 1 : -1))));
                    el.value = String(v); el.classList.remove('dirty'); knob(el, key);
                }
            });
        }
        view.addEventListener('click', () => setSrc({ view: srcState.view === 'stab' ? 'bode' : 'stab' }));
        root.addEventListener('keydown', (e) => {
            if (e.altKey && !e.ctrlKey && !e.metaKey && (e.code === 'KeyT' || e.key === 't' || e.key === 'T')) {
                e.preventDefault();
                setSrc({ view: srcState.view === 'stab' ? 'bode' : 'stab' });
            }
        });
        srcListeners.push((st) => { paint(st); onChange(st); });
        paint(srcState);
        return () => srcState;
    }

    // ---------- stability view ----------
    const ZETA_LIGHT = 0.1;   // ζ below this: lightly damped (ringing / oscillation risk)
    function fmtF(v) { return v > 0 && isFinite(v) ? formatSI(v, 'Hz', 3) : '–'; }

    function drawStability(el, inp, res, unit) {
        const box = el.stab, msg = el.msg, sum = el.sum;
        let st;
        try {
            if (!res) res = FFEngine.evaluate(inp);
            st = FFEngine.stability(res, inp, { n: 240, nLoop: 300 });
        } catch (e) {
            msg.textContent = e && e.message ? e.message : String(e);
            box.classList.add('stale');
            return false;
        }
        box.classList.remove('stale');
        msg.textContent = '';
        const L = st.loop;
        const pm = L.pm.map((m) => '<dt>PM</dt><dd>' + m.deg.toFixed(1) + '° @ ' + fmtF(m.f) + '</dd>').join('');
        const gm = L.gm.map((m) => '<dt>GM</dt><dd>' + m.dB.toFixed(1) + ' dB @ ' + fmtF(m.f) + '</dd>').join('');
        sum.innerHTML = '<dl>' + (pm || '<dt>PM</dt><dd>— (|T| &lt; 0 dB)</dd>') + gm + '</dl>';
        // Headline: ζ_min (least-damped complex pole); a real dominant pole shows σ instead.
        // State: ζ < 0 unstable, 0 <= ζ < ZETA_LIGHT marginal, else stable; RHP count is secondary.
        const lp = st.leastDamped || st.rightmostReal || null;
        const sig = (v) => (v < 0 ? '−' : '') + Number(Math.abs(v).toPrecision(3));
        let state, head;
        if (lp && lp.f > 0) {
            state = lp.zeta < 0 ? 'unstable' : lp.zeta < ZETA_LIGHT ? 'marginal' : 'stable';
            head = 'ζ<sub>min</sub> ' + sig(lp.zeta) + ' <span>@ ' + fmtF(lp.f) + '</span>';
        } else if (lp) {
            state = lp.sigma > 0 ? 'unstable' : 'stable';
            head = 'real pole σ ' + sig(lp.sigma) + ' <span>s⁻¹</span>';
        } else {
            state = st.stable ? 'stable' : 'unstable';
            head = 'ζ<sub>min</sub> — <span>(no lightly damped pole)</span>';
        }
        if (st.nRhp > 0) state = 'unstable';
        const rhp = st.nRhp + ' RHP pole' + (st.nRhp === 1 ? '' : 's');
        box.innerHTML =
            '<div class="zhead ' + state + '" title="ζ < ' + ZETA_LIGHT + ': lightly damped, risk of ringing/oscillation">' +
            '<span class="zstate">' + state + '</span><span class="zval">' + head + '</span>' +
            '<span class="zrhp">' + rhp + '</span></div>' +
            (st.warnings && st.warnings.length ? '<ul class="warn">' + st.warnings.map((w) => '<li>' + String(w).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])) + '</li>').join('') + '</ul>' : '') +
            '<div class="bstab-plots"><svg class="tplot" role="img" aria-label="loop gain T"></svg></div>';
        plotLoop(box.querySelector('.tplot'), L);
        el.svg._stab = st;
        return true;
    }

    function plotLoop(svg, L) {
        const box = svg.getBoundingClientRect();
        const W = Math.max(260, Math.round(box.width)), H = Math.max(180, Math.round(box.height));
        svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
        const Lm = 46, R = 22, T = 8, B = 24, GAP = 14;
        const hTop = Math.round((H - T - B - GAP) * 0.55);
        const top = { y0: T, y1: T + hTop }, bot = { y0: T + hTop + GAP, y1: H - B };
        const f = L.f, dB = L.T.dB, ph = L.T.phaseDeg;
        const lx0 = Math.log10(f[0]), lx1 = Math.log10(f[f.length - 1]);
        const X = (v) => Lm + (Math.log10(v) - lx0) / (lx1 - lx0) * (W - Lm - R);
        const fin = (a) => a.filter((v) => isFinite(v));
        let dmax = Math.ceil(Math.max.apply(null, fin(dB).concat([10])) / 20) * 20;
        let dmin = Math.floor(Math.min.apply(null, fin(dB).concat([-20])) / 20) * 20;
        dmin = Math.max(dmin, dmax - 160);
        let pmax = Math.ceil(Math.max.apply(null, fin(ph).concat([0])) / 90) * 90;
        let pmin = Math.floor(Math.min.apply(null, fin(ph).concat([-180])) / 90) * 90;
        const Yd = (v) => top.y0 + (dmax - Math.min(Math.max(v, dmin), dmax)) / (dmax - dmin) * (top.y1 - top.y0);
        const Yp = (v) => bot.y0 + (pmax - Math.min(Math.max(v, pmin), pmax)) / (pmax - pmin) * (bot.y1 - bot.y0);
        let s = '';
        for (let d = Math.ceil(lx0); d <= Math.floor(lx1); d++) {
            const x = X(Math.pow(10, d)).toFixed(1);
            s += '<line class="g" x1="' + x + '" y1="' + top.y0 + '" x2="' + x + '" y2="' + top.y1 + '"/><line class="g" x1="' + x + '" y1="' + bot.y0 + '" x2="' + x + '" y2="' + bot.y1 + '"/>';
            if ((d - Math.ceil(lx0)) % 2 === 0) s += '<text class="t" x="' + x + '" y="' + (H - 8) + '" text-anchor="middle">' + formatSI(Math.pow(10, d), 'Hz', 1) + '</text>';
        }
        const dstep = niceStepDb(dmax - dmin);
        for (let v = dmin; v <= dmax + 1e-9; v += dstep) {
            const y = Yd(v).toFixed(1);
            s += '<line class="g" x1="' + Lm + '" y1="' + y + '" x2="' + (W - R) + '" y2="' + y + '"/><text class="t" x="' + (Lm - 5) + '" y="' + (+y + 4) + '" text-anchor="end">' + v + '</text>';
        }
        for (let v = pmin; v <= pmax + 1e-9; v += 90) {
            const y = Yp(v).toFixed(1);
            s += '<line class="g" x1="' + Lm + '" y1="' + y + '" x2="' + (W - R) + '" y2="' + y + '"/><text class="t" x="' + (Lm - 5) + '" y="' + (+y + 4) + '" text-anchor="end">' + v + '°</text>';
        }
        // references: 0 dB and every -180 + k*360 deg inside the range
        s += '<line class="ref" x1="' + Lm + '" y1="' + Yd(0).toFixed(1) + '" x2="' + (W - R) + '" y2="' + Yd(0).toFixed(1) + '"/>';
        for (let v = -180 + 360 * Math.ceil((pmin + 180) / 360); v <= pmax; v += 360) {
            s += '<line class="ref" x1="' + Lm + '" y1="' + Yp(v).toFixed(1) + '" x2="' + (W - R) + '" y2="' + Yp(v).toFixed(1) + '"/>';
        }
        s += '<rect class="ax" x="' + Lm + '" y="' + top.y0 + '" width="' + (W - Lm - R) + '" height="' + (top.y1 - top.y0) + '"/>';
        s += '<rect class="ax" x="' + Lm + '" y="' + bot.y0 + '" width="' + (W - Lm - R) + '" height="' + (bot.y1 - bot.y0) + '"/>';
        s += '<text class="t" x="' + (Lm + 5) + '" y="' + (top.y0 + 13) + '">|T| dB</text><text class="t" x="' + (Lm + 5) + '" y="' + (bot.y0 + 13) + '">∠T</text>';
        const path = (ys, Y) => { let d = ''; for (let i = 0; i < f.length; i++) if (isFinite(ys[i])) d += (d ? 'L' : 'M') + X(f[i]).toFixed(1) + ',' + Y(ys[i]).toFixed(1); return d; };
        s += '<path class="l" d="' + path(dB, Yd) + '"/><path class="l" d="' + path(ph, Yp) + '"/>';
        // PM at the 0 dB crossovers, GM at the -180 deg crossings
        // labels stacked one line apart so close crossings stay readable
        L.pm.forEach((m, i) => {
            const x = X(m.f).toFixed(1);
            s += '<line class="mk" x1="' + x + '" y1="' + top.y0 + '" x2="' + x + '" y2="' + bot.y1 + '"/>';
            s += '<text class="mt" x="' + (+x + 3) + '" y="' + (bot.y0 + 12 + 11 * i) + '">PM ' + m.deg.toFixed(0) + '°</text>';
        });
        L.gm.forEach((m, i) => {
            const x = X(m.f).toFixed(1);
            s += '<line class="mk" x1="' + x + '" y1="' + top.y0 + '" x2="' + x + '" y2="' + bot.y1 + '"/>';
            s += '<text class="mt" x="' + (+x + 3) + '" y="' + (top.y1 - 6 - 11 * i) + '">GM ' + m.dB.toFixed(0) + ' dB</text>';
        });
        svg.innerHTML = s;
    }

    function niceStepDb(span) { for (const s of [10, 20, 40, 50, 100]) if (span / s <= 6) return s; return 100; }

    // JSON with Infinity / NaN preserved (for localStorage)
    function toJSON(o) {
        return JSON.stringify(o, (k, v) => (typeof v === 'number' && !isFinite(v) ? { $num: String(v) } : v));
    }
    function fromJSON(s) {
        return JSON.parse(s, (k, v) => (v && typeof v === 'object' && typeof v.$num === 'string' ? Number(v.$num) : v));
    }

    root.FFBode = {
        draw: draw, range: range, sweepToggle: sweepToggle, toJSON: toJSON, fromJSON: fromJSON, csv: csv, exportCsv: exportCsv,
        bindSource: bindSource, getSrc: () => Object.assign({}, srcState), setSrc: setSrc,
        RV1_SWEEP: RV1_SWEEP, CHANNEL: 'ffop', STATE_KEY: 'ffop.bode.state',
    };
})(typeof globalThis !== 'undefined' ? globalThis : this);

// --- Bode plot (|A_vs| dB + phase vs log f), shared by the dialog in index.html and bode.html ---
// FFBode.draw({ svg, sum, msg }, inputs, { fStart, fStop }, gainUnit, result?)
//   inputs   : the object passed to FFEngine.evaluate (incl. Cin/Ce2/Cout/Cbc1/Cbc2)
//   gainUnit : 'dB' | 'x' (numbers only; the magnitude axis stays in dB)
//   result   : FFEngine.evaluate(inputs) if already known (used for region warnings)
(function (root) {
    'use strict';

    const fHz = (v) => (v > 0 && isFinite(v) ? formatSI(v, 'Hz', 3) : '–');

    // -3 dB edge with the engine's flag: below / above the sweep range, or no band at all
    function fEdge(v, flag, rg) {
        if (v > 0 && isFinite(v)) return fHz(v);
        if (flag === '<fStart') return '&lt; ' + fHz(rg.fStart);
        if (flag === '>fStop') return '&gt; ' + fHz(rg.fStop);
        return '—';
    }

    function niceStep(span, target) {
        const raw = span / target, e = Math.pow(10, Math.floor(Math.log10(raw)));
        for (const m of [1, 2, 2.5, 5, 10]) if (m * e >= raw) return m * e;
        return 10 * e;
    }

    function draw(el, inp, rg, unit, res) {
        const msg = el.msg, sum = el.sum, svg = el.svg;
        if (typeof FFEngine === 'undefined' || typeof FFEngine.acSweep !== 'function') {
            msg.textContent = 'engine に acSweep が無い';
            return false;
        }
        let sw;
        try {
            if (!res) res = FFEngine.evaluate(inp);
            sw = FFEngine.acSweep(inp, { fStart: rg.fStart, fStop: rg.fStop, n: 241 });
        } catch (e) {
            msg.textContent = e && e.message ? e.message : String(e);
            svg.classList.add('stale');
            return false;
        }
        svg.classList.remove('stale');
        const inactive = [res.q1, res.q2].some((q) => q && q.region && q.region !== 'active');
        msg.textContent = inactive ? (res.warnings || []).join(' / ') : '';
        const f3 = sw.f3dB || {}, pk = sw.peak;
        sum.innerHTML =
            '<dt>A<sub>vs</sub> mid</dt><dd>' + (!isFinite(sw.midbandDB) ? '–' : unit === 'x'
                ? Number(Math.pow(10, sw.midbandDB / 20).toPrecision(4)) + '×' : sw.midbandDB.toFixed(1) + ' dB') + '</dd>' +
            '<dt>f<sub>L</sub></dt><dd>' + fEdge(f3.low, f3.lowFlag, rg) + '</dd>' +
            '<dt>f<sub>H</sub></dt><dd>' + fEdge(f3.high, f3.highFlag, rg) + '</dd>' +
            (pk && isFinite(pk.dB)   // peak.dB is relative to the mid-band level
                ? '<dt>peak</dt><dd>' + (unit === 'x' ? '×' + Math.pow(10, pk.dB / 20).toFixed(2)
                    : (pk.dB >= 0 ? '+' : '−') + Math.abs(pk.dB).toFixed(1) + ' dB') +
                  ' @ ' + formatSI(pk.f, 'Hz', 3) + '</dd>' : '');
        plot(svg, sw, rg);
        return true;
    }

    function plot(svg, sw, rg) {
        const box = svg.getBoundingClientRect();
        const W = Math.max(300, Math.round(box.width)), H = Math.max(200, Math.round(box.height));
        svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
        const L = 52, R = 16, T = 8, B = 26, GAP = 18;
        const hTop = Math.round((H - T - B - GAP) * 0.62);
        const top = { y0: T, y1: T + hTop }, bot = { y0: T + hTop + GAP, y1: H - B };
        const lx0 = Math.log10(rg.fStart), lx1 = Math.log10(rg.fStop);
        const X = (f) => L + (Math.log10(f) - lx0) / (lx1 - lx0) * (W - L - R);
        const f = sw.f || [], dB = (sw.AvS && sw.AvS.dB) || [], ph = (sw.AvS && sw.AvS.phaseDeg) || [];
        const fin = (a) => a.filter((v) => isFinite(v));
        // dB range: 10 dB grid, at most ~80 dB below the top
        let dmax = Math.max.apply(null, fin(dB).concat([0, isFinite(sw.midbandDB) ? sw.midbandDB : 0]));
        let dmin = Math.min.apply(null, fin(dB).concat([dmax - 10]));
        dmax = Math.ceil(dmax / 10) * 10; dmin = Math.max(Math.floor(dmin / 10) * 10, dmax - 80);
        const dstep = niceStep(dmax - dmin, 5);
        let pmax = Math.max.apply(null, fin(ph).concat([0])), pmin = Math.min.apply(null, fin(ph).concat([0]));
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
        const line = (ys, Y) => {
            let d = '', pen = false;
            for (let i = 0; i < f.length; i++) {
                if (!(f[i] > 0) || !isFinite(ys[i])) { pen = false; continue; }
                d += (pen ? 'L' : 'M') + X(f[i]).toFixed(1) + ',' + Y(ys[i]).toFixed(1);
                pen = true;
            }
            return d;
        };
        // reference: mid-band level (dashed) and its -3 dB level (faint)
        if (isFinite(sw.midbandDB)) {
            for (const [v, cls] of [[sw.midbandDB, 'ref'], [sw.midbandDB - 3, 'ref3']]) {
                if (v < dmin || v > dmax) continue;
                const y = Yd(v).toFixed(1);
                s += '<line class="' + cls + '" x1="' + L + '" y1="' + y + '" x2="' + (W - R) + '" y2="' + y + '"/>';
            }
        }
        s += '<path class="l" d="' + line(dB, Yd) + '"/>';
        s += '<path class="l" d="' + line(ph, Yp) + '"/>';
        // -3 dB markers
        const f3 = sw.f3dB || {};
        for (const [k, lbl] of [['low', 'f<tspan dy="3" font-size="8">L</tspan>'], ['high', 'f<tspan dy="3" font-size="8">H</tspan>']]) {
            const v = f3[k];
            if (!(v >= rg.fStart && v <= rg.fStop)) continue;
            const x = X(v).toFixed(1);
            s += '<line class="mk" x1="' + x + '" y1="' + top.y0 + '" x2="' + x + '" y2="' + bot.y1 + '"/>';
            const right = X(v) < (L + W - R) / 2;
            s += '<text class="mt" x="' + (+x + (right ? 4 : -4)) + '" y="' + (k === 'low' ? top.y1 - 6 : top.y0 + 30) +
                '" text-anchor="' + (right ? 'start' : 'end') + '">' + lbl + '<tspan dy="-3"> ' + formatSI(v, 'Hz', 3) + '</tspan></text>';
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

    // JSON with Infinity / NaN preserved (for localStorage)
    function toJSON(o) {
        return JSON.stringify(o, (k, v) => (typeof v === 'number' && !isFinite(v) ? { $num: String(v) } : v));
    }
    function fromJSON(s) {
        return JSON.parse(s, (k, v) => (v && typeof v === 'object' && typeof v.$num === 'string' ? Number(v.$num) : v));
    }

    root.FFBode = { draw: draw, range: range, toJSON: toJSON, fromJSON: fromJSON, CHANNEL: 'ffop', STATE_KEY: 'ffop.bode.state' };
})(typeof globalThis !== 'undefined' ? globalThis : this);

// --- fit.html glue: measurement table -> FFFit.fit -> tables, plot, .MODEL ---
(function () {
    'use strict';

    const $ = (id) => document.getElementById(id);
    const body = $('meas-body');
    const STORE_KEY = 'ffop.fit.v1';
    const CALC_KEY = 'ffop.inputs.v2';          // app.js state (same key/format)
    const OVR = ['IS', 'NF', 'BF', 'ISE', 'NE', 'VAF'];
    const OVR_NEXT = { auto: 'free', free: 'fix', fix: 'auto' };
    const ovr = {};
    let timer = null;
    let lastModel = '';

    // ---------- measurement table ----------
    function addRow(vals, after) {
        const tr = document.createElement('tr');
        tr.innerHTML = '<th></th>' + [0, 1, 2, 3].map((i) =>
            '<td><input data-col="' + i + '" spellcheck="false" aria-label="' + ['I_B', 'V_CE', 'I_C', 'V_BE'][i] + '"></td>').join('');
        const ins = tr.querySelectorAll('input');
        (vals || []).forEach((v, i) => { if (ins[i]) ins[i].value = v; });
        if (after && after.parentNode === body) after.after(tr); else body.appendChild(tr);
        renumber();
        return tr;
    }

    function delRow(tr) {
        if (body.rows.length <= 1) { tr.querySelectorAll('input').forEach((i) => { i.value = ''; }); return tr; }
        const next = tr.nextElementSibling || tr.previousElementSibling;
        tr.remove();
        renumber();
        return next;
    }

    function renumber() {
        Array.from(body.rows).forEach((r, i) => { r.cells[0].textContent = i + 1; });
    }

    function tableValues() {
        return Array.from(body.rows).map((r) => Array.from(r.querySelectorAll('input')).map((i) => i.value));
    }

    // Paste rows/columns from Excel (tab) or CSV (comma / semicolon)
    body.addEventListener('paste', (e) => {
        const text = (e.clipboardData || window.clipboardData).getData('text');
        if (!/[\t,;\n]/.test(text.trim())) return;          // single value: normal paste
        e.preventDefault();
        const lines = text.replace(/\r/g, '').split('\n').filter((l) => l.trim() !== '');
        let tr = e.target.closest('tr');
        const c0 = +e.target.dataset.col;
        lines.forEach((line, k) => {
            const cells = line.split(/\t|;|,/);
            if (k > 0) tr = tr.nextElementSibling || addRow(null, tr);
            const ins = tr.querySelectorAll('input');
            cells.forEach((c, j) => { if (ins[c0 + j]) ins[c0 + j].value = c.trim(); });
        });
        schedule();
    });

    body.addEventListener('keydown', (e) => {
        const tr = e.target.closest('tr');
        if (!tr) return;
        if (e.ctrlKey && e.key === 'Enter') {
            e.preventDefault();
            addRow(null, tr).querySelector('input').focus();
            schedule();
        } else if (e.ctrlKey && e.key === 'Backspace') {
            e.preventDefault();
            const col = +e.target.dataset.col;
            const n = delRow(tr);
            if (n) n.querySelectorAll('input')[col].focus();
            schedule();
        }
    });

    $('row-add').addEventListener('click', () => {
        addRow(null, body.rows[body.rows.length - 1]).querySelector('input').focus();
        schedule();
    });
    $('row-del').addEventListener('click', () => { delRow(body.rows[body.rows.length - 1]); schedule(); });

    // ---------- fix / free overrides ----------
    $('ovr').innerHTML = OVR.map((k) =>
        '<button type="button" class="ovr-b" data-k="' + k + '"><span>' + k + '</span><b></b></button>').join('');
    function paintOvr() {
        for (const b of $('ovr').querySelectorAll('button')) {
            const s = ovr[b.dataset.k] || 'auto';
            b.dataset.s = s;
            b.querySelector('b').textContent = s;
        }
    }
    $('ovr').addEventListener('click', (e) => {
        const b = e.target.closest('button');
        if (!b) return;
        ovr[b.dataset.k] = OVR_NEXT[ovr[b.dataset.k] || 'auto'];
        paintOvr();
        schedule(0);
    });

    // ---------- read inputs ----------
    function readPoints() {
        const pts = [], bad = [];
        let skipped = 0;
        Array.from(body.rows).forEach((r, i) => {
            const ins = Array.from(r.querySelectorAll('input'));
            const raw = ins.map((x) => x.value.trim());
            ins.forEach((x) => x.classList.remove('bad'));
            if (raw.every((s) => s === '')) return;                 // empty row: skipped
            let incomplete = false;
            const v = raw.map((s, j) => {
                if (s === '') { incomplete = true; return undefined; }   // row not filled in yet: skipped
                const n = parseEngineering(s);
                if (!(n > 0 && isFinite(n))) { ins[j].classList.add('bad'); bad.push('#' + (i + 1)); }
                return n;
            });
            if (incomplete) { skipped++; return; }
            pts.push({ Ib: v[0], Vce: v[1], Ic: v[2], Vbe: v[3] });
        });
        return { pts: pts, bad: Array.from(new Set(bad)), skipped: skipped };
    }

    // base model text -> { IS: .., BF: .. } (only the keys present in the text)
    function baseParams(text) {
        const p = parseSpiceModel(text), o = {};
        for (const k of p.found) o[SPICE_KEYS[k]] = p[k];
        return o;
    }

    // ---------- fit ----------
    function schedule(ms) {
        clearTimeout(timer);
        timer = setTimeout(run, ms === undefined ? 200 : ms);
    }

    function setStatus(msg, err) {
        $('fit-status').className = 'status' + (err ? ' err' : '');
        $('fit-status').textContent = msg;
    }

    function run() {
        save();
        const { pts, bad, skipped } = readPoints();
        const vtEl = $('fit-vt'), Vt = parseEngineering(vtEl.value);
        vtEl.classList.toggle('bad', !(Vt > 0 && isFinite(Vt)));
        const baseEl = $('fit-base'), bp = parseSpiceModel(baseEl.value);
        baseEl.classList.toggle('bad', bp.bad.length > 0);
        if (bad.length || !(Vt > 0 && isFinite(Vt)) || bp.bad.length) {
            return fail('入力値が不正: ' + bad.concat(!(Vt > 0) ? ['VT'] : []).concat(bp.bad.length ? ['base'] : []).join(', '));
        }
        if (!pts.length) return fail('I_B, V_CE, I_C, V_BE を入力した行が無い', true);
        if (typeof FFFit === 'undefined') return fail('fit.js が読み込まれていない');
        const opt = { Vt: Vt, base: baseParams(baseEl.value) };
        const addFree = OVR.filter((k) => ovr[k] === 'free'), noFree = OVR.filter((k) => ovr[k] === 'fix');
        let r;
        try {
            r = FFFit.fit(pts, opt);
            if (addFree.length || noFree.length) {
                // overrides on top of the automatic choice; "fix" keeps the base / default value
                const free = Array.from(new Set((r.free || []).concat(addFree))).filter((k) => noFree.indexOf(k) < 0);
                if (!free.length) throw new Error('推定するパラメータがない');
                r = FFFit.fit(pts, Object.assign({}, opt, { free: free }));
            }
        } catch (e) { return fail(e && e.message ? e.message : String(e)); }
        render(r, pts, Vt, skipped);
    }

    function fail(msg, mute) {
        setStatus(msg, !mute);
        $('fit-res').classList.add('stale');
        $('plot').classList.add('stale');
        $('to-q1').disabled = $('to-q2').disabled = $('copy').disabled = true;
    }

    const sp = (v) => formatSI(v, '', 4).replace(/\s+/g, '');
    const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

    function render(r, pts, Vt, skipped) {
        const P = r.params || {};
        const free = new Set(r.free || []);
        const names = OVR.concat(Object.keys(P).filter((k) => free.has(k) && OVR.indexOf(k) < 0));
        let h = '<table class="pairs fit-par"><tbody>';
        for (let i = 0; i < names.length; i += 2) {
            h += '<tr>' + [names[i], names[i + 1]].map((k) => k === undefined ? '<th></th><td></td><td></td>'
                : '<th>' + k + '</th><td>' + (P[k] === undefined ? '–' : sp(P[k])) + '</td><td class="fs">' +
                (free.has(k) ? '<b>free</b>' : 'fixed') + '</td>').join('') + '</tr>';
        }
        h += '</tbody></table>';

        const rp = r.points || [];
        h += '<table class="fit-pts"><thead><tr><th>#</th><th>I<sub>C</sub></th><th>I<sub>C</sub> model</th>' +
            '<th>β</th><th>β model</th><th>ΔV<sub>BE</sub> mV</th></tr></thead><tbody>';
        rp.forEach((p, i) => {
            h += '<tr><th>' + (i + 1) + '</th><td>' + fA(p.Ic) + '</td><td>' + fA(p.Ic_model) + '</td><td>' +
                fX(p.beta) + '</td><td>' + fX(p.beta_model) + '</td><td>' +
                (isFinite(p.dVbe) ? (p.dVbe * 1e3).toFixed(2) : '–') + '</td></tr>';
        });
        h += '</tbody></table>';
        if (r.warnings && r.warnings.length) {
            h += '<ul class="warn">' + r.warnings.map((w) => '<li>' + esc(w) + '</li>').join('') + '</ul>';
        }
        $('fit-res').innerHTML = h;
        $('fit-res').classList.remove('stale');
        $('plot').classList.remove('stale');

        lastModel = r.model || '';
        $('fit-model').value = lastModel;
        $('to-q1').disabled = $('to-q2').disabled = $('copy').disabled = !lastModel;
        setStatus('rms ' + (isFinite(r.rms) ? Number(r.rms).toExponential(2) : '–') +
            (r.iterations !== undefined ? ' · iter ' + r.iterations : '') +
            ' · ' + pts.length + ' pt' + (skipped ? ' (' + skipped + ' skipped)' : '') +
            (r.converged === false ? ' · not converged' : ''), r.converged === false);
        plot(r, pts, Vt);
    }

    function fA(v) { return v === undefined || v === null || !isFinite(v) ? '–' : formatSI(v, 'A', 4); }
    function fX(v) { return v === undefined || v === null || !isFinite(v) ? '–' : v.toFixed(1); }

    // ---------- plot: beta vs I_C (log x) ----------
    function plot(r, pts, Vt) {
        const svg = $('plot');
        const W = 480, H = 300, L = 46, R = 26, T = 12, B = 34;
        const meas = (r.points || []).map((p) => ({ x: p.Ic, y: p.beta })).filter((p) => p.x > 0 && isFinite(p.y));
        const ics = (r.points || []).map((p) => p.Ic > 0 ? p.Ic : p.Ic_model).filter((v) => v > 0 && isFinite(v));
        if (!ics.length) { svg.innerHTML = ''; return; }
        let lo = Math.min.apply(null, ics) / 10, hi = Math.max.apply(null, ics) * 10;
        const vces = Array.from(new Set(pts.map((p) => p.Vce))).slice(0, 3);
        const curves = [];
        if (typeof FFFit.betaCurve === 'function') {
            for (const vce of vces) {
                try { curves.push(FFFit.betaCurve(r.params, Vt, vce, lo, hi, 80).filter((c) => isFinite(c.beta) && c.Ic > 0)); } catch (e) { /* skip */ }
            }
        }
        let ymax = 0;
        for (const c of curves) for (const q of c) ymax = Math.max(ymax, q.beta);
        for (const m of meas) ymax = Math.max(ymax, m.y);
        ymax = niceMax(ymax * 1.1 || 1);
        const lx0 = Math.floor(Math.log10(lo)), lx1 = Math.ceil(Math.log10(hi));
        const X = (v) => L + (Math.log10(v) - lx0) / (lx1 - lx0) * (W - L - R);
        const Y = (v) => T + (1 - v / ymax) * (H - T - B);
        let s = '';
        // axes + ticks
        for (let d = lx0; d <= lx1; d++) {
            const x = X(Math.pow(10, d)).toFixed(1);
            s += '<line class="g" x1="' + x + '" y1="' + T + '" x2="' + x + '" y2="' + (H - B) + '"/>';
            s += '<text class="t" x="' + x + '" y="' + (H - B + 14) + '" text-anchor="middle">' + formatSI(Math.pow(10, d), 'A', 1) + '</text>';
        }
        for (let k = 0; k <= 4; k++) {
            const v = ymax * k / 4, y = Y(v).toFixed(1);
            s += '<line class="g" x1="' + L + '" y1="' + y + '" x2="' + (W - R) + '" y2="' + y + '"/>';
            s += '<text class="t" x="' + (L - 6) + '" y="' + (+y + 4) + '" text-anchor="end">' + Math.round(v) + '</text>';
        }
        s += '<line class="ax" x1="' + L + '" y1="' + (H - B) + '" x2="' + (W - R) + '" y2="' + (H - B) + '"/>';
        s += '<line class="ax" x1="' + L + '" y1="' + T + '" x2="' + L + '" y2="' + (H - B) + '"/>';
        s += '<text class="t" x="' + ((L + W - R) / 2) + '" y="' + (H - 4) + '" text-anchor="middle">I<tspan dy="3" font-size="8">C</tspan></text>';
        s += '<text class="t" x="12" y="' + ((T + H - B) / 2) + '" text-anchor="middle" transform="rotate(-90 12 ' + ((T + H - B) / 2) + ')">β</text>';
        for (const c of curves) {
            if (c.length < 2) continue;
            s += '<polyline class="m" points="' + c.map((q) => X(q.Ic).toFixed(1) + ',' + Y(q.beta).toFixed(1)).join(' ') + '"/>';
        }
        for (const m of meas) s += '<circle class="d" cx="' + X(m.x).toFixed(1) + '" cy="' + Y(m.y).toFixed(1) + '" r="3.5"/>';
        svg.innerHTML = s;
    }

    function niceMax(v) {
        const e = Math.pow(10, Math.floor(Math.log10(v)));
        for (const m of [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (m * e >= v) return m * e;
        return 10 * e;
    }

    // ---------- output ----------
    function sendTo(q) {
        if (!lastModel) return;
        let d = {};
        try { d = JSON.parse(localStorage.getItem(CALC_KEY) || '{}') || {}; } catch (e) { d = {}; }
        d[q + '-model'] = lastModel;
        try { localStorage.setItem(CALC_KEY, JSON.stringify(d)); } catch (e) { return setStatus('localStorage に書けない', true); }
        location.href = 'index.html';
    }
    $('to-q1').addEventListener('click', () => sendTo('q1'));
    $('to-q2').addEventListener('click', () => sendTo('q2'));
    $('copy').addEventListener('click', () => {
        const ta = $('fit-model');
        const done = () => setStatus('copied', false);
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(ta.value).then(done, () => { ta.select(); document.execCommand('copy'); done(); });
        } else { ta.select(); document.execCommand('copy'); done(); }
    });
    $('base-q1').addEventListener('click', () => {
        try {
            const d = JSON.parse(localStorage.getItem(CALC_KEY) || 'null');
            if (d && d['q1-model']) { $('fit-base').value = d['q1-model']; schedule(0); }
            else setStatus('計算機側の Q1 モデルが無い', true);
        } catch (e) { /* ignore */ }
    });

    // ---------- persistence ----------
    function save() {
        try {
            localStorage.setItem(STORE_KEY, JSON.stringify({
                rows: tableValues(), vt: $('fit-vt').value, base: $('fit-base').value,
                baseOpen: $('base-box').open, ovr: ovr,
            }));
        } catch (e) { /* ignore */ }
    }

    function load() {
        let d = null;
        try { d = JSON.parse(localStorage.getItem(STORE_KEY) || 'null'); } catch (e) { d = null; }
        const rows = d && Array.isArray(d.rows) && d.rows.length ? d.rows : [['1u', '5', '', ''], ['10u', '5', '', '']];
        rows.forEach((r) => addRow(r));
        if (d) {
            if (typeof d.vt === 'string') $('fit-vt').value = d.vt;
            if (typeof d.base === 'string') $('fit-base').value = d.base;
            if (d.baseOpen) $('base-box').open = true;
            if (d.ovr) for (const k of OVR) if (OVR_NEXT[d.ovr[k]]) ovr[k] = d.ovr[k];
        }
        paintOvr();
    }

    document.querySelector('.fit').addEventListener('input', (e) => { if (e.target.id !== 'fit-model') schedule(); });
    $('base-box').addEventListener('toggle', save);

    load();
    body.querySelector('input').focus();
    run();
})();

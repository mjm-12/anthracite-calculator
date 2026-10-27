// --- UI glue: read inputs, call FFEngine.evaluate, render results ---
(function () {
    'use strict';

    const $ = (id) => document.getElementById(id);
    const form = $('inputs');
    const app = document.querySelector('.app');
    const out = $('out');
    const status = $('status');
    const STORE_KEY = 'ffop.inputs.v2';

    const FIELD_IDS = ['vcc', 'rf', 'vt', 'rv1', 'rv2', 'rin',
        'ic1', 'ic2', 'vr-ratio', 'vc-ratio', 've-ratio',
        'r1', 'r2', 'r3', 'q1-model', 'q2-model'];

    // ---------- mode ----------
    function getMode() {
        return form.querySelector('input[name="mode"]:checked').value;
    }

    function applyMode() {
        const mode = getMode();
        form.querySelector('.mode-forward').hidden = mode !== 'forward';
        form.querySelector('.mode-reverse').hidden = mode !== 'reverse';
    }

    function setMode(mode, focus) {
        const r = form.querySelector('input[name="mode"][value="' + mode + '"]');
        if (!r || r.checked) { if (r && focus) r.focus(); return; }
        r.checked = true;
        if (focus) r.focus();
        applyMode();
        const a = document.activeElement;
        if (a && a !== document.body && a.offsetParent === null) {
            form.querySelector('.mode-' + mode + ' input').focus();
        }
        schedule(0);
    }

    // ---------- reading inputs ----------
    let invalid = [];

    function num(id, opts) {
        opts = opts || {};
        const el = $(id);
        const v = opts.optional ? parseOptional(el.value) : parseEngineering(el.value);
        let ok = !isNaN(v);
        if (ok && opts.positive && !(v > 0)) ok = false;
        if (ok && opts.nonneg && !(v >= 0)) ok = false;
        if (ok && opts.finite && !isFinite(v)) ok = false;
        if (ok && opts.min !== undefined && v < opts.min) ok = false;
        el.classList.toggle('bad', !ok);
        if (!ok) invalid.push(el);
        return v;
    }

    // R_BC: OPEN pressed -> Infinity; otherwise the field is required
    function bc(id) {
        if (isOpen(id)) { $(id).classList.remove('bad'); return Infinity; }
        return num(id, { positive: true });
    }

    // ---------- R_F: input, or computed when V_E ratio is given (forward) ----------
    // While computed, the RF field is read-only/greyed and shows the result;
    // the user's own RF is kept in rfKept and restored when V_E is cleared.
    let rfKept = null;

    // R_F / V_E toggle (forward only). Default and fallback: R_F mode.
    function veMode() { return $('rf-mode').getAttribute('aria-pressed') === 'true'; }

    function setVeMode(on) {
        const ve = $('ve-ratio');
        $('rf-mode').setAttribute('aria-pressed', String(on));
        for (const el of form.querySelectorAll('.ve-part')) el.hidden = !on;
        $('ratio-label').innerHTML = on ? 'V<sub>R</sub>:V<sub>C</sub>:V<sub>E</sub>' : 'V<sub>R</sub>:V<sub>C</sub>';
        if (on && ve.value.trim() === '') ve.value = '0.2';
    }

    function toggleVeMode(focusVe) {
        setVeMode(!veMode());
        if (focusVe && veMode()) $('ve-ratio').focus();
        schedule(0);
    }

    function setRfComputed(on) {
        const el = $('rf');
        if (on && rfKept === null) {
            rfKept = el.value;
            el.value = 'calc';
            el.readOnly = true;
            el.classList.add('off');
            el.classList.remove('bad');
            el.title = 'R_F = calc (V_E)';
        } else if (!on && rfKept !== null) {
            el.value = rfKept;
            rfKept = null;
            el.readOnly = false;
            el.classList.remove('off');
            el.title = '';
        }
    }

    function readRf(mode) {
        setRfComputed(mode === 'forward' && veMode());
        if (rfKept === null) return num('rf', { positive: true, finite: true });
        const v = parseEngineering(rfKept);   // engine ignores Rf when veRatio is used
        return v > 0 && isFinite(v) ? v : 100e3;
    }

    function model(id) {
        const el = $(id + '-model');
        const p = parseSpiceModel(el.value);
        const ok = p.bad.length === 0 && p.Is > 0 && p.Bf > 0 && p.Nf > 0;
        el.classList.toggle('bad', !ok);
        if (!ok) invalid.push(el);
        $(id + '-parsed').textContent = ['IS', 'BF', 'NF', 'ISE', 'NE', 'BR', 'ISC', 'NC', 'VAF']
            .map((k) => k + ' ' + fmtModel(p[k.charAt(0) + k.slice(1).toLowerCase()])).join('  ');
        return Object.assign({}, p);
    }

    function fmtModel(v) {
        return formatSI(v, '', 3).replace(/\s+/g, '');
    }

    function readInputs() {
        invalid = [];
        const mode = getMode();
        const inp = {
            mode: mode,
            Vcc: num('vcc', { positive: true, finite: true }),
            Rf: readRf(mode),
            Vt: num('vt', { positive: true, finite: true }),
            RV1: num('rv1', { positive: true }),
            RV2: num('rv2', { positive: true }),
            Rin: num('rin', { nonneg: true, finite: true }),
            Rbc1: bc('rbc1'),
            Rbc2: bc('rbc2'),
            q1: model('q1'),
            q2: model('q2'),
        };
        for (const id of ['ic1', 'ic2', 'vr-ratio', 'vc-ratio', 've-ratio', 'r1', 'r2', 'r3']) {
            $(id).classList.remove('bad');
        }
        if (mode === 'forward') {
            inp.Ic1 = num('ic1', { positive: true, finite: true });
            inp.Ic2 = num('ic2', { positive: true, finite: true });
            inp.vrRatio = num('vr-ratio', { positive: true, finite: true });
            inp.vcRatio = num('vc-ratio', { positive: true, finite: true });
            inp.veRatio = veMode() ? num('ve-ratio', { positive: true, finite: true }) : undefined;
        } else {
            inp.R1 = num('r1', { positive: true, finite: true });
            inp.R2 = num('r2', { positive: true, finite: true });
            inp.R3 = num('r3', { positive: true, finite: true });
        }
        return inp;
    }

    // ---------- formatting ----------
    const R = (v) => formatSI(v, 'Ω', 4);
    const I = (v) => formatSI(v, 'A', 4);
    const V = (v, d) => (isFinite(v) ? v.toFixed(d === undefined ? 3 : d) + ' V' : '–');
    const X = (v, d) => (isFinite(v) ? v.toFixed(d === undefined ? 1 : d) : '–');

    function row(cells, cls) {
        return '<tr' + (cls ? ' class="' + cls + '"' : '') + '>' +
            cells.map((c, i) => (i === 0 ? '<th>' + c + '</th>' : '<td>' + c + '</td>')).join('') + '</tr>';
    }

    function table(head, rows, cls) {
        return '<table class="' + (cls || '') + '">' +
            (head ? '<thead>' + row(head) + '</thead>' : '') +
            '<tbody>' + rows.join('') + '</tbody></table>';
    }

    // Two label/value pairs per row
    function pairs(list) {
        const rows = [];
        for (let i = 0; i < list.length; i += 2) {
            const a = list[i], b = list[i + 1];
            rows.push('<tr><th>' + a[0] + '</th><td>' + a[1] + '</td>' +
                (b ? '<th>' + b[0] + '</th><td>' + b[1] + '</td>' : '<th></th><td></td>') + '</tr>');
        }
        return '<table class="pairs"><tbody>' + rows.join('') + '</tbody></table>';
    }

    function render(r, inp) {
        let h = '';

        // Primary result
        if (r.mode === 'forward') {
            const rs = [];
            rs.push(row(['R<sub>1</sub>', R(r.R1)]));
            rs.push(row(['R<sub>2</sub>', R(r.R2)]));
            rs.push(row(['R<sub>3</sub>', R(r.R3)]));
            if (r.RfComputed) rs.push(row(['R<sub>F</sub>', R(r.Rf)]));
            h += table(null, rs, 'primary');
        } else {
            h += table(null, [
                row(['I<sub>C1</sub>', I(r.Ic1)]),
                row(['I<sub>C2</sub>', I(r.Ic2)]),
            ], 'primary');
        }

        // Node voltages
        h += pairs([
            ['V<sub>B1</sub>', V(r.nodes.VB1)], ['V<sub>C1</sub>', V(r.nodes.VC1)],
            ['V<sub>E2</sub>', V(r.nodes.VE2)], ['V<sub>C2</sub>', V(r.nodes.VC2)],
        ]);

        // Per-transistor
        const q1 = r.q1, q2 = r.q2, qr = [];
        qr.push(row(['V<sub>BE</sub>', V(q1.Vbe, 4), V(q2.Vbe, 4)]));
        qr.push(row(['I<sub>B</sub>', I(q1.Ib), I(q2.Ib)]));
        qr.push(row(['h<sub>FE</sub>', X(q1.hfe), X(q2.hfe)]));
        if (q1.beta_ac !== undefined) qr.push(row(['β<sub>ac</sub>', X(q1.beta_ac), X(q2.beta_ac)]));
        qr.push(row(['r<sub>ie</sub>', R(q1.rie), R(q2.rie)]));
        if (q1.ro !== undefined) qr.push(row(['r<sub>o</sub>', R(q1.ro), R(q2.ro)]));
        qr.push(row(['V<sub>CE</sub>', V(q1.Vce), V(q2.Vce)]));
        if (q1.Vbc !== undefined) qr.push(row(['V<sub>BC</sub>', V(q1.Vbc, 4), V(q2.Vbc, 4)]));
        if (q1.region || q2.region) qr.push(row(['region', region(q1.region), region(q2.region)]));
        h += table(['', 'Q<sub>1</sub>', 'Q<sub>2</sub>'], qr, 'q');

        // Branch currents
        const br = [['I<sub>F</sub>', I(r.branch.If)]];
        if (isFinite(inp.Rbc1)) br.push(['I<sub>BC1</sub>', I(r.branch.Ibc1)]);
        if (isFinite(inp.Rbc2)) br.push(['I<sub>BC2</sub>', I(r.branch.Ibc2)]);
        if (r.branch.I1 !== undefined) br.push(['I<sub>1</sub>', I(r.branch.I1)]);
        if (r.branch.I2 !== undefined) br.push(['I<sub>2</sub>', I(r.branch.I2)]);
        if (r.branch.I3 !== undefined) br.push(['I<sub>3</sub>', I(r.branch.I3)]);
        h += pairs(br);

        // AC
        const ac = r.ac || {};
        const avs = avS(ac, inp);
        const gain = (v, db) => (isFinite(v) ? Number(v.toPrecision(4)) : '–') + '×  ' + X(db) + ' dB';
        const acl = [
            ['A<sub>vs</sub>', '<b>' + gain(avs.AvS, avs.AvSdB) + '</b>'], ['A<sub>v</sub>', gain(ac.Av, ac.AvdB)],
            ['R<sub>E</sub>', R(ac.RE)], ['R<sub>C</sub>', R(ac.RC)],
            ['Z<sub>in</sub>', R(ac.Zin)],
        ];
        h += pairs(acl);

        // Swing
        const sw = r.swing || {};
        const vr = sw.VR, vc = sw.VC;
        const ve = sw.VE !== undefined ? sw.VE : (r.nodes ? r.nodes.VE2 : NaN);
        let ratio = '–';
        if (vc > 0 && isFinite(vr) && isFinite(ve)) {   // normalised to V_C = 1
            ratio = (vr / vc).toFixed(2) + ' : 1 : ' + (ve / vc).toFixed(2);
        }
        h += pairs([
            ['V<sub>R</sub>', V(vr)], ['V<sub>C</sub>', V(vc)],
            ['V<sub>E</sub>', V(ve)], ['V<sub>R</sub>:V<sub>C</sub>:V<sub>E</sub>', ratio],
        ]);

        if (r.warnings && r.warnings.length) {
            h += '<ul class="warn">' + r.warnings.map((w) => '<li>' + esc(w) + '</li>').join('') + '</ul>';
        }
        out.innerHTML = h;
        out.classList.remove('stale');

        const s = r.solver;
        status.className = 'status';
        const parts = [];
        if (s && s.roots !== undefined) parts.push('roots ' + s.roots);
        if (s && s.maxResidual !== undefined && isFinite(s.maxResidual)) {
            parts.push('res ' + Number(s.maxResidual).toExponential(0).replace('e+', 'e'));
        }
        status.textContent = parts.join(' · ');
        if (flash) { status.className = 'status' + (flash.err ? ' err' : ''); status.textContent = flash.msg; }
        flash = null;
    }

    // Gain from the source v_s through R_in; engine value if present, else Av·Zin/(Rin+Zin)
    function avS(ac, inp) {
        if (ac.AvS !== undefined) return { AvS: ac.AvS, AvSdB: ac.AvSdB !== undefined ? ac.AvSdB : 20 * Math.log10(ac.AvS) };
        const v = ac.Av * ac.Zin / (inp.Rin + ac.Zin);
        return { AvS: v, AvSdB: 20 * Math.log10(v) };
    }

    function region(g) {
        if (!g) return '–';
        const t = { active: 'act', saturation: 'sat', cutoff: 'off' }[g] || esc(g);
        return g === 'active' ? t : '<b class="hot">' + t + '</b>';
    }

    function esc(s) {
        return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    }

    function showError(msg) {
        status.className = 'status err';
        status.textContent = msg;
        flash = null;
        last = null;
        out.classList.add('stale');
    }

    // ---------- compute ----------
    let timer = null;
    let flash = null;   // one-shot status message ({ msg, err }) shown after the next successful compute
    let last = null;    // { inp, res } of the last successful evaluation

    function schedule(ms) {
        clearTimeout(timer);
        timer = setTimeout(compute, ms === undefined ? 150 : ms);
    }

    function compute() {
        save();
        const inp = readInputs();
        if (invalid.length) {
            showError('入力値が不正: ' + invalid.map(labelOf).join(', '));
            return;
        }
        if (typeof FFEngine === 'undefined') {
            showError('engine.js が読み込まれていない');
            return;
        }
        try {
            const res = FFEngine.evaluate(inp);
            last = { inp: inp, res: res };
            render(res, inp);
            if (rfKept !== null) $('rf').value = res.RfComputed && isFinite(res.Rf) ? formatEng(parseFloat(res.Rf.toPrecision(4))) : 'calc';
        } catch (e) {
            showError(e && e.message ? e.message : String(e));
        }
    }

    function labelOf(el) {
        const l = form.querySelector('label[for="' + el.id + '"]');
        return l ? l.textContent.trim() : el.id;
    }

    // ---------- ArrowUp/Down stepping ----------
    function stepValue(el, dir) {
        const spec = el.dataset.step;
        if (!spec) return false;
        if (el.readOnly) return false;
        if (el.value.trim() === '' && el.dataset.start) { el.value = el.dataset.start; return true; }
        let v = parseEngineering(el.value);
        if (spec === 'e24') {
            if (!isFinite(v) || !(v > 0)) {
                if (dir < 0 && v === Infinity) v = 1e6; else return false;
                el.value = formatEng(v);
                return true;
            }
            const e = nearestE24(v);
            const exp = Math.floor(Math.log10(e) + 1e-9);
            const mant = Math.round(e / Math.pow(10, exp) * 10) / 10;
            let idx = E24.indexOf(mant);
            if (idx < 0) idx = 0;
            let ne;
            if (Math.abs(e - v) / v > 1e-6) {
                // off-grid: snap to the neighbour in the requested direction
                ne = e;
                if ((dir > 0 && e <= v) || (dir < 0 && e >= v)) ne = shiftE24(idx, exp, dir);
            } else {
                ne = shiftE24(idx, exp, dir);
            }
            el.value = formatEng(ne);
            return true;
        }
        if (!isFinite(v)) return false;
        const st = parseEngineering(spec);
        let nv = Math.round((v + dir * st) / st) * st;
        const min = el.dataset.min !== undefined ? parseFloat(el.dataset.min) : st;
        if (nv < min) nv = min;
        nv = parseFloat(nv.toPrecision(10));
        el.value = /[a-z]/i.test(spec) ? formatEng(nv) : String(nv);   // plain ratios stay "0.2
        return true;
    }

    function shiftE24(idx, exp, dir) {
        idx += dir;
        if (idx >= E24.length) { idx = 0; exp += 1; }
        if (idx < 0) { idx = E24.length - 1; exp -= 1; }
        return parseFloat((E24[idx] * Math.pow(10, exp)).toPrecision(3));
    }

    // 4700 -> "4.7k", 5e-5 -> "50u", 1e6 -> "1M"
    function formatEng(v) {
        if (v === 0) return '0';
        const a = Math.abs(v);
        const t = [[1e6, 'M'], [1e3, 'k'], [1, ''], [1e-3, 'm'], [1e-6, 'u'], [1e-9, 'n'], [1e-12, 'p']];
        for (const [m, p] of t) {
            if (a >= m * 0.9995) return String(parseFloat((v / m).toPrecision(6))) + p;
        }
        return String(v);
    }

    // ---------- R_BC OPEN toggles ----------
    // Pressed: R_BC = ∞, the field is read-only and shows ∞; the typed value is
    // kept and comes back on release. Typing / stepping in the field releases it.
    // Released with an empty field = invalid (accent border), not silently re-opened.
    const BC_IDS = ['rbc1', 'rbc2'];
    const kept = { rbc1: '', rbc2: '' };
    const SCHEM = { '00': 'schematic.svg', '10': 'schematic_o1.svg', '01': 'schematic_o2.svg', '11': 'schematic_o12.svg' };
    const schemImg = $('schematic');

    function isOpen(id) { return $(id + '-open').getAttribute('aria-pressed') === 'true'; }

    function setOpen(id, open, fresh) {
        const el = $(id);
        if (isOpen(id) !== open) {
            if (open) { kept[id] = el.value; el.value = ''; }
            else el.value = fresh ? '' : kept[id];
        }
        $(id + '-open').setAttribute('aria-pressed', String(open));
        el.readOnly = open;
        el.classList.toggle('off', open);
        updateSchematic();
    }

    function updateSchematic() {
        const key = (isOpen('rbc1') ? '1' : '0') + (isOpen('rbc2') ? '1' : '0');
        const src = SCHEM[key];
        if (schemImg.getAttribute('src') !== src) schemImg.setAttribute('src', src);
    }
    // Missing variant -> fall back to the plain schematic
    schemImg.addEventListener('error', () => {
        if (schemImg.getAttribute('src') !== 'schematic.svg') schemImg.setAttribute('src', 'schematic.svg');
    });
    for (const f of Object.values(SCHEM)) { const im = new Image(); im.src = f; }
    // Drawing aspect -> CSS --ar (box sized tight to the drawing; no hard-coded ratio)
    function setAspect() {
        if (schemImg.naturalWidth > 0 && schemImg.naturalHeight > 0) {
            document.documentElement.style.setProperty('--ar', String(schemImg.naturalWidth / schemImg.naturalHeight));
        }
    }
    schemImg.addEventListener('load', setAspect);
    if (schemImg.complete) setAspect();

    for (const id of BC_IDS) {
        const btn = $(id + '-open'), el = $(id);
        btn.addEventListener('click', () => {
            const open = !isOpen(id);
            setOpen(id, open);
            if (!open && el.value === '') el.focus();
            schedule(0);
        });
        el.addEventListener('keydown', (e) => {
            if (!isOpen(id) || e.ctrlKey || e.metaKey || e.altKey) return;
            if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
                setOpen(id, false);
                if (el.value === '') el.value = '1M';
                e.preventDefault();
                e.stopPropagation();
                schedule(0);
            } else if (e.key.length === 1 || e.key === 'Backspace' || e.key === 'Delete') {
                setOpen(id, false, true);   // start a fresh entry; the key then types normally
            }
        });
        el.addEventListener('paste', () => { if (isOpen(id)) setOpen(id, false, true); });
    }

    // ---------- persistence (per-browser convenience) ----------
    // Full input state as typed (strings / booleans)
    function getState() {
        const d = { mode: getMode(), rfmode: veMode() ? 've' : 'rf' };
        for (const id of FIELD_IDS) d[id] = $(id).value;
        if (rfKept !== null) d.rf = rfKept;
        for (const id of BC_IDS) {
            d[id + '-open'] = isOpen(id);
            d[id] = isOpen(id) ? kept[id] : $(id).value;
        }
        return d;
    }

    // Apply a (possibly partial) state; absent keys keep their current value.
    function applyState(d) {
        for (const id of FIELD_IDS) {
            if (typeof d[id] !== 'string') continue;
            if (id === 'rf' && rfKept !== null) rfKept = d[id]; else $(id).value = d[id];
        }
        for (const id of BC_IDS) {
            const hasV = typeof d[id] === 'string', hasO = typeof d[id + '-open'] === 'boolean';
            if (!hasV && !hasO) continue;
            const open = hasO ? d[id + '-open'] : isOpen(id);
            const v = hasV ? d[id] : (isOpen(id) ? kept[id] : $(id).value);
            setOpen(id, open);
            if (open) kept[id] = v; else $(id).value = v;
        }
        if (d.rfmode === 've' || d.rfmode === 'rf') setVeMode(d.rfmode === 've');
        if (d.mode === 'reverse' || d.mode === 'forward') {
            form.querySelector('input[name="mode"][value="' + d.mode + '"]').checked = true;
        }
        applyMode();
    }

    function save() {
        try { localStorage.setItem(STORE_KEY, JSON.stringify(getState())); } catch (e) { /* storage unavailable */ }
    }

    function load() {
        try {
            const d = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
            if (!d) return;
            // no rfmode key (older state, even with a V_E value) -> R_F mode
            if (d.rfmode !== 've') d.rfmode = 'rf';
            applyState(d);
        } catch (e) { /* ignore */ }
    }

    // ---------- CSV export / import ----------
    // [CSV key, state key, unit]
    const CSV_PARAMS = [
        ['mode', 'mode', ''], ['rfmode', 'rfmode', ''],
        ['vcc', 'vcc', 'V'], ['rf', 'rf', 'Ω'], ['rv1', 'rv1', 'Ω'], ['rv2', 'rv2', 'Ω'], ['rin', 'rin', 'Ω'],
        ['ic1', 'ic1', 'A'], ['ic2', 'ic2', 'A'],
        ['vr', 'vr-ratio', ''], ['vc', 'vc-ratio', ''], ['ve', 've-ratio', ''],
        ['r1', 'r1', 'Ω'], ['r2', 'r2', 'Ω'], ['r3', 'r3', 'Ω'],
        ['rbc1_open', 'rbc1-open', ''], ['rbc1', 'rbc1', 'Ω'],
        ['rbc2_open', 'rbc2-open', ''], ['rbc2', 'rbc2', 'Ω'],
        ['vt', 'vt', 'V'], ['q1_model', 'q1-model', ''], ['q2_model', 'q2-model', ''],
    ];

    function resultRows(r, inp) {
        const rows = [];
        const add = (key, v, unit) => {
            if (v === undefined || v === null) return;
            rows.push(['result', key, String(v), unit]);
        };
        if (r.mode === 'forward') {
            add('R1', r.R1, 'Ω'); add('R2', r.R2, 'Ω'); add('R3', r.R3, 'Ω');
            if (r.RfComputed) add('RF', r.Rf, 'Ω');
        }
        add('IC1', r.Ic1, 'A'); add('IC2', r.Ic2, 'A');
        const n = r.nodes || {};
        add('VB1', n.VB1, 'V'); add('VC1', n.VC1, 'V'); add('VE2', n.VE2, 'V'); add('VC2', n.VC2, 'V');
        for (const q of ['q1', 'q2']) {
            const t = r[q] || {}, Q = q.toUpperCase() + '.';
            add(Q + 'Vbe', t.Vbe, 'V'); add(Q + 'Ib', t.Ib, 'A'); add(Q + 'hfe', t.hfe, '');
            add(Q + 'beta_ac', t.beta_ac, ''); add(Q + 'rie', t.rie, 'Ω'); add(Q + 'ro', t.ro, 'Ω');
            add(Q + 'Vce', t.Vce, 'V'); add(Q + 'Vbc', t.Vbc, 'V'); add(Q + 'region', t.region, '');
        }
        const b = r.branch || {};
        add('IF', b.If, 'A');
        if (isFinite(inp.Rbc1)) add('IBC1', b.Ibc1, 'A');
        if (isFinite(inp.Rbc2)) add('IBC2', b.Ibc2, 'A');
        add('I1', b.I1, 'A'); add('I2', b.I2, 'A'); add('I3', b.I3, 'A');
        const a = r.ac || {};
        add('RE', a.RE, 'Ω'); add('RC', a.RC, 'Ω'); add('Av', a.Av, ''); add('AvdB', a.AvdB, 'dB');
        const s = avS(a, inp);
        add('AvS', s.AvS, ''); add('AvSdB', s.AvSdB, 'dB'); add('Zin', a.Zin, 'Ω');
        const sw = r.swing || {};
        add('VR', sw.VR, 'V'); add('VC', sw.VC, 'V');
        add('VE', sw.VE !== undefined ? sw.VE : n.VE2, 'V');
        return rows;
    }

    function stamp(d) {
        const p = (x) => String(x).padStart(2, '0');
        return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
    }

    function buildCsv() {
        clearTimeout(timer);
        compute();   // results must match the current inputs
        const st = getState(), now = new Date();
        const rows = [['section', 'key', 'value', 'unit']];
        rows.push(['meta', 'tool', 'Fuzz Face OP', '']);
        rows.push(['meta', 'exported', now.toISOString(), '']);
        if (typeof FFEngine !== 'undefined' && FFEngine.version) rows.push(['meta', 'engine', String(FFEngine.version), '']);
        if (last && last.res.solver) {
            const s = last.res.solver;
            if (s.method) rows.push(['meta', 'solver', s.method, '']);
            if (s.roots !== undefined) rows.push(['meta', 'roots', String(s.roots), '']);
            if (s.maxResidual !== undefined) rows.push(['meta', 'maxResidual', String(s.maxResidual), '']);
        }
        if (!last) rows.push(['meta', 'error', status.textContent, '']);
        for (const [key, sk, unit] of CSV_PARAMS) rows.push(['param', key, String(st[sk]), unit]);
        if (last) {
            for (const r of resultRows(last.res, last.inp)) rows.push(r);
            for (const w of last.res.warnings || []) rows.push(['warning', '', w, '']);
        }
        return { text: '\uFEFF' + toCsv(rows), name: 'fuzzface_' + st.mode + '_' + stamp(now) + '.csv' };
    }

    function exportCsv() {
        const c = buildCsv();
        const url = URL.createObjectURL(new Blob([c.text], { type: 'text/csv;charset=utf-8' }));
        const a = document.createElement('a');
        a.href = url;
        a.download = c.name;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    // Only `param` rows are read; unknown keys are ignored, missing keys keep the current value.
    function importCsvText(text) {
        const d = {};
        let seen = 0;
        for (const row of parseCsv(text)) {
            if (row.length < 3 || row[0].trim() !== 'param') continue;
            const m = CSV_PARAMS.find((p) => p[0] === row[1].trim());
            if (!m) continue;
            const v = row[2];
            d[m[1]] = /-open$/.test(m[1]) ? /^(true|1|yes)$/i.test(v.trim()) : v;
            seen++;
        }
        if (!seen) throw new Error('param 行が無い');
        applyState(d);
        flash = { msg: 'CSV 読込: ' + seen + ' 項目', err: false };
        clearTimeout(timer);
        compute();
        return seen;
    }

    function importFile(file) {
        if (!file) return;
        file.text().then((text) => {
            try { importCsvText(text); } catch (e) {
                status.className = 'status err';
                status.textContent = 'CSV 読込失敗: ' + e.message;
            }
        });
    }

    $('csv-out').addEventListener('click', exportCsv);
    $('csv-in').addEventListener('click', () => $('csv-file').click());
    $('csv-file').addEventListener('change', (e) => { importFile(e.target.files[0]); e.target.value = ''; });
    document.addEventListener('dragover', (e) => {
        if (e.dataTransfer && Array.from(e.dataTransfer.types).includes('Files')) {
            e.preventDefault();
            document.body.classList.add('drop');
        }
    });
    document.addEventListener('dragleave', (e) => { if (!e.relatedTarget) document.body.classList.remove('drop'); });
    document.addEventListener('drop', (e) => {
        document.body.classList.remove('drop');
        if (!e.dataTransfer || !e.dataTransfer.files.length) return;
        e.preventDefault();
        importFile(e.dataTransfer.files[0]);
    });
    window.FFApp = { buildCsv: buildCsv, importCsvText: importCsvText };   // test hook

    // ---------- events ----------
    app.addEventListener('input', (e) => { if (e.target.id !== 'csv-file') schedule(); });
    app.addEventListener('change', (e) => {
        if (e.target.id === 'csv-file') return;
        if (e.target.name === 'mode') { applyMode(); schedule(0); } else schedule();
    });

    app.addEventListener('keydown', (e) => {
        const el = e.target;
        if (el.tagName === 'INPUT' && el.type !== 'radio' && (e.key === 'ArrowUp' || e.key === 'ArrowDown') && !e.altKey && !e.ctrlKey) {
            if (stepValue(el, e.key === 'ArrowUp' ? 1 : -1)) {
                e.preventDefault();
                schedule(0);
            }
        } else if (e.key === 'Enter' && el.tagName === 'INPUT') {
            e.preventDefault();
            schedule(0);
        }
    });

    document.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && !e.altKey && (e.key === 's' || e.key === 'S')) { e.preventDefault(); exportCsv(); return; }
        if ((e.ctrlKey || e.metaKey) && !e.altKey && (e.key === 'o' || e.key === 'O')) { e.preventDefault(); $('csv-file').click(); return; }
        const k = e.code === 'Digit1' || e.code === 'Numpad1' ? '1'
            : e.code === 'Digit2' || e.code === 'Numpad2' ? '2' : e.key;
        if (e.altKey && !e.ctrlKey && !e.metaKey && (e.code === 'Digit3' || e.code === 'Numpad3' || e.key === '3')) {
            e.preventDefault();
            if (getMode() === 'forward') toggleVeMode(false);
            return;
        }
        if (e.altKey && !e.ctrlKey && !e.metaKey && (k === '1' || k === '2')) {
            e.preventDefault();
            setMode(k === '1' ? 'forward' : 'reverse', false);
        }
    });

    $('rf-mode').addEventListener('click', () => toggleVeMode(false));

    load();
    updateSchematic();
    applyMode();   // load() may not have run applyState (no saved state)
    compute();
})();

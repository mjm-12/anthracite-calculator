// --- UI glue: read inputs, call FFEngine.evaluate, render results ---
(function () {
    'use strict';

    const $ = (id) => document.getElementById(id);
    const form = $('inputs');
    const app = document.querySelector('.app');
    const out = $('out');
    const status = $('status');
    const STORE_KEY = 'ffop.inputs.v2';

    const FIELD_IDS = ['vcc', 'rf', 'vt', 'rv1', 'rv2', 'rin', 'cin', 'ce2', 'cout', 'fstart', 'fstop',
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
        $('xfer').innerHTML = mode === 'forward' ? '→ R→I<sub>C</sub>' : '→ I<sub>C</sub>→R';
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
        const cap = id.charAt(0) === 'c';     // C_BC: OPEN = absent = 0 F; R_BC: OPEN = ∞
        if (isOpen(id)) { $(id).classList.remove('bad'); return cap ? 0 : Infinity; }
        return num(id, cap ? { positive: true, finite: true } : { positive: true });
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
            Cin: num('cin', { positive: true, finite: true }),
            Ce2: num('ce2', { positive: true, finite: true }),
            Cout: num('cout', { positive: true, finite: true }),
            Rbc1: bc('rbc1'),
            Rbc2: bc('rbc2'),
            Cbc1: bc('cbc1'),
            Cbc2: bc('cbc2'),
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
        const gain = (v, db) => gainUnit === 'x'
            ? (isFinite(v) ? Number(v.toPrecision(4)) + '×' : '–') : (isFinite(db) ? db.toFixed(1) + ' dB' : '–');
        const acl = [
            ['A<sub>vs</sub> <button type="button" class="seg2 gu" id="gain-unit" aria-pressed="' + (gainUnit === 'x') +
                '" aria-label="gain unit dB / ×" title="dB / × (Alt+G)"><span>dB</span><span>×</span></button>',
             '<b>' + gain(avs.AvS, avs.AvSdB) + '</b>'], ['A<sub>v</sub>', gain(ac.Av, ac.AvdB)],
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
        $('xfer').disabled = false;
        if (typeof bodeRefresh === 'function') bodeRefresh(r, inp);

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
        $('xfer').disabled = true;
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
        if (el.dataset.lbl) return el.dataset.lbl;
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
    // C_BC: same OPEN semantics; OPEN = capacitor absent (0 F).
    const BC_IDS = ['rbc1', 'rbc2', 'cbc1', 'cbc2'];
    const kept = { rbc1: '', rbc2: '', cbc1: '', cbc2: '' };
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

    // Schematic layers: each optional branch is its own image, faint when OPEN (absent)
    for (const im of document.querySelectorAll('.schematic .layer')) {
        im.addEventListener('error', () => { im.hidden = true; });
        if (im.complete && im.naturalWidth === 0) im.hidden = true;
    }
    function updateSchematic() {
        for (const im of document.querySelectorAll('.schematic .layer')) {
            im.style.opacity = isOpen(im.dataset.for) ? '0.25' : '1';
        }
    }
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
        const d = { mode: getMode(), rfmode: veMode() ? 've' : 'rf', 'gain-unit': gainUnit };
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
        if (d['gain-unit'] === 'dB' || d['gain-unit'] === 'x') gainUnit = d['gain-unit'];
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
        ['mode', 'mode', ''], ['rfmode', 'rfmode', ''], ['gain_unit', 'gain-unit', ''],
        ['vcc', 'vcc', 'V'], ['rf', 'rf', 'Ω'], ['rv1', 'rv1', 'Ω'], ['rv2', 'rv2', 'Ω'], ['rin', 'rin', 'Ω'],
        ['cin', 'cin', 'F'], ['ce2', 'ce2', 'F'], ['cout', 'cout', 'F'],
        ['ic1', 'ic1', 'A'], ['ic2', 'ic2', 'A'],
        ['vr', 'vr-ratio', ''], ['vc', 'vc-ratio', ''], ['ve', 've-ratio', ''],
        ['r1', 'r1', 'Ω'], ['r2', 'r2', 'Ω'], ['r3', 'r3', 'Ω'],
        ['rbc1_open', 'rbc1-open', ''], ['rbc1', 'rbc1', 'Ω'],
        ['rbc2_open', 'rbc2-open', ''], ['rbc2', 'rbc2', 'Ω'],
        ['cbc1_open', 'cbc1-open', ''], ['cbc1', 'cbc1', 'F'],
        ['cbc2_open', 'cbc2-open', ''], ['cbc2', 'cbc2', 'F'],
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

    // ---------- transfer the result to the other mode ----------
    // forward -> reverse: R1..R3 (and a computed R_F) become inputs
    // reverse -> forward: I_C1, I_C2 and V_R:V_C (normalised to V_C = 1) become targets; R_F mode
    const sig6 = (v) => String(parseFloat(v.toPrecision(6)));
    function transfer() {
        clearTimeout(timer);
        compute();
        if (!last) return;
        const r = last.res;
        if (getMode() === 'forward') {
            $('r1').value = formatEng(r.R1);
            $('r2').value = formatEng(r.R2);
            $('r3').value = formatEng(r.R3);
            if (r.RfComputed && isFinite(r.Rf)) {
                setVeMode(false);
                setRfComputed(false);
                $('rf').value = formatEng(r.Rf);
            }
            setMode('reverse', false);
        } else {
            $('ic1').value = formatEng(r.Ic1);
            $('ic2').value = formatEng(r.Ic2);
            const sw = r.swing || {};
            if (sw.VR > 0 && sw.VC > 0) {
                $('vr-ratio').value = sig6(sw.VR / sw.VC);
                $('vc-ratio').value = '1';
            }
            setVeMode(false);
            setMode('forward', false);
        }
        for (const id of ['r1', 'r2', 'r3', 'rf', 'ic1', 'ic2', 'vr-ratio', 'vc-ratio']) $(id).classList.remove('bad');
        clearTimeout(timer);
        compute();
    }
    $('xfer').addEventListener('click', transfer);

    // ---------- gain unit (dB / ×): display only; CSV results keep both ----------
    let gainUnit = 'dB';
    function toggleGainUnit() {
        const hadFocus = document.activeElement && document.activeElement.id === 'gain-unit';
        gainUnit = gainUnit === 'dB' ? 'x' : 'dB';
        clearTimeout(timer);
        compute();
        if (hadFocus && $('gain-unit')) $('gain-unit').focus();
    }
    out.addEventListener('click', (e) => { if (e.target.closest('#gain-unit')) toggleGainUnit(); });

    // ---------- Bode dialog ----------
    const bdlg = $('bdlg'), bplot = $('bplot');

    function openBode() {
        bdlg.showModal();
        $('fstart').focus();
        clearTimeout(timer);
        compute();
        if (!last) drawBode(null);
    }

    // called from render() after every successful evaluation
    function bodeRefresh(r, inp) {
        if (bdlg.open) drawBode({ r: r, inp: inp });
    }

    bdlg.addEventListener('input', () => schedule());
    bdlg.addEventListener('keydown', (e) => {
        const el = e.target;
        if (el.tagName === 'INPUT' && (e.key === 'ArrowUp' || e.key === 'ArrowDown') && !e.altKey && !e.ctrlKey) {
            if (stepValue(el, e.key === 'ArrowUp' ? 1 : -1)) { e.preventDefault(); schedule(0); }
        } else if (e.key === 'Enter' && el.tagName === 'INPUT') { e.preventDefault(); schedule(0); }
    });
    $('bform').addEventListener('submit', (e) => e.preventDefault());
    $('bclose').addEventListener('click', () => bdlg.close());
    $('bode-btn').addEventListener('click', openBode);
    bdlg.addEventListener('close', () => $('bode-btn').focus());
    window.addEventListener('resize', () => { if (bdlg.open && last) drawBode({ r: last.res, inp: last.inp }); });

    function bodeRange() {
        const a = parseEngineering($('fstart').value), b = parseEngineering($('fstop').value);
        const ok = a > 0 && b > a && isFinite(b);
        $('fstart').classList.toggle('bad', !(a > 0 && isFinite(a)));
        $('fstop').classList.toggle('bad', !(b > 0 && isFinite(b)) || (a > 0 && !(b > a)));
        return ok ? { fStart: a, fStop: b } : null;
    }

    function drawBode(st) {
        const msg = $('bmsg'), sum = $('bsum');
        if (!st) { msg.textContent = status.textContent; bplot.innerHTML = ''; sum.innerHTML = ''; return; }
        const rg = bodeRange();
        if (!rg) { msg.textContent = '入力値が不正: f'; return; }
        if (typeof FFEngine.acSweep !== 'function') { msg.textContent = 'engine に acSweep が無い'; return; }
        let sw;
        try {
            sw = FFEngine.acSweep(st.inp, { fStart: rg.fStart, fStop: rg.fStop, n: 241 });
        } catch (e) { msg.textContent = e && e.message ? e.message : String(e); return; }
        const r = st.r;
        const inactive = [r.q1, r.q2].some((q) => q && q.region && q.region !== 'active');
        msg.textContent = inactive ? (r.warnings || []).join(' / ') : '';
        const f3 = sw.f3dB || {};
        const pk = sw.peak;
        sum.innerHTML =
            '<dt>A<sub>vs</sub> mid</dt><dd>' + (!isFinite(sw.midbandDB) ? '–' : gainUnit === 'x'
                ? Number(Math.pow(10, sw.midbandDB / 20).toPrecision(4)) + '×' : sw.midbandDB.toFixed(1) + ' dB') + '</dd>' +
            '<dt>f<sub>L</sub></dt><dd>' + fEdge(f3.low, f3.lowFlag, rg) + '</dd>' +
            '<dt>f<sub>H</sub></dt><dd>' + fEdge(f3.high, f3.highFlag, rg) + '</dd>' +
            (pk && isFinite(pk.dB)   // peak.dB is relative to the mid-band level
                ? '<dt>peak</dt><dd>' + (gainUnit === 'x' ? '×' + Math.pow(10, pk.dB / 20).toFixed(2)
                    : (pk.dB >= 0 ? '+' : '−') + Math.abs(pk.dB).toFixed(1) + ' dB') +
                  ' @ ' + formatSI(pk.f, 'Hz', 3) + '</dd>' : '');
        plotBode(sw, rg);
    }

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

    function plotBode(sw, rg) {
        const box = bplot.getBoundingClientRect();
        const W = Math.max(300, Math.round(box.width)), H = Math.max(200, Math.round(box.height));
        bplot.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
        const L = 52, R = 16, T = 8, B = 26, GAP = 18;
        const hTop = Math.round((H - T - B - GAP) * 0.62), hBot = H - T - B - GAP - hTop;
        const top = { y0: T, y1: T + hTop }, bot = { y0: T + hTop + GAP, y1: H - B };
        const lx0 = Math.log10(rg.fStart), lx1 = Math.log10(rg.fStop);
        const X = (f) => L + (Math.log10(f) - lx0) / (lx1 - lx0) * (W - L - R);
        const f = sw.f || [], dB = (sw.AvS && sw.AvS.dB) || [], ph = (sw.AvS && sw.AvS.phaseDeg) || [];
        const fin = (a) => a.filter((v) => isFinite(v));
        // dB range: 10 dB grid, at most ~80 dB below the peak
        let dmax = Math.max.apply(null, fin(dB).concat([0, isFinite(sw.midbandDB) ? sw.midbandDB : 0])), dmin = Math.min.apply(null, fin(dB).concat([dmax - 10]));
        dmax = Math.ceil(dmax / 10) * 10; dmin = Math.max(Math.floor(dmin / 10) * 10, dmax - 80);
        const dstep = niceStep(dmax - dmin, 5);
        let pmax = Math.max.apply(null, fin(ph).concat([0])), pmin = Math.min.apply(null, fin(ph).concat([0]));
        pmax = Math.ceil(pmax / 45) * 45; pmin = Math.floor(pmin / 45) * 45;
        if (pmax - pmin < 90) { pmax += 45; pmin -= 45; }
        const pstep = (pmax - pmin) > 180 ? 90 : 45;
        const Yd = (v) => top.y0 + (dmax - Math.min(Math.max(v, dmin), dmax)) / (dmax - dmin) * (top.y1 - top.y0);
        const Yp = (v) => bot.y0 + (pmax - Math.min(Math.max(v, pmin), pmax)) / (pmax - pmin) * (bot.y1 - bot.y0);
        let s = '';
        // vertical decade grid (both panels) + labels
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
            s += '<text class="mt" x="' + (+x + (right ? 4 : -4)) + '" y="' + (k === 'low' ? top.y1 - 6 : top.y0 + 30) + '" text-anchor="' + (right ? 'start' : 'end') + '">' +
                lbl + '<tspan dy="-3"> ' + formatSI(v, 'Hz', 3) + '</tspan></text>';
        }
        bplot.innerHTML = s;
    }

    // ---------- SPICE parameter dialog ----------
    // Edits KEY=value tokens of the model text on apply; the text stays the source of truth.
    const PFIELDS = [
        ['IS', '1e-16'], ['BF', '100'], ['NF', '1'], ['ISE', '0'],
        ['NE', '1.5'], ['BR', '1'], ['NR', '1'], ['ISC', '0'],
        ['NC', '2'], ['VAF', '∞'], ['VAR', '∞'], ['IKF', '∞'],
        ['IKR', '∞'], ['RB', '0'], ['RE', '0'], ['RC', '0'],
    ];
    const POSITIVE = { IS: 1, BF: 1, NF: 1 };
    const dlg = $('pdlg'), pgrid = $('pgrid');
    let pq = 'q1';
    pgrid.innerHTML = PFIELDS.map(([k, d]) =>
        '<label for="p-' + k + '">' + k + '</label><input id="p-' + k + '" placeholder="' + d + '" spellcheck="false">').join('');

    function fillDialog(text) {
        for (const [k] of PFIELDS) { const v = getSpiceToken(text, k); $('p-' + k).value = v === null ? '' : v; }
        validateDialog();
    }

    function validateDialog() {
        const bad = [];
        for (const [k] of PFIELDS) {
            const el = $('p-' + k), s = el.value.trim();
            let ok = true;
            if (s !== '') {
                const v = parseSpiceNumber(s);
                ok = !isNaN(v) && v >= 0 && (!POSITIVE[k] || v > 0);
            }
            el.classList.toggle('bad', !ok);
            if (!ok) bad.push(k);
        }
        $('papply').disabled = bad.length > 0;
        $('perr').textContent = bad.length ? '入力値が不正: ' + bad.join(', ') : '';
        return bad.length === 0;
    }

    function openDialog(q) {
        pq = q;
        const other = q === 'q1' ? 'q2' : 'q1';
        $('ptitle').innerHTML = 'Q<sub>' + q.charAt(1) + '</sub>';
        $('pcopy').textContent = 'copy ' + other.toUpperCase();
        fillDialog($(q + '-model').value);
        dlg.showModal();
        $('p-IS').focus();
    }

    function applyDialog() {
        if (!validateDialog()) return;
        const ta = $(pq + '-model');
        let t = ta.value;
        for (const [k] of PFIELDS) t = setSpiceToken(t, k, $('p-' + k).value);
        ta.value = t;
        dlg.close('apply');
        clearTimeout(timer);
        compute();
    }

    pgrid.addEventListener('input', validateDialog);
    $('pform').addEventListener('submit', (e) => { e.preventDefault(); applyDialog(); });
    $('pcancel').addEventListener('click', () => dlg.close('cancel'));
    $('pcopy').addEventListener('click', () => fillDialog($((pq === 'q1' ? 'q2' : 'q1') + '-model').value));
    dlg.addEventListener('close', () => $(pq + '-param').focus());
    $('q1-param').addEventListener('click', () => openDialog('q1'));
    $('q2-param').addEventListener('click', () => openDialog('q2'));
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
        if (document.getElementById('pdlg').open) return;
        if (e.altKey && !e.ctrlKey && !e.metaKey && (e.code === 'KeyG' || e.key === 'g' || e.key === 'G')) {
            e.preventDefault();
            toggleGainUnit();
            return;
        }
        if (e.altKey && !e.ctrlKey && !e.metaKey && (e.code === 'KeyB' || e.key === 'b' || e.key === 'B')) {
            e.preventDefault();
            if ($('bdlg').open) $('bdlg').close(); else openBode();
            return;
        }
        if ($('bdlg').open) return;
        if ((e.ctrlKey || e.metaKey) && !e.altKey && (e.key === 's' || e.key === 'S')) { e.preventDefault(); exportCsv(); return; }
        if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); transfer(); return; }
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

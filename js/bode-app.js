// --- bode.html: pop-out Bode window, fed by the calculator over BroadcastChannel('ffop') ---
(function () {
    'use strict';

    const $ = (id) => document.getElementById(id);
    const el = { svg: $('bplot'), sum: $('bsum'), msg: $('bmsg') };
    const RANGE_KEY = 'ffop.bode.range';
    let state = null;   // { inp, gainUnit, range }
    let timer = null;

    function redraw() {
        if (!state) { el.msg.textContent = '計算機ページからの入力待ち'; return; }
        const rg = FFBode.range($('fstart'), $('fstop'));
        if (!rg) { el.msg.textContent = '入力値が不正: f'; return; }
        FFBode.draw(el, state.inp, rg, state.gainUnit);
    }

    function schedule(ms) { clearTimeout(timer); timer = setTimeout(redraw, ms === undefined ? 120 : ms); }

    // f range is local to this window (persisted separately)
    try {
        const r = JSON.parse(localStorage.getItem(RANGE_KEY) || 'null');
        if (r) { $('fstart').value = r.a; $('fstop').value = r.b; }
    } catch (e) { /* ignore */ }
    document.addEventListener('input', () => {
        try { localStorage.setItem(RANGE_KEY, JSON.stringify({ a: $('fstart').value, b: $('fstop').value })); } catch (e) { /* ignore */ }
        schedule();
    });

    // last state written by the calculator (used until the first message arrives)
    try {
        const s = localStorage.getItem(FFBode.STATE_KEY);
        if (s) state = FFBode.fromJSON(s);
    } catch (e) { state = null; }

    if (typeof BroadcastChannel === 'function') {
        const ch = new BroadcastChannel(FFBode.CHANNEL);
        ch.onmessage = (e) => {
            const d = e.data;
            if (d && d.type === 'state' && d.inp) { state = d; schedule(0); }
        };
        ch.postMessage({ type: 'hello' });   // ask the calculator for the current state
        window.addEventListener('beforeunload', () => ch.close());
    }
    window.addEventListener('resize', () => schedule());
    redraw();
})();

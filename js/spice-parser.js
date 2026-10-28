// --- SPICE Model Parser ---
//
// Accepts a full ".MODEL name NPN(...)" line (continuation lines allowed)
// or bare "IS=... BF=..." text. Parameter names are matched as whole words,
// so IS= does not match ISE=/ISC= and RB= does not match IRB=.
// Values use SPICE notation (m = milli, meg = mega).

const SPICE_DEFAULTS = {
    Is: 1e-16,
    Bf: 100,
    Nf: 1.0,
    Ise: 0,
    Ne: 1.5,
    Rb: 0,
    Re: 0,
    Br: 1,
    Nr: 1,
    Isc: 0,
    Nc: 2,
    Vaf: 0,  // 0 = infinite (SPICE convention)
    Var: 0,
    Ikf: 0,
    Ikr: 0,
    Rc: 0,
    // Capacitances (used only by the AC sweep)
    Cje: 0,
    Vje: 0.75,
    Mje: 0.33,
    Cjc: 0,
    Vjc: 0.75,
    Mjc: 0.33,
    Fc: 0.5,
    Tf: 0,
    Tr: 0,
};

const SPICE_KEYS = { Is: 'IS', Bf: 'BF', Nf: 'NF', Ise: 'ISE', Ne: 'NE', Rb: 'RB', Re: 'RE',
    Br: 'BR', Nr: 'NR', Isc: 'ISC', Nc: 'NC', Vaf: 'VAF', Var: 'VAR', Ikf: 'IKF', Ikr: 'IKR', Rc: 'RC',
    Cje: 'CJE', Vje: 'VJE', Mje: 'MJE', Cjc: 'CJC', Vjc: 'VJC', Mjc: 'MJC', Fc: 'FC', Tf: 'TF', Tr: 'TR' };

// Returns params with defaults; params.found lists keys read from the text,
// params.bad lists keys whose value could not be parsed.
// params.type is 'NPN', 'PNP' or null (taken from ".MODEL name NPN(" / "PNP(";
// enumerable so that Object.assign copies keep it).
function parseSpiceModel(modelStr) {
    const params = Object.assign({}, SPICE_DEFAULTS);
    const found = [], bad = [];
    // Join SPICE continuation lines (newline + '+') so a value split across lines still parses.
    const text = modelStr ? String(modelStr).replace(/\r?\n\s*\+/g, ' ') : '';

    for (const [key, name] of Object.entries(SPICE_KEYS)) {
        const re = new RegExp('(?:^|[^A-Za-z0-9_])' + name + '\\s*=\\s*([^\\s,()]+)', 'i');
        const m = text.match(re);
        if (!m) continue;
        const v = parseSpiceNumber(m[1]);
        if (isNaN(v)) {
            bad.push(key);
        } else {
            params[key] = v;
            found.push(key);
        }
    }

    const tm = text.match(/\.model\s+\S+\s+(npn|pnp)\b/i) || text.match(/(?:^|\s)(npn|pnp)\s*\(/i);
    params.type = tm ? tm[1].toUpperCase() : null;

    Object.defineProperty(params, 'found', { value: found, enumerable: false });
    Object.defineProperty(params, 'bad', { value: bad, enumerable: false });
    return params;
}

// --- Token editing (used by the parameter dialog) ---
// The model text stays the single source of truth; these edit one KEY=value
// token in place and leave every other token (CJE, TF, ...) untouched.

function spiceTokenRe(name) {
    return new RegExp('(^|[^A-Za-z0-9_])(' + name + ')(\\s*=\\s*)([^\\s,()]+)', 'i');
}

// Raw value string of NAME, or null when absent
function getSpiceToken(text, name) {
    const m = String(text || '').match(spiceTokenRe(name));
    return m ? m[4] : null;
}

// Set NAME=value (value null/'' removes the token). Returns the new text.
function setSpiceToken(text, name, value) {
    text = String(text || '');
    const re = spiceTokenRe(name);
    const m = text.match(re);
    const has = value !== null && value !== undefined && String(value).trim() !== '';
    if (m) {
        const start = m.index + m[1].length, end = m.index + m[0].length;
        if (has) return text.slice(0, start) + m[2] + m[3] + String(value).trim() + text.slice(end);
        // remove the token and one adjoining space
        let a = start, b = end;
        if (text[b] === ' ') b++; else if (a > 0 && text[a - 1] === ' ') a--;
        return text.slice(0, a) + text.slice(b);
    }
    if (!has) return text;
    const tok = name + '=' + String(value).trim();
    const close = text.lastIndexOf(')');
    if (close >= 0) {
        const before = text.slice(0, close);
        return before + (/[\s(]$/.test(before) ? '' : ' ') + tok + text.slice(close);
    }
    return text.trim() === '' ? tok : text.replace(/\s*$/, '') + ' ' + tok;
}

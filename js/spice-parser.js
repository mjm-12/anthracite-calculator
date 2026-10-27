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
};

const SPICE_KEYS = { Is: 'IS', Bf: 'BF', Nf: 'NF', Ise: 'ISE', Ne: 'NE', Rb: 'RB', Re: 'RE',
    Br: 'BR', Nr: 'NR', Isc: 'ISC', Nc: 'NC', Vaf: 'VAF', Var: 'VAR', Ikf: 'IKF', Ikr: 'IKR', Rc: 'RC' };

// Returns params with defaults; params.found lists keys read from the text,
// params.bad lists keys whose value could not be parsed.
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

    Object.defineProperty(params, 'found', { value: found, enumerable: false });
    Object.defineProperty(params, 'bad', { value: bad, enumerable: false });
    return params;
}

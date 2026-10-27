// --- Engineering Notation Parser ---
//
// Accepted forms (whitespace ignored):
//   "100k", "4.7k", "4k7", "2M2", "4R7", "1meg", "25.85m", "500u", "500µ"
//   "1e-3", "1.5E3", trailing units "Ω" / "ohm" / "ohms" / "V" / "A"
//   "inf" / "∞" / "Infinity"  -> Infinity
// Convenience rule: uppercase 'M' = mega, lowercase 'm' = milli.
// Returns NaN for empty or unparseable input.

const SI_MULT = {
    f: 1e-15, F: 1e-15,
    p: 1e-12, P: 1e-12,
    n: 1e-9, N: 1e-9,
    u: 1e-6, U: 1e-6, 'µ': 1e-6, 'μ': 1e-6,
    m: 1e-3,
    k: 1e3, K: 1e3,
    M: 1e6, meg: 1e6,
    g: 1e9, G: 1e9,
    t: 1e12, T: 1e12,
    R: 1, r: 1,
};

const INF_RE = /^(?:\+?inf(?:inity)?|∞|open)$/i;

function parseEngineering(str) {
    if (typeof str === 'number') return str;
    if (str === undefined || str === null) return NaN;
    let s = String(str).replace(/\s+/g, '');
    if (s === '') return NaN;
    if (INF_RE.test(s)) return Infinity;

    // Strip one trailing unit
    s = s.replace(/(?:ohms?|Ω|Ω|V|A)$/i, '');
    if (s === '') return NaN;
    if (INF_RE.test(s)) return Infinity;

    // "4k7" style: digits, multiplier as decimal point, digits
    let m = s.match(/^([+-]?\d+)(meg|[fpnuµμmkKMgGtTRr])(\d+)$/i);
    if (m) {
        const suf = m[2].toLowerCase() === 'meg' ? 'meg' : m[2];
        if (!(suf in SI_MULT)) return NaN;
        return parseFloat(m[1] + '.' + m[3]) * SI_MULT[suf];
    }

    m = s.match(/^([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)(meg|[fFpPnNuUµμmkKMgGtTRr])?$/i);
    if (!m) return NaN;
    const num = parseFloat(m[1]);
    if (!m[2]) return num;
    const suf = m[2].toLowerCase() === 'meg' ? 'meg' : m[2];
    if (!(suf in SI_MULT)) return NaN;
    return num * SI_MULT[suf];
}

// Optional value (e.g. R_BC): empty / inf / ∞ -> Infinity (component absent).
function parseOptional(str) {
    if (str === undefined || str === null || String(str).trim() === '') return Infinity;
    return parseEngineering(str);
}

// SPICE-convention number: case-insensitive, m/M = milli, meg = mega,
// trailing letters after the multiplier are ignored ("1.5pF").
function parseSpiceNumber(str) {
    const m = String(str).trim().match(/^([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)(meg|mil|[fpnumkgt])?[a-z]*$/i);
    if (!m) return NaN;
    const num = parseFloat(m[1]);
    if (!m[2]) return num;
    const mult = {
        f: 1e-15, p: 1e-12, n: 1e-9, u: 1e-6, m: 1e-3,
        k: 1e3, meg: 1e6, g: 1e9, t: 1e12, mil: 25.4e-6,
    };
    return num * mult[m[2].toLowerCase()];
}

// --- E24 Resistor Series ---

const E24 = [
    1.0, 1.1, 1.2, 1.3, 1.5, 1.6, 1.8, 2.0,
    2.2, 2.4, 2.7, 3.0, 3.3, 3.6, 3.9, 4.3,
    4.7, 5.1, 5.6, 6.2, 6.8, 7.5, 8.2, 9.1
];

// Nearest E24 value (closest in log scale, wraps to the next decade)
function nearestE24(val) {
    if (!(val > 0) || !isFinite(val)) return NaN;
    const exp = Math.floor(Math.log10(val));
    const mant = val / Math.pow(10, exp);
    let best = E24[0], bestD = Infinity;
    for (const e of E24.concat([10])) {
        const d = Math.abs(Math.log(mant / e));
        if (d < bestD) { bestD = d; best = e; }
    }
    return parseFloat((best * Math.pow(10, exp)).toPrecision(3));
}

// --- Formatting ---

const SI_PREFIX = [
    [1e12, 'T'], [1e9, 'G'], [1e6, 'M'], [1e3, 'k'], [1, ''],
    [1e-3, 'm'], [1e-6, 'µ'], [1e-9, 'n'], [1e-12, 'p'], [1e-15, 'f'],
];

// formatSI(33210, 'Ω') -> "33.21 kΩ"
function formatSI(val, unit, sig) {
    unit = unit || '';
    sig = sig || 4;
    if (val === Infinity) return '∞';
    if (typeof val !== 'number' || isNaN(val)) return '–';
    if (val === 0) return '0 ' + unit;
    const a = Math.abs(val);
    if (a >= 999.95e12) return val.toExponential(2) + ' ' + unit;
    for (const [mult, pre] of SI_PREFIX) {
        if (a >= mult * 0.9995) {
            return trimNum((val / mult).toPrecision(sig)) + ' ' + pre + unit;
        }
    }
    return val.toExponential(sig - 1) + ' ' + unit;
}

function trimNum(s) {
    // keep toPrecision output but avoid exponent form like "1.000e+3"
    if (/e/.test(s)) return String(parseFloat(s));
    return s;
}

function formatResistor(val) {
    return formatSI(val, 'Ω', 3);
}

function formatCurrent(val) {
    return formatSI(val, 'A', 4);
}

// --- CSV (RFC 4180) ---

function csvField(v) {
    const s = v === undefined || v === null ? '' : String(v);
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

// rows: array of arrays -> CSV text with CRLF line ends
function toCsv(rows) {
    return rows.map((r) => r.map(csvField).join(',')).join('\r\n') + '\r\n';
}

// CSV text -> array of arrays. Tolerates BOM, CRLF/LF/CR, quoted fields with
// embedded commas, doubled quotes and newlines.
function parseCsv(text) {
    const rows = [];
    let row = [], f = '', i = 0, q = false;
    if (text.charCodeAt(0) === 0xFEFF) i = 1;
    for (; i < text.length; i++) {
        const c = text[i];
        if (q) {
            if (c === '"') {
                if (text[i + 1] === '"') { f += '"'; i++; } else q = false;
            } else f += c;
        } else if (c === '"') q = true;
        else if (c === ',') { row.push(f); f = ''; }
        else if (c === '\r' || c === '\n') {
            if (c === '\r' && text[i + 1] === '\n') i++;
            row.push(f); rows.push(row); row = []; f = '';
        } else f += c;
    }
    if (f !== '' || row.length) { row.push(f); rows.push(row); }
    return rows;
}

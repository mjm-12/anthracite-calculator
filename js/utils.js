// --- Engineering Notation Parser ---

function parseEngineering(str) {
    if (!str) return 0;
    if (str === "Infinity") return Infinity;
    str = str.toString().trim();

    // SPICE engineering notation suffixes
    // Check for 'meg' first (case-insensitive) for Mega
    const megMatch = str.match(/^([0-9.\-+eE]+)\s*(meg|MEG|Meg)$/i);
    if (megMatch) {
        return parseFloat(megMatch[1]) * 1e6;
    }

    // Check for single character suffix
    const suffixMatch = str.match(/^([0-9.\-+eE]+)\s*([a-zA-Z])$/);
    if (suffixMatch) {
        const num = parseFloat(suffixMatch[1]);
        const suffix = suffixMatch[2];

        // SPICE standard multipliers
        // Note: In SPICE, 'm' is milli, 'M' is also milli (use 'meg' for mega)
        // But for user convenience, we treat uppercase 'M' as Mega
        const multipliers = {
            'f': 1e-15, 'F': 1e-15,  // femto
            'p': 1e-12, 'P': 1e-12,  // pico
            'n': 1e-9,  'N': 1e-9,   // nano
            'u': 1e-6,  'U': 1e-6,   // micro
            'm': 1e-3,               // milli (lowercase only for SPICE compat)
            'M': 1e6,   'Meg': 1e6,  // Mega (uppercase for user convenience)
            'k': 1e3,   'K': 1e3,    // kilo
            'g': 1e9,   'G': 1e9,    // giga
            't': 1e12,  'T': 1e12    // tera
        };

        if (multipliers.hasOwnProperty(suffix)) {
            return num * multipliers[suffix];
        }
    }

    // No suffix or unrecognized - parse as plain number
    return parseFloat(str);
}

// --- E24 Resistor Series ---

const E24 = [
    1.0, 1.1, 1.2, 1.3, 1.5, 1.6, 1.8, 2.0,
    2.2, 2.4, 2.7, 3.0, 3.3, 3.6, 3.9, 4.3,
    4.7, 5.1, 5.6, 6.2, 6.8, 7.5, 8.2, 9.1
];

function findClosestE24(val) {
    if (val <= 0 || !isFinite(val)) return "-";
    const exponent = Math.floor(Math.log10(val));
    const mantissa = val / Math.pow(10, exponent);

    let closest = E24[0];
    let minDiff = Math.abs(mantissa - E24[0]);

    for (let e of E24) {
        let diff = Math.abs(mantissa - e);
        if (diff < minDiff) {
            minDiff = diff;
            closest = e;
        }
    }
    const res = closest * Math.pow(10, exponent);
    return formatResistor(res);
}

// --- Formatting ---

function formatResistor(val) {
    if (val >= 1e6) return (val / 1e6).toPrecision(3) + " MΩ";
    if (val >= 1e3) return (val / 1e3).toPrecision(3) + " kΩ";
    return val.toPrecision(3) + " Ω";
}

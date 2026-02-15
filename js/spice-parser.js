// --- SPICE Model Parser ---

function parseSpiceModel(modelStr) {
    const params = {
        Is: 1e-16,
        Bf: 100,
        Ise: 0,
        Ne: 1.5,
        Nf: 1.0,
        Rb: 0,
        Re: 0,
    };

    if (!modelStr) return params;

    // Pattern supports: scientific notation (1E-15), SPICE suffixes (7.049f, 59.74p)
    // Suffixes: f=femto, p=pico, n=nano, u=micro, m=milli, k=kilo, meg=mega, g=giga, t=tera
    const patterns = {
        Is:  /Is\s*=\s*([0-9\.\+\-eE]+(?:meg|[fpnumkgt])?)/i,
        Bf:  /Bf\s*=\s*([0-9\.\+\-eE]+(?:meg|[fpnumkgt])?)/i,
        Ise: /Ise\s*=\s*([0-9\.\+\-eE]+(?:meg|[fpnumkgt])?)/i,
        Ne:  /Ne\s*=\s*([0-9\.\+\-eE]+(?:meg|[fpnumkgt])?)/i,
        Nf:  /Nf\s*=\s*([0-9\.\+\-eE]+(?:meg|[fpnumkgt])?)/i,
        Rb:  /Rb\s*=\s*([0-9\.\+\-eE]+(?:meg|[fpnumkgt])?)/i,
        Re:  /Re\s*=\s*([0-9\.\+\-eE]+(?:meg|[fpnumkgt])?)/i,
    };

    for (const [key, regex] of Object.entries(patterns)) {
        const match = modelStr.match(regex);
        if (match && match[1]) {
            params[key] = parseEngineering(match[1]);
        }
    }
    return params;
}

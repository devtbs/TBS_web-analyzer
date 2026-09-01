/* Target markets for keyword volume / SERP lookups.
 *
 * ONE list, imported everywhere. There used to be six separate copies — Quick Analysis, Page
 * Selector, Research Wizard, Keyword Discovery, Keyword Clustering and Rank Tracker each had their
 * own — which had already drifted to 8, 8, 13, 9, 9 and 8 entries. That is how a Swiss hotel came to
 * be researched with no Switzerland option at all.
 *
 * `locId` values are Mangools location ids: 2000 + the ISO-3166 numeric country code (de 276 ->
 * 2276). They must stay in step with _TLD_LOCATION in backend/services/mangools_service.py, which
 * maps a domain's TLD to the same ids for the automatic default.
 *
 * Thailand stays first because callers use MARKETS[0] as the default.
 */
export const MARKETS = [
    { label: 'Thailand', gl: 'th', locId: 2764 },

    { label: 'Argentina', gl: 'ar', locId: 2032 },
    { label: 'Australia', gl: 'au', locId: 2036 },
    { label: 'Austria', gl: 'at', locId: 2040 },
    { label: 'Belgium', gl: 'be', locId: 2056 },
    { label: 'Brazil', gl: 'br', locId: 2076 },
    { label: 'Canada', gl: 'ca', locId: 2124 },
    { label: 'Czechia', gl: 'cz', locId: 2203 },
    { label: 'Denmark', gl: 'dk', locId: 2208 },
    { label: 'Finland', gl: 'fi', locId: 2246 },
    { label: 'France', gl: 'fr', locId: 2250 },
    { label: 'Germany', gl: 'de', locId: 2276 },
    { label: 'Greece', gl: 'gr', locId: 2300 },
    { label: 'Hong Kong', gl: 'hk', locId: 2344 },
    { label: 'Hungary', gl: 'hu', locId: 2348 },
    { label: 'India', gl: 'in', locId: 2356 },
    { label: 'Indonesia', gl: 'id', locId: 2360 },
    { label: 'Ireland', gl: 'ie', locId: 2372 },
    { label: 'Italy', gl: 'it', locId: 2380 },
    { label: 'Japan', gl: 'jp', locId: 2392 },
    { label: 'Malaysia', gl: 'my', locId: 2458 },
    { label: 'Mexico', gl: 'mx', locId: 2484 },
    { label: 'Netherlands', gl: 'nl', locId: 2528 },
    { label: 'New Zealand', gl: 'nz', locId: 2554 },
    { label: 'Norway', gl: 'no', locId: 2578 },
    { label: 'Philippines', gl: 'ph', locId: 2608 },
    { label: 'Poland', gl: 'pl', locId: 2616 },
    { label: 'Portugal', gl: 'pt', locId: 2620 },
    { label: 'Romania', gl: 'ro', locId: 2642 },
    { label: 'Saudi Arabia', gl: 'sa', locId: 2682 },
    { label: 'Singapore', gl: 'sg', locId: 2702 },
    { label: 'South Africa', gl: 'za', locId: 2710 },
    { label: 'South Korea', gl: 'kr', locId: 2410 },
    { label: 'Spain', gl: 'es', locId: 2724 },
    { label: 'Sweden', gl: 'se', locId: 2752 },
    { label: 'Switzerland', gl: 'ch', locId: 2756 },
    { label: 'Taiwan', gl: 'tw', locId: 2158 },
    { label: 'United Arab Emirates', gl: 'ae', locId: 2784 },
    { label: 'United Kingdom', gl: 'uk', locId: 2826 },
    { label: 'United States', gl: 'us', locId: 2840 },
    { label: 'Vietnam', gl: 'vn', locId: 2704 },
];

/* Multi-part TLDs have to be checked before the bare suffix, or ".co.uk" resolves as "uk" only by
 * luck and ".com.au" resolves as "au"'s neighbour "com". */
const COMPOUND_TLDS = {
    'co.uk': 'uk', 'com.au': 'au', 'co.nz': 'nz', 'co.za': 'za', 'com.br': 'br',
    'com.mx': 'mx', 'com.ar': 'ar', 'co.id': 'id',
};

/** Best-guess market for a domain, from its TLD. Returns a `gl` code; falls back to Thailand. */
export const guessMarket = (domain) => {
    const d = (domain || '').toLowerCase().replace(/\/+$/, '');
    for (const [suffix, gl] of Object.entries(COMPOUND_TLDS)) {
        if (d.endsWith(`.${suffix}`)) return gl;
    }
    const tld = d.split('.').pop();
    return (MARKETS.find(m => m.gl === tld) || {}).gl || 'th';
};

/** The full market object for a `gl` code, defaulting to the first entry. */
export const marketFor = (gl) => MARKETS.find(m => m.gl === gl) || MARKETS[0];

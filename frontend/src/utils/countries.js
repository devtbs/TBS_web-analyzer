/*
 * ISO-3166-1 alpha-3 -> { name, alpha2 } lookup.
 *
 * Google Search Console returns country as a lowercase alpha-3 code ("usa", "gbr", "tha").
 * This maps it to a display name and a flag emoji. The flag is derived from the alpha-2 code
 * via Unicode regional-indicator symbols, so we only need to store the alpha-2 here.
 */
const ISO3 = {
    afg: ['Afghanistan', 'AF'], alb: ['Albania', 'AL'], dza: ['Algeria', 'DZ'], and: ['Andorra', 'AD'],
    ago: ['Angola', 'AO'], arg: ['Argentina', 'AR'], arm: ['Armenia', 'AM'], aus: ['Australia', 'AU'],
    aut: ['Austria', 'AT'], aze: ['Azerbaijan', 'AZ'], bhr: ['Bahrain', 'BH'], bgd: ['Bangladesh', 'BD'],
    blr: ['Belarus', 'BY'], bel: ['Belgium', 'BE'], blz: ['Belize', 'BZ'], ben: ['Benin', 'BJ'],
    btn: ['Bhutan', 'BT'], bol: ['Bolivia', 'BO'], bih: ['Bosnia & Herzegovina', 'BA'], bwa: ['Botswana', 'BW'],
    bra: ['Brazil', 'BR'], brn: ['Brunei', 'BN'], bgr: ['Bulgaria', 'BG'], bfa: ['Burkina Faso', 'BF'],
    khm: ['Cambodia', 'KH'], cmr: ['Cameroon', 'CM'], can: ['Canada', 'CA'], chl: ['Chile', 'CL'],
    chn: ['China', 'CN'], col: ['Colombia', 'CO'], cri: ['Costa Rica', 'CR'], hrv: ['Croatia', 'HR'],
    cyp: ['Cyprus', 'CY'], cze: ['Czechia', 'CZ'], dnk: ['Denmark', 'DK'], dom: ['Dominican Republic', 'DO'],
    ecu: ['Ecuador', 'EC'], egy: ['Egypt', 'EG'], slv: ['El Salvador', 'SV'], est: ['Estonia', 'EE'],
    eth: ['Ethiopia', 'ET'], fin: ['Finland', 'FI'], fra: ['France', 'FR'], geo: ['Georgia', 'GE'],
    deu: ['Germany', 'DE'], gha: ['Ghana', 'GH'], grc: ['Greece', 'GR'], gtm: ['Guatemala', 'GT'],
    hnd: ['Honduras', 'HN'], hkg: ['Hong Kong', 'HK'], hun: ['Hungary', 'HU'], isl: ['Iceland', 'IS'],
    ind: ['India', 'IN'], idn: ['Indonesia', 'ID'], irn: ['Iran', 'IR'], irq: ['Iraq', 'IQ'],
    irl: ['Ireland', 'IE'], isr: ['Israel', 'IL'], ita: ['Italy', 'IT'], jam: ['Jamaica', 'JM'],
    jpn: ['Japan', 'JP'], jor: ['Jordan', 'JO'], kaz: ['Kazakhstan', 'KZ'], ken: ['Kenya', 'KE'],
    kor: ['South Korea', 'KR'], kwt: ['Kuwait', 'KW'], kgz: ['Kyrgyzstan', 'KG'], lao: ['Laos', 'LA'],
    lva: ['Latvia', 'LV'], lbn: ['Lebanon', 'LB'], lby: ['Libya', 'LY'], ltu: ['Lithuania', 'LT'],
    lux: ['Luxembourg', 'LU'], mac: ['Macau', 'MO'], mkd: ['North Macedonia', 'MK'], mdg: ['Madagascar', 'MG'],
    mys: ['Malaysia', 'MY'], mdv: ['Maldives', 'MV'], mlt: ['Malta', 'MT'], mex: ['Mexico', 'MX'],
    mda: ['Moldova', 'MD'], mng: ['Mongolia', 'MN'], mne: ['Montenegro', 'ME'], mar: ['Morocco', 'MA'],
    mmr: ['Myanmar', 'MM'], npl: ['Nepal', 'NP'], nld: ['Netherlands', 'NL'], nzl: ['New Zealand', 'NZ'],
    nic: ['Nicaragua', 'NI'], nga: ['Nigeria', 'NG'], nor: ['Norway', 'NO'], omn: ['Oman', 'OM'],
    pak: ['Pakistan', 'PK'], pan: ['Panama', 'PA'], pry: ['Paraguay', 'PY'], per: ['Peru', 'PE'],
    phl: ['Philippines', 'PH'], pol: ['Poland', 'PL'], prt: ['Portugal', 'PT'], qat: ['Qatar', 'QA'],
    rou: ['Romania', 'RO'], rus: ['Russia', 'RU'], rwa: ['Rwanda', 'RW'], sau: ['Saudi Arabia', 'SA'],
    srb: ['Serbia', 'RS'], sgp: ['Singapore', 'SG'], svk: ['Slovakia', 'SK'], svn: ['Slovenia', 'SI'],
    zaf: ['South Africa', 'ZA'], esp: ['Spain', 'ES'], lka: ['Sri Lanka', 'LK'], swe: ['Sweden', 'SE'],
    che: ['Switzerland', 'CH'], syr: ['Syria', 'SY'], twn: ['Taiwan', 'TW'], tjk: ['Tajikistan', 'TJ'],
    tza: ['Tanzania', 'TZ'], tha: ['Thailand', 'TH'], tun: ['Tunisia', 'TN'], tur: ['Turkey', 'TR'],
    uga: ['Uganda', 'UG'], ukr: ['Ukraine', 'UA'], are: ['United Arab Emirates', 'AE'],
    gbr: ['United Kingdom', 'GB'], usa: ['United States', 'US'], ury: ['Uruguay', 'UY'],
    uzb: ['Uzbekistan', 'UZ'], ven: ['Venezuela', 'VE'], vnm: ['Vietnam', 'VN'], yem: ['Yemen', 'YE'],
    zmb: ['Zambia', 'ZM'], zwe: ['Zimbabwe', 'ZW'],
};

// Alpha-2 -> flag emoji via regional indicator symbols (🇦=U+1F1E6).
const flagOf = (alpha2) => {
    if (!alpha2 || alpha2.length !== 2) return '🏳️';
    return String.fromCodePoint(...[...alpha2.toUpperCase()].map(c => 0x1f1e6 + c.charCodeAt(0) - 65));
};

/** Display name for a GSC alpha-3 country code; falls back to the upper-cased code. */
export const countryName = (code) => {
    const e = ISO3[(code || '').toLowerCase()];
    return e ? e[0] : (code || '').toUpperCase();
};

/** Flag emoji for a GSC alpha-3 country code (🏳️ when unknown). */
export const countryFlag = (code) => {
    const e = ISO3[(code || '').toLowerCase()];
    return e ? flagOf(e[1]) : '🏳️';
};

/** "🇬🇧 United Kingdom" — flag + name for a GSC alpha-3 code. */
export const countryLabel = (code) => `${countryFlag(code)} ${countryName(code)}`;

import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
    ArrowLeftIcon,
    FunnelIcon,
    ArrowDownTrayIcon,
    ClockIcon,
    ChevronDownIcon,
    ArrowUpIcon,
    ArrowDownIcon,
    MinusIcon,
} from '@heroicons/react/24/outline';
import { ChartBarIcon } from '@heroicons/react/24/outline';
import api from '../api/axios';
import toast from 'react-hot-toast';
import Favicon from '../components/ui/Favicon';

/* ── Country code → Full name map ────────────────────── */
const COUNTRY_NAMES = {
    usa: 'United States', gbr: 'United Kingdom', can: 'Canada', aus: 'Australia',
    fra: 'France', deu: 'Germany', ind: 'India', phl: 'Philippines',
    mys: 'Malaysia', sgp: 'Singapore', nld: 'Netherlands', esp: 'Spain',
    ita: 'Italy', bra: 'Brazil', jpn: 'Japan', kor: 'South Korea',
    nzl: 'New Zealand', irl: 'Ireland', zaf: 'South Africa', nga: 'Nigeria',
    pak: 'Pakistan', bgd: 'Bangladesh', lka: 'Sri Lanka', ken: 'Kenya',
    gha: 'Ghana', uga: 'Uganda', zmb: 'Zambia', mwi: 'Malawi',
    rwa: 'Rwanda', tza: 'Tanzania', eth: 'Ethiopia', egy: 'Egypt',
    mar: 'Morocco', tun: 'Tunisia', ago: 'Angola', cmr: 'Cameroon',
    civ: "Côte d'Ivoire", sen: 'Senegal', moz: 'Mozambique', mdg: 'Madagascar',
    pol: 'Poland', swe: 'Sweden', nor: 'Norway', dnk: 'Denmark',
    fin: 'Finland', che: 'Switzerland', aut: 'Austria', bel: 'Belgium',
    prt: 'Portugal', grc: 'Greece', cze: 'Czech Republic', hun: 'Hungary',
    rou: 'Romania', svk: 'Slovakia', svn: 'Slovenia', hrv: 'Croatia',
    bgr: 'Bulgaria', srb: 'Serbia', ukr: 'Ukraine', rus: 'Russia',
    mex: 'Mexico', arg: 'Argentina', col: 'Colombia', chl: 'Chile',
    per: 'Peru', ven: 'Venezuela', ecu: 'Ecuador', bol: 'Bolivia',
    pry: 'Paraguay', ury: 'Uruguay', gtm: 'Guatemala', cri: 'Costa Rica',
    pan: 'Panama', dom: 'Dominican Republic', cub: 'Cuba', jam: 'Jamaica',
    tto: 'Trinidad and Tobago', hti: 'Haiti', blz: 'Belize', nic: 'Nicaragua',
    hnd: 'Honduras', slv: 'El Salvador', mys2: 'Malaysia', idn: 'Indonesia',
    tha: 'Thailand', vnm: 'Vietnam', mmr: 'Myanmar', khm: 'Cambodia',
    lao: 'Laos', brn: 'Brunei', tls: 'Timor-Leste', png: 'Papua New Guinea',
    fji: 'Fiji', wsm: 'Samoa', ton: 'Tonga', slb: 'Solomon Islands',
    vut: 'Vanuatu', kir: 'Kiribati', mhl: 'Marshall Islands', plw: 'Palau',
    fsm: 'Micronesia', nru: 'Nauru', tuv: 'Tuvalu', chn: 'China',
    twn: 'Taiwan', hkg: 'Hong Kong', mac: 'Macao', mng: 'Mongolia',
    prk: 'North Korea', kaz: 'Kazakhstan', uzb: 'Uzbekistan', tkm: 'Turkmenistan',
    kgz: 'Kyrgyzstan', tjk: 'Tajikistan', afg: 'Afghanistan', irn: 'Iran',
    irq: 'Iraq', syr: 'Syria', lbn: 'Lebanon', jor: 'Jordan',
    isr: 'Israel', pse: 'Palestine', sau: 'Saudi Arabia', are: 'United Arab Emirates',
    kwt: 'Kuwait', bhr: 'Bahrain', qat: 'Qatar', omn: 'Oman',
    yem: 'Yemen', tur: 'Turkey', arm: 'Armenia', aze: 'Azerbaijan',
    geo: 'Georgia', alb: 'Albania', mne: 'Montenegro', mkd: 'North Macedonia',
    bih: 'Bosnia and Herzegovina', xkx: 'Kosovo', mlt: 'Malta', cyp: 'Cyprus',
    lux: 'Luxembourg', lie: 'Liechtenstein', and: 'Andorra', mco: 'Monaco',
    smr: 'San Marino', vat: 'Vatican City', isl: 'Iceland', mld: 'Maldives',
    lka2: 'Sri Lanka', npl: 'Nepal', btn: 'Bhutan', mdv: 'Maldives',
    mus: 'Mauritius', syc: 'Seychelles', cpv: 'Cape Verde', stp: 'São Tomé',
    com: 'Comoros', dji: 'Djibouti', eri: 'Eritrea', som: 'Somalia',
    ssd: 'South Sudan', sdn: 'Sudan', lby: 'Libya', mrt: 'Mauritania',
    mli: 'Mali', ner: 'Niger', tcd: 'Chad', caf: 'Central African Republic',
    cod: 'DR Congo', cog: 'Republic of Congo', gab: 'Gabon', gnq: 'Equatorial Guinea',
    sle: 'Sierra Leone', lbr: 'Liberia', gin: 'Guinea', gnb: 'Guinea-Bissau',
    gmb: 'Gambia', bfa: 'Burkina Faso', tgo: 'Togo', ben: 'Benin',
    swz: 'Eswatini', lso: 'Lesotho', bwa: 'Botswana', nam: 'Namibia',
    zwe: 'Zimbabwe', grl: 'Greenland',
};

const getCountryName = (code) => {
    if (!code) return code;
    return COUNTRY_NAMES[code.toLowerCase()] || code.toUpperCase();
};

/* ── Delta badge ─────────────────────────────────────── */
const DeltaBadge = ({ value }) => {
    if (value == null) return <span className="text-slate-400 text-[11px] ml-1">~0%</span>;
    const isUp = value >= 0;
    return (
        <span className={`inline-flex items-center gap-0.5 text-[11px] font-bold ml-1 ${isUp ? 'text-emerald-600' : 'text-rose-500'}`}>
            {isUp ? <ArrowUpIcon className="w-2.5 h-2.5" /> : <ArrowDownIcon className="w-2.5 h-2.5" />}
            {Math.abs(value)}%
        </span>
    );
};

/* ── Preset helpers ──────────────────────────────────── */
const PRESETS = ['Last 7 days', 'Last 14 days', 'Last 28 days', '3 months', '6 months'];
const presetToDays = (p) => {
    switch (p) {
        case 'Last 7 days': return 7;
        case 'Last 14 days': return 14;
        case 'Last 28 days': return 28;
        case '3 months': return 90;
        case '6 months': return 180;
        default: return 28;
    }
};
const fmtDate = (d) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

/* ══════════════════════════════════════════════════════
   CountriesPage
   ══════════════════════════════════════════════════════ */
export default function CountriesPage() {
    const navigate = useNavigate();
    const selectedProperty = localStorage.getItem('gsc_selected_property') || '';

    const [countries, setCountries] = useState([]);
    const [loading, setLoading] = useState(true);
    const [tab, setTab] = useState('All');           // All | Winning | Losing
    const [preset, setPreset] = useState('Last 28 days');
    const [days, setDays] = useState(28);
    const [isPresetOpen, setIsPresetOpen] = useState(false);
    const [sortKey, setSortKey] = useState('clicks');
    const [sortDir, setSortDir] = useState('desc');

    /* ── Fetch ── */
    useEffect(() => {
        if (!selectedProperty) { setLoading(false); return; }
        setLoading(true);
        api.get(`/auth/gsc/countries/${encodeURIComponent(selectedProperty)}`, { params: { days } })
            .then(res => setCountries(res.data.countries || []))
            .catch(err => toast.error(err.response?.data?.detail || 'Failed to load countries'))
            .finally(() => setLoading(false));
    }, [selectedProperty, days]);

    /* ── Filter + sort ── */
    const displayed = useMemo(() => {
        let list = [...countries];
        if (tab === 'Winning') list = list.filter(c => (c.clicks_delta ?? 0) > 0);
        if (tab === 'Losing')  list = list.filter(c => (c.clicks_delta ?? 0) <= 0);
        list.sort((a, b) => {
            const av = a[sortKey] ?? 0;
            const bv = b[sortKey] ?? 0;
            return sortDir === 'desc' ? bv - av : av - bv;
        });
        return list;
    }, [countries, tab, sortKey, sortDir]);

    const handleSort = (key) => {
        if (sortKey === key) setSortDir(d => d === 'desc' ? 'asc' : 'desc');
        else { setSortKey(key); setSortDir('desc'); }
    };

    /* ── Date range label ── */
    const end   = new Date();
    const start = new Date(); start.setDate(start.getDate() - days);
    const prevEnd   = new Date(start); prevEnd.setDate(prevEnd.getDate() - 1);
    const prevStart = new Date(prevEnd); prevStart.setDate(prevStart.getDate() - days);

    const SortIcon = ({ col }) => {
        if (sortKey !== col) return <ChevronDownIcon className="w-3 h-3 text-slate-300 ml-1 inline-block" />;
        return sortDir === 'desc'
            ? <ArrowDownIcon className="w-3 h-3 text-emerald-500 ml-1 inline-block" />
            : <ArrowUpIcon className="w-3 h-3 text-emerald-500 ml-1 inline-block" />;
    };

    if (!selectedProperty) {
        return (
            <div className="p-8 flex flex-col items-center justify-center min-h-[60vh]">
                <ChartBarIcon className="w-12 h-12 text-slate-300 mb-4" />
                <h2 className="text-xl font-bold text-slate-700 mb-2">No Property Selected</h2>
                <p className="text-slate-500 mb-6">Please connect and select a Google Search Console property first.</p>
                <button onClick={() => navigate('/seo-analytics')} className="px-5 py-2 bg-emerald-500 text-white rounded-lg font-semibold hover:bg-emerald-600 transition-colors">
                    Go to Dashboard
                </button>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-white">
            {/* ── Top Header ── */}
            <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-slate-100">
                <div className="flex items-center gap-3">
                    <button
                        onClick={() => navigate('/seo-analytics')}
                        className="flex items-center gap-1.5 text-[13px] font-semibold text-slate-500 hover:text-slate-800 transition-colors"
                    >
                        <ArrowLeftIcon className="w-4 h-4" />
                        Back to Dashboard
                    </button>
                    <span className="text-slate-300">/</span>
                    <h1 className="text-[18px] font-black text-slate-900">
                        All Countries
                        {!loading && (
                            <span className="ml-2 text-[14px] font-semibold text-slate-400">
                                ({countries.length} total)
                            </span>
                        )}
                    </h1>
                </div>

                <div className="flex items-center gap-3">
                    {/* Filter */}
                    <button className="flex items-center gap-1.5 px-3 py-1.5 border border-slate-200 rounded-lg text-[13px] font-semibold text-slate-600 bg-white shadow-sm hover:bg-slate-50 transition-colors">
                        <FunnelIcon className="w-4 h-4 text-slate-400" />
                        Filter
                    </button>

                    {/* Date preset picker */}
                    <div className="relative">
                        <button
                            onClick={() => setIsPresetOpen(!isPresetOpen)}
                            className="flex items-center gap-1.5 px-3 py-1.5 border border-slate-200 rounded-lg text-[13px] font-semibold text-slate-600 bg-white shadow-sm hover:bg-slate-50 transition-colors"
                        >
                            <ClockIcon className="w-4 h-4 text-slate-400" />
                            {preset}
                            <ChevronDownIcon className="w-3.5 h-3.5 text-slate-400" />
                        </button>
                        <AnimatePresence>
                            {isPresetOpen && (
                                <>
                                    <div className="fixed inset-0 z-40" onClick={() => setIsPresetOpen(false)} />
                                    <motion.div
                                        initial={{ opacity: 0, y: 6, scale: 0.97 }}
                                        animate={{ opacity: 1, y: 0, scale: 1 }}
                                        exit={{ opacity: 0, y: 6, scale: 0.97 }}
                                        transition={{ duration: 0.13 }}
                                        className="absolute right-0 top-[calc(100%+6px)] w-44 bg-white rounded-xl border border-slate-100 shadow-xl z-50 py-1.5 overflow-hidden"
                                    >
                                        {PRESETS.map(p => (
                                            <button
                                                key={p}
                                                onClick={() => { setPreset(p); setDays(presetToDays(p)); setIsPresetOpen(false); }}
                                                className={`w-full text-left px-4 py-2 text-[13px] font-semibold transition-colors ${preset === p ? 'text-emerald-700 bg-emerald-50' : 'text-slate-700 hover:bg-slate-50'}`}
                                            >
                                                {p}
                                            </button>
                                        ))}
                                    </motion.div>
                                </>
                            )}
                        </AnimatePresence>
                    </div>

                </div>
            </div>

            {/* ── Sub-header: tabs + date comparison + export ── */}
            <div className="px-6 pt-4 pb-3 flex items-center justify-between border-b border-slate-100">
                <div className="flex items-center gap-1">
                    {['All', 'Winning', 'Losing'].map(t => (
                        <button
                            key={t}
                            onClick={() => setTab(t)}
                            className={`px-4 py-1.5 rounded-lg text-[13px] font-bold transition-all ${
                                tab === t
                                    ? 'bg-emerald-50 text-emerald-700 border border-emerald-200 shadow-sm'
                                    : 'text-slate-500 hover:text-slate-700 hover:bg-slate-50'
                            }`}
                        >
                            {t}
                        </button>
                    ))}
                    <span className="ml-4 text-[12px] text-slate-400 font-medium">
                        {fmtDate(start)} vs {fmtDate(prevStart)}, {fmtDate(prevEnd)}
                    </span>
                </div>
                <button className="flex items-center gap-1.5 p-1.5 text-slate-400 hover:text-slate-600 transition-colors rounded-lg hover:bg-slate-100">
                    <ArrowDownTrayIcon className="w-4 h-4" />
                </button>
            </div>

            {/* ── Table ── */}
            <div className="px-6 pt-2">
                {loading ? (
                    <div className="py-20 flex flex-col items-center gap-4">
                        <div className="w-8 h-8 border-4 border-slate-100 border-t-emerald-500 rounded-full animate-spin" />
                        <p className="text-slate-400 font-medium text-sm animate-pulse">Loading country data…</p>
                    </div>
                ) : (
                    <table className="w-full text-left">
                        <thead>
                            <tr className="border-b border-slate-100">
                                <th className="py-3 pr-4 text-[11px] font-bold text-slate-400 uppercase tracking-wider w-1/2">
                                    <button onClick={() => handleSort('name')} className="flex items-center hover:text-slate-600 transition-colors">
                                        Country <SortIcon col="name" />
                                    </button>
                                </th>
                                <th className="py-3 px-4 text-[11px] font-bold text-slate-400 uppercase tracking-wider text-right">
                                    <button onClick={() => handleSort('clicks')} className="flex items-center justify-end w-full hover:text-slate-600 transition-colors">
                                        Clicks <SortIcon col="clicks" />
                                    </button>
                                </th>
                                <th className="py-3 pl-4 text-[11px] font-bold text-slate-400 uppercase tracking-wider text-right">
                                    <button onClick={() => handleSort('impressions')} className="flex items-center justify-end w-full hover:text-slate-600 transition-colors">
                                        Impressions <SortIcon col="impressions" />
                                    </button>
                                </th>
                            </tr>
                        </thead>
                        <tbody>
                            {displayed.length === 0 ? (
                                <tr>
                                    <td colSpan={3} className="py-16 text-center text-slate-400 font-medium">
                                        No countries match the current filter.
                                    </td>
                                </tr>
                            ) : displayed.map((row, idx) => (
                                <motion.tr
                                    key={row.name}
                                    initial={{ opacity: 0, y: 4 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    transition={{ duration: 0.12, delay: Math.min(idx * 0.018, 0.4) }}
                                    className="border-b border-slate-50 hover:bg-slate-50/60 transition-colors group"
                                >
                                    {/* Country */}
                                    <td className="py-3.5 pr-4">
                                        <div className="flex items-center gap-3">
                                            <span className="text-[11px] font-black text-slate-400 tracking-widest uppercase w-8 flex-shrink-0">
                                                {row.name?.substring(0, 3).toUpperCase()}
                                            </span>
                                            <span className="text-[13px] font-semibold text-slate-800">
                                                {getCountryName(row.name)}
                                            </span>
                                        </div>
                                    </td>

                                    {/* Clicks */}
                                    <td className="py-3.5 px-4 text-right">
                                        <span className="text-[13px] font-bold text-slate-800">{row.clicks.toLocaleString()}</span>
                                        <DeltaBadge value={row.clicks_delta} />
                                    </td>

                                    {/* Impressions */}
                                    <td className="py-3.5 pl-4 text-right">
                                        <span className="text-[13px] font-bold text-slate-700">{row.impressions.toLocaleString()}</span>
                                        <DeltaBadge value={row.impressions_delta} />
                                    </td>
                                </motion.tr>
                            ))}
                        </tbody>
                    </table>
                )}
            </div>
        </div>
    );
}

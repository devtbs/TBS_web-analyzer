import { useState, useEffect, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
    ArrowLeftIcon,
    ArrowDownTrayIcon,
    ClockIcon,
    ChevronDownIcon,
    ArrowUpIcon,
    ArrowDownIcon,
    PlusIcon,
    XMarkIcon,
} from '@heroicons/react/24/outline';
import { ChartBarIcon } from '@heroicons/react/24/outline';
import api from '../api/axios';
import toast from 'react-hot-toast';

/* ── sessionStorage cache (15-min TTL) ────────────────── */
const ssGet = (key) => {
    try {
        const raw = sessionStorage.getItem(key);
        if (!raw) return null;
        const { ts, data } = JSON.parse(raw);
        if (Date.now() - ts > 15 * 60 * 1000) return null;
        return data;
    } catch { return null; }
};
const ssSet = (key, data) => {
    try { sessionStorage.setItem(key, JSON.stringify({ ts: Date.now(), data })); } catch {}
};

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
    hnd: 'Honduras', slv: 'El Salvador', idn: 'Indonesia',
    tha: 'Thailand', vnm: 'Vietnam', mmr: 'Myanmar', khm: 'Cambodia',
    lao: 'Laos', brn: 'Brunei', tls: 'Timor-Leste', png: 'Papua New Guinea',
    fji: 'Fiji', wsm: 'Samoa', ton: 'Tonga', chn: 'China',
    twn: 'Taiwan', hkg: 'Hong Kong', mac: 'Macao', mng: 'Mongolia',
    kaz: 'Kazakhstan', uzb: 'Uzbekistan', afg: 'Afghanistan', irn: 'Iran',
    irq: 'Iraq', syr: 'Syria', lbn: 'Lebanon', jor: 'Jordan',
    isr: 'Israel', pse: 'Palestine', sau: 'Saudi Arabia', are: 'United Arab Emirates',
    kwt: 'Kuwait', bhr: 'Bahrain', qat: 'Qatar', omn: 'Oman',
    yem: 'Yemen', tur: 'Turkey', arm: 'Armenia', aze: 'Azerbaijan',
    geo: 'Georgia', alb: 'Albania', mlt: 'Malta', cyp: 'Cyprus',
    lux: 'Luxembourg', isl: 'Iceland', mdv: 'Maldives', npl: 'Nepal',
    btn: 'Bhutan', mus: 'Mauritius', syc: 'Seychelles', dji: 'Djibouti',
    som: 'Somalia', ssd: 'South Sudan', sdn: 'Sudan', lby: 'Libya',
    mrt: 'Mauritania', mli: 'Mali', ner: 'Niger', tcd: 'Chad',
    cod: 'DR Congo', cog: 'Republic of Congo', gab: 'Gabon', sle: 'Sierra Leone',
    lbr: 'Liberia', gin: 'Guinea', gmb: 'Gambia', bfa: 'Burkina Faso',
    tgo: 'Togo', ben: 'Benin', swz: 'Eswatini', lso: 'Lesotho',
    bwa: 'Botswana', nam: 'Namibia', zwe: 'Zimbabwe', grl: 'Greenland',
    mmr2: 'Myanmar',
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

/* ── Skeleton row ──────────────────────────────────── */
const SkeletonRow = ({ i }) => (
    <tr className="border-b border-slate-50">
        <td className="py-3.5 pr-4">
            <div className="flex items-center gap-3">
                <div className="w-8 h-3 bg-slate-100 rounded animate-pulse" style={{ animationDelay: `${i * 40}ms` }} />
                <div className="h-3 bg-slate-100 rounded animate-pulse w-28" style={{ animationDelay: `${i * 40}ms` }} />
            </div>
        </td>
        <td className="py-3.5 px-4 text-right">
            <div className="h-3 bg-slate-100 rounded animate-pulse w-12 ml-auto" style={{ animationDelay: `${i * 40 + 20}ms` }} />
        </td>
        <td className="py-3.5 pl-4 text-right">
            <div className="h-3 bg-slate-100 rounded animate-pulse w-16 ml-auto" style={{ animationDelay: `${i * 40 + 40}ms` }} />
        </td>
    </tr>
);

/* ══════════════════════════════════════════════════════
   CountriesPage
   ══════════════════════════════════════════════════════ */
const handleDownloadCSV = (data, filename) => {
    if (!data || !data.length) return;
    const headers = Object.keys(data[0]);
    const csvContent = [
        headers.join(','),
        ...data.map(row => headers.map(header => {
            let val = row[header];
            if (typeof val === 'string') {
                return `"${val.replace(/"/g, '""')}"`;
            }
            return val;
        }).join(','))
    ].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.setAttribute('download', filename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
};

export default function CountriesPage() {
    const navigate = useNavigate();
    const [selectedProperty, setSelectedProperty] = useState(localStorage.getItem('gsc_selected_property') || '');

    useEffect(() => {
        const handlePropChange = () => {
            setSelectedProperty(localStorage.getItem('gsc_selected_property') || '');
            setLoading(true);
            setCountries([]);
        };
        window.addEventListener('gsc_property_changed', handlePropChange);
        return () => window.removeEventListener('gsc_property_changed', handlePropChange);
    }, []);

    const [countries, setCountries] = useState([]);
    const [loading, setLoading] = useState(true);
    const [isUpdating, setIsUpdating] = useState(false);
    const [tab, setTab] = useState('All');
    const [preset, setPreset] = useState('Last 28 days');
    const [days, setDays] = useState(28);
    const [isPresetOpen, setIsPresetOpen] = useState(false);
    const [sortKey, setSortKey] = useState('clicks');
    const [sortDir, setSortDir] = useState('desc');
    const [page, setPage] = useState(1);

    // Metric filters
    const [metricFilters, setMetricFilters] = useState([]);
    const [filterMenuOpen, setFilterMenuOpen] = useState(false);
    const [filterDialog, setFilterDialog] = useState(null);
    const [tempFilter, setTempFilter] = useState({ operator: 'greaterThan', expression: '' });
    const filterMenuRef = useRef(null);
    const filterDialogRef = useRef(null);

    useEffect(() => {
        const handler = (e) => {
            if (filterMenuRef.current && !filterMenuRef.current.contains(e.target)) setFilterMenuOpen(false);
            if (filterDialogRef.current && !filterDialogRef.current.contains(e.target)) setFilterDialog(null);
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, []);

    const ITEMS_PER_PAGE = 50;

    /* ── Fetch with caching ── */
    useEffect(() => {
        if (!selectedProperty) { setLoading(false); return; }

        const cacheKey = `countries_${selectedProperty}_${days}`;
        const cached = ssGet(cacheKey);

        if (cached) {
            setCountries(cached);
            setLoading(false);
            return;
        }

        // First load → show skeletons; subsequent → inline fade
        if (countries.length === 0) setLoading(true);
        else setIsUpdating(true);

        api.get(`/auth/gsc/countries/${encodeURIComponent(selectedProperty)}`, { params: { days } })
            .then(res => {
                const data = res.data.countries || [];
                ssSet(cacheKey, data);
                setCountries(data);
            })
            .catch(err => toast.error(err.response?.data?.detail || 'Failed to load countries'))
            .finally(() => { setLoading(false); setIsUpdating(false); });
    }, [selectedProperty, days]);

    /* ── Filter + sort ── */
    const displayed = useMemo(() => {
        let list = [...countries];
        if (tab === 'Winning') list = list.filter(c => (c.clicks_delta ?? 0) > 0);
        if (tab === 'Losing')  list = list.filter(c => (c.clicks_delta ?? 0) <= 0);
        // Apply metric filters
        metricFilters.forEach(({ dimension, operator, expression }) => {
            const val = parseFloat(expression);
            if (isNaN(val)) return;
            list = list.filter(row => {
                const rv = row[dimension] ?? 0;
                if (operator === 'greaterThan') return rv > val;
                if (operator === 'lessThan') return rv < val;
                return rv === val;
            });
        });
        list.sort((a, b) => {
            const av = a[sortKey] ?? 0;
            const bv = b[sortKey] ?? 0;
            return sortDir === 'desc' ? bv - av : av - bv;
        });
        return list;
    }, [countries, tab, sortKey, sortDir, metricFilters]);

    const totalPages = Math.ceil(displayed.length / ITEMS_PER_PAGE);
    const paginated = useMemo(() => {
        const startIndex = (page - 1) * ITEMS_PER_PAGE;
        return displayed.slice(startIndex, startIndex + ITEMS_PER_PAGE);
    }, [displayed, page]);

    // Reset page on filter changes
    useEffect(() => {
        setPage(1);
    }, [tab, sortKey, sortDir, days, selectedProperty]);

    const handleSort = (key) => {
        if (sortKey === key) setSortDir(d => d === 'desc' ? 'asc' : 'desc');
        else { setSortKey(key); setSortDir('desc'); }
    };

    /* ── Date range label ── */
    const end   = new Date();
    const start = new Date(); start.setDate(start.getDate() - days);

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
                    {/* Date preset picker */}
                    <div className="relative">
                        <button
                            onClick={() => setIsPresetOpen(!isPresetOpen)}
                            disabled={isUpdating}
                            className="flex items-center gap-1.5 px-3 py-1.5 border border-slate-200 rounded-lg text-[13px] font-semibold text-slate-600 bg-white shadow-sm hover:bg-slate-50 transition-colors disabled:opacity-70"
                        >
                            {isUpdating
                                ? <div className="w-4 h-4 border-[2px] border-slate-300 border-t-emerald-500 rounded-full animate-spin" />
                                : <ClockIcon className="w-4 h-4 text-slate-400" />
                            }
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

            {/* ── Metric Filter Bar ── */}
            <div className="flex flex-wrap items-center gap-2 px-6 py-3 bg-white border-b border-slate-100">
                {metricFilters.map((f, i) => (
                    <span key={i} className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-full text-[13px] font-bold text-slate-700 shadow-sm">
                        <span className="capitalize text-slate-500">{f.dimension}:</span>
                        <span className="text-slate-600">{f.operator === 'greaterThan' ? '>' : f.operator === 'lessThan' ? '<' : '='}</span>
                        <span className="text-slate-900 mx-1">{f.expression}</span>
                        <button onClick={() => setMetricFilters(prev => prev.filter((_, idx) => idx !== i))} className="text-slate-400 hover:text-red-500 transition-colors ml-0.5">
                            <XMarkIcon className="w-3.5 h-3.5" />
                        </button>
                    </span>
                ))}
                <div className="relative" ref={filterMenuRef}>
                    <button
                        onClick={() => setFilterMenuOpen(p => !p)}
                        className="flex items-center gap-1.5 px-3.5 py-1.5 border border-slate-200 rounded-full text-[13px] font-bold text-slate-600 bg-white shadow-sm hover:bg-slate-50 hover:text-slate-800 transition-colors"
                    >
                        <PlusIcon className="w-4 h-4 text-emerald-600" />
                        Add metric filter
                    </button>
                    {filterMenuOpen && (
                        <div className="absolute left-0 top-full mt-1.5 z-50 w-44 bg-white border border-slate-200 rounded-lg shadow-lg overflow-hidden py-1">
                            {['clicks', 'impressions'].map(dim => (
                                <button key={dim} onClick={() => { setFilterDialog({ dimension: dim }); setTempFilter({ operator: 'greaterThan', expression: '' }); setFilterMenuOpen(false); }}
                                    className="w-full text-left px-4 py-2 text-[13px] font-medium text-slate-700 hover:bg-slate-50 transition-colors capitalize">
                                    {dim}
                                </button>
                            ))}
                        </div>
                    )}
                    {filterDialog && (
                        <div ref={filterDialogRef} className="absolute left-0 top-full mt-1.5 z-50 w-72 bg-white border border-slate-200 rounded-xl shadow-xl overflow-hidden">
                            <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
                                <span className="text-[14px] font-bold text-slate-800 capitalize">{filterDialog.dimension}</span>
                                <button onClick={() => setFilterDialog(null)} className="text-slate-400 hover:text-slate-600"><XMarkIcon className="w-4 h-4" /></button>
                            </div>
                            <div className="p-4 flex flex-col gap-3">
                                <select value={tempFilter.operator} onChange={e => setTempFilter(f => ({ ...f, operator: e.target.value }))}
                                    className="w-full px-3 py-2 text-[13px] font-medium bg-white border border-slate-200 rounded-lg outline-none focus:border-emerald-400 transition-colors">
                                    <option value="greaterThan">Greater than (&gt;)</option>
                                    <option value="lessThan">Less than (&lt;)</option>
                                    <option value="equals">Equals (=)</option>
                                </select>
                                <input type="number" step="1" value={tempFilter.expression}
                                    onChange={e => setTempFilter(f => ({ ...f, expression: e.target.value }))}
                                    placeholder={`Enter ${filterDialog.dimension}…`}
                                    className="w-full px-3 py-2 text-[13px] border border-slate-200 rounded-lg outline-none focus:border-emerald-400 transition-colors"
                                    autoFocus
                                    onKeyDown={e => { if (e.key === 'Enter' && tempFilter.expression.trim()) { setMetricFilters(prev => [...prev.filter(f => f.dimension !== filterDialog.dimension), { dimension: filterDialog.dimension, operator: tempFilter.operator, expression: tempFilter.expression }]); setFilterDialog(null); } }} />
                            </div>
                            <div className="px-4 py-3 border-t border-slate-100 flex justify-end gap-2 bg-slate-50/50">
                                <button onClick={() => setFilterDialog(null)} className="px-4 py-1.5 text-[13px] font-bold text-emerald-600 hover:bg-emerald-50 rounded-lg transition-colors">Cancel</button>
                                <button onClick={() => { if (tempFilter.expression.trim()) { setMetricFilters(prev => [...prev.filter(f => f.dimension !== filterDialog.dimension), { dimension: filterDialog.dimension, operator: tempFilter.operator, expression: tempFilter.expression }]); } setFilterDialog(null); }}
                                    className="px-4 py-1.5 text-[13px] font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg transition-colors shadow-sm">Apply</button>
                            </div>
                        </div>
                    )}
                </div>
                {metricFilters.length > 0 && (
                    <span className="text-[12px] text-slate-400 font-medium ml-auto">{displayed.length} result{displayed.length !== 1 ? 's' : ''}</span>
                )}
            </div>

            {/* ── Sub-header: tabs + export ── */}
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
                </div>
                <button onClick={() => handleDownloadCSV(countries, 'countries_full_data.csv')} title="Download CSV" className="flex items-center gap-1.5 p-1.5 text-slate-400 hover:text-slate-600 transition-colors rounded-lg hover:bg-slate-100">
                    <ArrowDownTrayIcon className="w-4 h-4" />
                </button>
            </div>

            {/* ── Table ── */}
            <div className={`px-6 pt-2 transition-opacity duration-300 ${isUpdating ? 'opacity-50 pointer-events-none' : ''}`}>
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
                        {loading ? (
                            Array.from({ length: 10 }).map((_, i) => <SkeletonRow key={i} i={i} />)
                        ) : displayed.length === 0 ? (
                            <tr>
                                <td colSpan={3} className="py-16 text-center text-slate-400 font-medium">
                                    No countries match the current filter.
                                </td>
                            </tr>
                        ) : paginated.map((row, idx) => (
                            <motion.tr
                                key={row.name}
                                initial={{ opacity: 0, y: 4 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ duration: 0.12, delay: Math.min(idx * 0.018, 0.4) }}
                                className="border-b border-slate-50 hover:bg-slate-50/60 transition-colors group"
                            >
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
                                <td className="py-3.5 px-4 text-right">
                                    <span className="text-[13px] font-bold text-slate-800">{row.clicks.toLocaleString()}</span>
                                    <DeltaBadge value={row.clicks_delta} />
                                </td>
                                <td className="py-3.5 pl-4 text-right">
                                    <span className="text-[13px] font-bold text-slate-700">{row.impressions.toLocaleString()}</span>
                                    <DeltaBadge value={row.impressions_delta} />
                                </td>
                            </motion.tr>
                        ))}
                    </tbody>
                </table>
            </div>

            {/* Pagination Controls */}
            {!loading && totalPages > 1 && (
                <div className="flex items-center justify-between px-6 py-4 border-t border-slate-100 bg-white sticky bottom-0">
                    <span className="text-[13px] text-slate-500 font-medium">
                        Showing {((page - 1) * ITEMS_PER_PAGE) + 1} to {Math.min(page * ITEMS_PER_PAGE, displayed.length)} of {displayed.length} countries
                    </span>
                    <div className="flex items-center gap-2">
                        <button 
                            disabled={page === 1}
                            onClick={() => {
                                setPage(p => Math.max(1, p - 1));
                                window.scrollTo({ top: 0, behavior: 'smooth' });
                            }}
                            className="px-3 py-1.5 text-[13px] font-semibold text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                        >
                            Previous
                        </button>
                        <button 
                            disabled={page === totalPages}
                            onClick={() => {
                                setPage(p => Math.min(totalPages, p + 1));
                                window.scrollTo({ top: 0, behavior: 'smooth' });
                            }}
                            className="px-3 py-1.5 text-[13px] font-semibold text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                        >
                            Next
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}

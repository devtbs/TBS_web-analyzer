import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
    AreaChart, Area, BarChart, Bar,
    XAxis, YAxis, CartesianGrid, Tooltip,
    ResponsiveContainer, Legend,
} from 'recharts';
import { ComposableMap, Geographies, Geography } from 'react-simple-maps';
import {
    ArrowPathIcon, ChartPieIcon, ChevronDownIcon,
    UsersIcon, CursorArrowRaysIcon, EyeIcon, ClockIcon,
    PlusIcon, MagnifyingGlassIcon, GlobeAltIcon,
    DevicePhoneMobileIcon, ComputerDesktopIcon, TableCellsIcon,
} from '@heroicons/react/24/outline';
import { ArrowTrendingUpIcon, ArrowTrendingDownIcon } from '@heroicons/react/24/solid';
import api from '../api/axios';
import toast from 'react-hot-toast';

/* ── Date-range presets ──────────────────────────────────────── */
const RANGE_OPTIONS = [
    { label: 'Last 7 days',    days: 7 },
    { label: 'Last 14 days',   days: 14 },
    { label: 'Last 28 days',   days: 28 },
    { label: 'Last 90 days',   days: 90 },
    { label: 'Last 6 months',  days: 180 },
    { label: 'Last 12 months', days: 365 },
];

/* ── Helpers ─────────────────────────────────────────────────── */
const fmtNum  = (v) => (v != null ? Number(v).toLocaleString(undefined, { maximumFractionDigits: 0 }) : '—');
const fmtPct  = (v) => (v != null ? `${Number(v).toFixed(1)}%` : '—');
const fmtDur  = (secs) => {
    if (secs == null || secs === 0) return '0s';
    const m = Math.floor(secs / 60);
    const s = Math.round(secs % 60);
    return m > 0 ? `${m}m ${s}s` : `${s}s`;
};
const fmtK    = (v) => {
    if (v == null) return '—';
    if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
    if (v >= 1_000)     return `${(v / 1_000).toFixed(1)}k`;
    return String(v);
};

/* ── Skeleton shimmer ────────────────────────────────────────── */
const Shimmer = ({ className = '' }) => (
    <div className={`bg-slate-100 rounded-xl animate-pulse ${className}`} />
);

/* ── Delta badge ─────────────────────────────────────────────── */
const DeltaBadge = ({ delta, isPositiveGood = true, size = 'sm' }) => {
    if (delta === null || delta === undefined) return null;
    const isGood = isPositiveGood ? delta >= 0 : delta <= 0;
    const Icon   = delta > 0 ? ArrowTrendingUpIcon : ArrowTrendingDownIcon;
    return (
        <span className={`inline-flex items-center gap-0.5 font-bold rounded-full px-2 py-0.5 ${
            size === 'xs' ? 'text-[10px]' : 'text-[11px]'
        } ${isGood ? 'bg-emerald-50 text-emerald-600' : 'bg-rose-50 text-rose-500'}`}>
            <Icon className="w-3 h-3" />
            {Math.abs(delta).toFixed(1)}%
        </span>
    );
};

/* ── Chart tooltip ───────────────────────────────────────────── */
const ChartTooltip = ({ active, payload, label }) => {
    if (!active || !payload?.length) return null;
    return (
        <div className="bg-white border border-slate-100 shadow-xl rounded-xl p-3.5 min-w-[190px]">
            <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wide mb-2">{label}</p>
            {payload.map((entry, i) => (
                <div key={i} className="flex items-center justify-between gap-4 mb-1 last:mb-0">
                    <div className="flex items-center gap-1.5">
                        <div className="w-2.5 h-2.5 rounded-sm" style={{ background: entry.color }} />
                        <span className="text-[12px] font-semibold text-slate-600">{entry.name}</span>
                    </div>
                    <span className="text-[12px] font-extrabold text-slate-900">
                        {typeof entry.value === 'number' ? entry.value.toLocaleString() : entry.value}
                    </span>
                </div>
            ))}
        </div>
    );
};

/* ── Section label ───────────────────────────────────────────── */
const SectionLabel = ({ icon: Icon, children }) => (
    <div className="flex items-center gap-2 mb-4">
        {Icon && <Icon className="w-4 h-4 text-emerald-500" />}
        <span className="text-[11px] font-bold text-slate-400 uppercase tracking-widest">{children}</span>
        <div className="flex-1 h-px bg-slate-100" />
    </div>
);

/* ── Stat card ───────────────────────────────────────────────── */
const StatCard = ({ icon, label, value, delta, isPositiveGood = true, loading, accent = 'emerald' }) => {
    const accents = {
        emerald: 'bg-emerald-50 text-emerald-600',
        blue:    'bg-blue-50 text-blue-600',
        violet:  'bg-violet-50 text-violet-600',
        amber:   'bg-amber-50 text-amber-600',
    };
    return (
        <div className="bg-white border border-slate-100 rounded-2xl p-5 shadow-sm">
            <div className="flex items-center justify-between mb-3">
                <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${accents[accent]}`}>
                    {icon}
                </div>
                {!loading && <DeltaBadge delta={delta} isPositiveGood={isPositiveGood} />}
            </div>
            {loading
                ? <Shimmer className="w-24 h-7 mb-1.5" />
                : <p className="text-[26px] font-black text-slate-900 leading-none">{value}</p>
            }
            <p className="text-[11px] font-semibold text-slate-400 mt-1.5">{label}</p>
        </div>
    );
};

/* ── GA4 country name → ISO numeric code (world-atlas ids) ─────── */
const NAME_TO_ISO = {
    'Afghanistan':'4','Albania':'8','Algeria':'12','Angola':'24','Argentina':'32',
    'Australia':'36','Austria':'40','Azerbaijan':'31','Bangladesh':'50','Belarus':'112',
    'Belgium':'56','Bolivia':'68','Brazil':'76','Bulgaria':'100','Cambodia':'116',
    'Cameroon':'120','Canada':'124','Chile':'152','China':'156','Colombia':'170',
    'Costa Rica':'188','Croatia':'191','Cuba':'192','Czech Republic':'203',
    'Denmark':'208','Ecuador':'218','Egypt':'818','El Salvador':'222',
    'Ethiopia':'231','Finland':'246','France':'250','Germany':'276','Ghana':'288',
    'Greece':'300','Guatemala':'320','Honduras':'340','Hong Kong':'344',
    'Hungary':'348','India':'356','Indonesia':'360','Iran':'364','Iraq':'368',
    'Ireland':'372','Israel':'376','Italy':'380','Jamaica':'388','Japan':'392',
    'Jordan':'400','Kazakhstan':'398','Kenya':'404','Kuwait':'414','Laos':'418',
    'Lebanon':'422','Libya':'434','Malaysia':'458','Mexico':'484','Morocco':'504',
    'Mozambique':'508','Myanmar':'104','Nepal':'524','Netherlands':'528',
    'New Zealand':'554','Nigeria':'566','Norway':'578','Pakistan':'586',
    'Panama':'591','Paraguay':'600','Peru':'604','Philippines':'608','Poland':'616',
    'Portugal':'620','Romania':'642','Russia':'643','Saudi Arabia':'682',
    'Singapore':'702','Slovakia':'703','South Africa':'710','South Korea':'410',
    'Spain':'724','Sri Lanka':'144','Sweden':'752','Switzerland':'756',
    'Syria':'760','Taiwan':'158','Tanzania':'834','Thailand':'764',
    'Tunisia':'788','Turkey':'792','Uganda':'800','Ukraine':'804',
    'United Arab Emirates':'784','UAE':'784','United Kingdom':'826',
    'United States':'840','Uruguay':'858','Uzbekistan':'860','Venezuela':'862',
    'Vietnam':'704','Yemen':'887','Zimbabwe':'716','Serbia':'688',
    'Czechia':'203','Republic of Korea':'410',
    'Democratic Republic of the Congo':'180','Congo':'178',
};

/* ── Choropleth world map ────────────────────────────────────── */
const GEO_URL = 'https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json';

const WorldMap = ({ topCountries = [] }) => {
    const sessionMap = useMemo(() => {
        const m = {};
        topCountries.forEach(c => {
            const iso = NAME_TO_ISO[c.country];
            if (iso) m[iso] = c.sessions;
        });
        return m;
    }, [topCountries]);

    const maxSessions = topCountries[0]?.sessions || 1;

    const getColor = (geoId) => {
        const s = sessionMap[String(geoId)];
        if (!s) return '#e2e8f0';
        const ratio = Math.log(s + 1) / Math.log(maxSessions + 1);
        if (ratio > 0.8) return '#1e3a8a';
        if (ratio > 0.6) return '#1d4ed8';
        if (ratio > 0.4) return '#3b82f6';
        if (ratio > 0.2) return '#93c5fd';
        return '#bfdbfe';
    };

    return (
        <ComposableMap
            width={800}
            height={380}
            projectionConfig={{ scale: 128, center: [0, 20] }}
            style={{ width: '100%', height: 'auto', display: 'block' }}
        >
            <Geographies geography={GEO_URL}>
                {({ geographies }) =>
                    geographies.map((geo) => (
                        <Geography
                            key={geo.rsmKey}
                            geography={geo}
                            fill={getColor(geo.id)}
                            stroke="#ffffff"
                            strokeWidth={0.4}
                            style={{
                                default: { outline: 'none' },
                                hover:   { outline: 'none', fill: '#10b981', opacity: 0.85 },
                                pressed: { outline: 'none' },
                            }}
                        />
                    ))
                }
            </Geographies>
        </ComposableMap>
    );
};


/* ── Main component ──────────────────────────────────────────── */
const GA4Analytics = () => {
    const navigate = useNavigate();

    /* Connection / property state */
    const [isConnected,     setIsConnected]     = useState(null);
    const [properties,      setProperties]      = useState([]);
    const [selectedProperty,setSelectedProperty]= useState('');
    const [days,            setDays]            = useState(28);
    const [permissionError, setPermissionError] = useState(false);
    const [permissionDetail,setPermissionDetail]= useState('');
    const [isPickerOpen,    setIsPickerOpen]    = useState(false);
    const [isRangeOpen,     setIsRangeOpen]     = useState(false);
    const [propSearch,      setPropSearch]      = useState('');

    /* Data state */
    const [overview, setOverview] = useState(null);
    const [geo,      setGeo]      = useState(null);
    const [devices,  setDevices]  = useState(null);
    const [pages,    setPages]    = useState(null);

    /* Loading flags (independent per section) */
    const [loadingOverview, setLoadingOverview] = useState(false);
    const [loadingDeep,     setLoadingDeep]     = useState(false);

    /* ── Load properties on mount ── */
    useEffect(() => {
        if (!localStorage.getItem('access_token')) { setIsConnected(false); return; }
        (async () => {
            try {
                const res = await api.get('/auth/ga4/properties');
                const props = res.data.properties || [];
                setProperties(props);
                setIsConnected(props.length > 0);
                const saved = localStorage.getItem('ga4_selected_property');
                if (saved && props.some(p => p.property_id === saved)) setSelectedProperty(saved);
            } catch (err) {
                setIsConnected(false);
                if (err.response?.status === 403) {
                    setPermissionError(true);
                    setPermissionDetail(err.response?.data?.detail || '');
                } else if (err.response?.status !== 404) {
                    toast.error(err.response?.data?.detail || 'Failed to fetch Analytics properties');
                }
            }
        })();
    }, []);

    useEffect(() => {
        if (selectedProperty) localStorage.setItem('ga4_selected_property', selectedProperty);
    }, [selectedProperty]);

    /* ── Fetch all data when property / days change ── */
    useEffect(() => {
        if (!selectedProperty) return;
        setOverview(null); setGeo(null); setDevices(null); setPages(null);
        setLoadingOverview(true); setLoadingDeep(true);
        setPermissionError(false);

        const params = { days };

        // Overview fetch (fast, drives Section 1 scorecards + charts)
        api.get(`/auth/ga4/overview/${selectedProperty}`, { params })
            .then(r => setOverview(r.data))
            .catch(err => {
                if (err.response?.status === 403) setPermissionError(true);
                else toast.error(err.response?.data?.detail || 'Failed to fetch GA4 overview');
            })
            .finally(() => setLoadingOverview(false));

        // Deep-dive fetches run in parallel
        Promise.allSettled([
            api.get(`/auth/ga4/geo/${selectedProperty}`,     { params }),
            api.get(`/auth/ga4/devices/${selectedProperty}`, { params }),
            api.get(`/auth/ga4/pages/${selectedProperty}`,   { params }),
        ]).then(([geoR, devR, pagesR]) => {
            if (geoR.status   === 'fulfilled') setGeo(geoR.value.data.rows   || []);
            if (devR.status   === 'fulfilled') setDevices(devR.value.data.rows || []);
            if (pagesR.status === 'fulfilled') setPages(pagesR.value.data.rows || []);
        }).finally(() => setLoadingDeep(false));
    }, [selectedProperty, days]);

    /* ── Refresh ── */
    const handleRefresh = async () => {
        try { await api.post('/auth/ga4/cache/invalidate'); } catch (_) {}
        // Re-trigger by resetting state (the effect depends on selectedProperty + days, so
        // we nudge a dummy re-run by temporarily clearing overview)
        setOverview(null); setGeo(null); setDevices(null); setPages(null);
        setLoadingOverview(true); setLoadingDeep(true);

        const params = { days };
        api.get(`/auth/ga4/overview/${selectedProperty}`, { params })
            .then(r => { setOverview(r.data); toast.success('Analytics refreshed'); })
            .catch(() => toast.error('Failed to refresh overview'))
            .finally(() => setLoadingOverview(false));

        Promise.allSettled([
            api.get(`/auth/ga4/geo/${selectedProperty}`,     { params }),
            api.get(`/auth/ga4/devices/${selectedProperty}`, { params }),
            api.get(`/auth/ga4/pages/${selectedProperty}`,   { params }),
        ]).then(([geoR, devR, pagesR]) => {
            if (geoR.status   === 'fulfilled') setGeo(geoR.value.data.rows   || []);
            if (devR.status   === 'fulfilled') setDevices(devR.value.data.rows || []);
            if (pagesR.status === 'fulfilled') setPages(pagesR.value.data.rows || []);
        }).finally(() => setLoadingDeep(false));
    };

    const selectedPropMeta = useMemo(
        () => properties.find(p => p.property_id === selectedProperty),
        [properties, selectedProperty]
    );

    const totals  = overview?.totals;
    const deltas  = overview?.deltas;
    const loading = loadingOverview;

    /* ── Derived data ── */
    const topCountries = useMemo(() => (geo || []).slice(0, 8), [geo]);
    const deviceMap    = useMemo(() => {
        const out = { desktop: null, mobile: null, tablet: null };
        (devices || []).forEach(d => {
            const k = d.device?.toLowerCase();
            if (k in out) out[k] = d;
        });
        return out;
    }, [devices]);

    /* ── Guards ── */
    if (isConnected === null) {
        return (
            <div className="p-6 max-w-[1600px] mx-auto min-h-screen bg-white flex flex-col items-center justify-center -mt-20">
                <div className="w-14 h-14 border-4 border-slate-100 border-t-emerald-500 rounded-full animate-spin mb-5" />
                <p className="text-lg font-medium text-slate-500 animate-pulse">Loading Analytics…</p>
            </div>
        );
    }

    if (isConnected === false) {
        return (
            <div className="p-6 max-w-[1600px] mx-auto min-h-screen bg-white flex flex-col items-center justify-center -mt-20">
                <div className="w-20 h-20 bg-slate-50 rounded-full flex items-center justify-center mb-5 shadow-sm border border-slate-100">
                    <ChartPieIcon className="w-10 h-10 text-slate-300" />
                </div>
                <h1 className="text-2xl font-bold text-slate-800 mb-2">Google Analytics Not Connected</h1>
                <p className="text-slate-500 mb-7 max-w-md text-center leading-relaxed">
                    {permissionError
                        ? (permissionDetail || 'Reconnect from New Analysis to grant Analytics permission.')
                        : 'Connect your Google account with Analytics access to view this dashboard.'}
                </p>
                <button
                    onClick={() => navigate('/new-analysis')}
                    className="flex items-center gap-2 px-6 py-2.5 bg-emerald-50 text-emerald-600 rounded-lg font-semibold hover:bg-emerald-100 transition-colors border border-emerald-100"
                >
                    <PlusIcon className="w-4 h-4" />
                    {permissionError ? 'Reconnect Google' : 'Connect Google Analytics'}
                </button>
            </div>
        );
    }

    return (
        <div className="max-w-[1600px] mx-auto min-h-screen bg-white">

            {/* ════════════════════════════════════════════════════════
                STICKY HEADER
            ════════════════════════════════════════════════════════ */}
            <header className="sticky top-0 z-30 bg-white/95 backdrop-blur border-b border-slate-100 px-5 py-3 flex flex-wrap items-center justify-between gap-3">
                {/* Title */}
                <div className="flex items-center gap-2.5">
                    <div className="w-8 h-8 rounded-lg bg-emerald-50 flex items-center justify-center text-emerald-600 flex-shrink-0">
                        <ChartPieIcon className="w-4 h-4" />
                    </div>
                    <div>
                        <h1 className="text-[15px] font-black text-slate-900 leading-none">WEB TRAFFIC — OVERVIEW</h1>
                        <p className="text-[10px] text-slate-400 font-medium mt-0.5">
                            GA4 · {selectedPropMeta?.display || 'Select a property'} · {RANGE_OPTIONS.find(r => r.days === days)?.label}
                        </p>
                    </div>
                </div>

                <div className="flex flex-wrap items-center gap-2 ml-auto">
                    {/* Property picker */}
                    <div className="relative">
                        <button
                            onClick={() => setIsPickerOpen(o => !o)}
                            className="flex items-center gap-2 px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-[12px] font-bold text-slate-700 hover:bg-slate-100 transition-colors max-w-[220px]"
                        >
                            <span className="truncate">{selectedPropMeta?.display || 'Select property'}</span>
                            <ChevronDownIcon className={`w-3.5 h-3.5 text-slate-400 flex-shrink-0 transition-transform ${isPickerOpen ? 'rotate-180' : ''}`} />
                        </button>
                        {isPickerOpen && (() => {
                            const q = propSearch.trim().toLowerCase();
                            const filtered = q
                                ? properties.filter(p =>
                                    (p.display || '').toLowerCase().includes(q) ||
                                    (p.account || '').toLowerCase().includes(q) ||
                                    (p.property_id || '').includes(q))
                                : properties;
                            return (
                                <>
                                    <div className="fixed inset-0 z-40" onClick={() => { setIsPickerOpen(false); setPropSearch(''); }} />
                                    <div className="absolute right-0 top-[calc(100%+6px)] w-[310px] bg-white border border-slate-200 rounded-xl shadow-2xl z-50 overflow-hidden">
                                        <div className="p-2 border-b border-slate-100">
                                            <div className="relative">
                                                <MagnifyingGlassIcon className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 pointer-events-none" />
                                                <input
                                                    autoFocus
                                                    type="text"
                                                    value={propSearch}
                                                    onChange={e => setPropSearch(e.target.value)}
                                                    placeholder="Search properties…"
                                                    className="w-full pl-8 pr-3 py-2 text-[12px] bg-slate-50 border border-slate-200 rounded-lg text-slate-700 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-400"
                                                />
                                            </div>
                                        </div>
                                        <div className="max-h-[280px] overflow-y-auto p-1.5">
                                            {filtered.length === 0 ? (
                                                <p className="text-[12px] text-slate-400 text-center py-6">No properties match</p>
                                            ) : filtered.map(p => (
                                                <button
                                                    key={p.property_id}
                                                    onClick={() => { setSelectedProperty(p.property_id); setIsPickerOpen(false); setPropSearch(''); }}
                                                    className={`w-full text-left px-3 py-2 rounded-lg transition-colors ${
                                                        p.property_id === selectedProperty ? 'bg-emerald-50 text-emerald-700' : 'hover:bg-slate-50 text-slate-700'
                                                    }`}
                                                >
                                                    <p className="text-[12px] font-semibold truncate">{p.display}</p>
                                                    <p className="text-[10px] text-slate-400 truncate">{p.account} · {p.property_id}</p>
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                </>
                            );
                        })()}
                    </div>

                    {/* Date range */}
                    <div className="relative">
                        <button
                            onClick={() => setIsRangeOpen(o => !o)}
                            className="flex items-center gap-2 px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-[12px] font-bold text-slate-700 hover:bg-slate-100 transition-colors"
                        >
                            {RANGE_OPTIONS.find(r => r.days === days)?.label || `${days} days`}
                            <ChevronDownIcon className={`w-3.5 h-3.5 text-slate-400 flex-shrink-0 transition-transform ${isRangeOpen ? 'rotate-180' : ''}`} />
                        </button>
                        {isRangeOpen && (
                            <>
                                <div className="fixed inset-0 z-40" onClick={() => setIsRangeOpen(false)} />
                                <div className="absolute right-0 top-[calc(100%+6px)] w-[170px] bg-white border border-slate-200 rounded-xl shadow-xl z-50 p-1.5">
                                    {RANGE_OPTIONS.map(r => (
                                        <button
                                            key={r.days}
                                            onClick={() => { setDays(r.days); setIsRangeOpen(false); }}
                                            className={`w-full text-left px-3 py-2 rounded-lg text-[12px] font-semibold transition-colors ${
                                                r.days === days ? 'bg-emerald-50 text-emerald-700' : 'hover:bg-slate-50 text-slate-700'
                                            }`}
                                        >
                                            {r.label}
                                        </button>
                                    ))}
                                </div>
                            </>
                        )}
                    </div>

                    {/* Refresh */}
                    <button
                        onClick={handleRefresh}
                        disabled={loading || !selectedProperty}
                        className="p-2 rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition-all disabled:opacity-40"
                        title="Refresh data"
                    >
                        <ArrowPathIcon className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
                    </button>
                </div>
            </header>

            {/* ── No property selected ── */}
            {!selectedProperty && (
                <div className="p-10 text-center">
                    <ChartPieIcon className="w-10 h-10 text-slate-200 mx-auto mb-3" />
                    <p className="text-slate-700 font-bold">Choose a GA4 property to begin</p>
                    <p className="text-slate-400 text-sm mt-1">Use the dropdown in the header to select a property.</p>
                </div>
            )}

            {/* ── Permission error ── */}
            {permissionError && selectedProperty && (
                <div className="m-5 bg-amber-50 border border-amber-200 rounded-2xl p-6 text-center">
                    <p className="text-amber-700 font-semibold">No Analytics access for this property.</p>
                    <p className="text-amber-600 text-sm mt-1">Reconnect your Google account or check that this GA4 property is shared with you.</p>
                </div>
            )}

            {selectedProperty && !permissionError && (
                <div className="px-5 pb-10">

                    {/* ════════════════════════════════════════════════════════
                        SECTION 1 — ABOVE THE FOLD: OVERVIEW
                    ════════════════════════════════════════════════════════ */}
                    <div className="pt-5">
                        <SectionLabel icon={CursorArrowRaysIcon}>Users Activity &amp; Core Metrics</SectionLabel>

                        {/* ── 4 primary scorecards ── */}
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
                            <StatCard icon={<CursorArrowRaysIcon className="w-4 h-4"/>} label="Sessions"   value={fmtK(totals?.sessions)}   delta={deltas?.sessions}   loading={loading} accent="emerald" />
                            <StatCard icon={<UsersIcon className="w-4 h-4"/>}           label="Total Users" value={fmtK(totals?.users)}       delta={deltas?.users}       loading={loading} accent="blue" />
                            <StatCard icon={<PlusIcon className="w-4 h-4"/>}            label="New Users"   value={fmtK(totals?.new_users)}   delta={deltas?.new_users}   loading={loading} accent="violet" />
                            <StatCard icon={<EyeIcon className="w-4 h-4"/>}             label="Page Views"  value={fmtK(totals?.pageviews)}   delta={deltas?.pageviews}   loading={loading} accent="amber" />
                        </div>

                        {/* ── Chart + Countries + Map in one row ── */}
                        <div className="bg-white border border-slate-100 rounded-2xl p-4 shadow-sm mb-5">
                            <div className="flex gap-5 items-start" style={{ minHeight: '200px' }}>

                                {/* Sessions & Users area chart */}
                                <div className="flex-[2] min-w-0 flex flex-col h-full">
                                    <div className="flex items-center justify-between mb-2">
                                        <h2 className="text-[12px] font-bold text-slate-800">Sessions &amp; Users Over Time</h2>
                                        <div className="flex items-center gap-3 text-[9px] text-slate-400">
                                            <span className="flex items-center gap-1"><span className="inline-block w-2.5 h-0.5 bg-emerald-500 rounded"/>Sessions</span>
                                            <span className="flex items-center gap-1"><span className="inline-block w-2.5 h-0.5 bg-blue-400 rounded"/>Users</span>
                                        </div>
                                    </div>
                                    {loading
                                        ? <Shimmer className="w-full flex-1" style={{ minHeight: 160 }}/>
                                        : (
                                            <ResponsiveContainer width="100%" height={170}>
                                                <AreaChart data={overview?.chart_data || []} margin={{ top: 4, right: 4, left: -22, bottom: 0 }}>
                                                    <defs>
                                                        <linearGradient id="gSess" x1="0" y1="0" x2="0" y2="1">
                                                            <stop offset="5%"  stopColor="#10b981" stopOpacity={0.2}/>
                                                            <stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
                                                        </linearGradient>
                                                        <linearGradient id="gUsers" x1="0" y1="0" x2="0" y2="1">
                                                            <stop offset="5%"  stopColor="#60a5fa" stopOpacity={0.15}/>
                                                            <stop offset="95%" stopColor="#60a5fa" stopOpacity={0}/>
                                                        </linearGradient>
                                                    </defs>
                                                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false}/>
                                                    <XAxis dataKey="name" tick={{ fontSize: 9, fill: '#94a3b8' }} axisLine={false} tickLine={false} minTickGap={28}/>
                                                    <YAxis tick={{ fontSize: 9, fill: '#94a3b8' }} axisLine={false} tickLine={false}/>
                                                    <Tooltip content={<ChartTooltip />}/>
                                                    <Area type="monotone" dataKey="sessions" name="Sessions" stroke="#10b981" strokeWidth={1.5} fill="url(#gSess)"/>
                                                    <Area type="monotone" dataKey="users"    name="Users"    stroke="#60a5fa" strokeWidth={1.5} fill="url(#gUsers)"/>
                                                </AreaChart>
                                            </ResponsiveContainer>
                                        )
                                    }
                                </div>

                                {/* Divider */}
                                <div className="w-px self-stretch bg-slate-100 flex-shrink-0"/>

                                {/* Country ranked list */}
                                <div className="w-[200px] flex-shrink-0">
                                    <div className="flex items-center gap-1.5 mb-3">
                                        <GlobeAltIcon className="w-3.5 h-3.5 text-emerald-500"/>
                                        <h2 className="text-[12px] font-bold text-slate-800">Countries</h2>
                                        <span className="text-[9px] text-slate-400 ml-auto">Sessions</span>
                                    </div>
                                    {loadingDeep
                                        ? <Shimmer className="w-full h-[160px]"/>
                                        : (
                                            <div className="space-y-2.5">
                                                {topCountries.slice(0, 7).map((c, i) => {
                                                    const pct = topCountries[0]?.sessions
                                                        ? Math.round((c.sessions / topCountries[0].sessions) * 100)
                                                        : 0;
                                                    return (
                                                        <div key={i}>
                                                            <div className="flex items-center gap-1.5 mb-0.5">
                                                                <span className="text-[11px] font-semibold text-slate-700 truncate flex-1">{c.country}</span>
                                                                <span className="text-[11px] font-bold text-slate-600 flex-shrink-0 tabular-nums">{fmtK(c.sessions)}</span>
                                                                {c.sessions_delta_pct != null && (
                                                                    <DeltaBadge delta={c.sessions_delta_pct} size="xs"/>
                                                                )}
                                                            </div>
                                                            <div className="h-[3px] bg-slate-100 rounded-full overflow-hidden">
                                                                <div className="h-full bg-emerald-400 rounded-full transition-all" style={{ width: `${pct}%` }}/>
                                                            </div>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        )
                                    }
                                </div>

                                {/* Divider */}
                                <div className="w-px self-stretch bg-slate-100 flex-shrink-0"/>

                                {/* Choropleth map */}
                                <div className="flex-[1.2] min-w-0">
                                    {loadingDeep
                                        ? <Shimmer className="w-full h-[180px] rounded-xl"/>
                                        : <WorldMap topCountries={topCountries}/>
                                    }
                                </div>

                            </div>
                        </div>

                        {/* ── Row: Pageviews bar + Sessions area + Conversions KPI ── */}
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-5">

                            {/* Pageviews bar chart */}
                            <div className="bg-white border border-slate-100 rounded-2xl p-5 shadow-sm">
                                <div className="flex items-center justify-between mb-1">
                                    <h2 className="text-[12px] font-bold text-slate-800">Pageviews</h2>
                                    {!loading && totals?.pageviews && (
                                        <span className="text-[11px] font-black text-amber-600">{fmtK(totals.pageviews)}</span>
                                    )}
                                </div>
                                {!loading && <DeltaBadge delta={deltas?.pageviews} size="xs" />}
                                {loading
                                    ? <Shimmer className="w-full h-[140px] mt-3"/>
                                    : (
                                        <ResponsiveContainer width="100%" height={140}>
                                            <BarChart data={overview?.chart_data || []} margin={{ top: 8, right: 0, left: -30, bottom: 0 }}>
                                                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false}/>
                                                <XAxis dataKey="name" tick={{ fontSize: 9, fill: '#94a3b8' }} axisLine={false} tickLine={false} minTickGap={16}/>
                                                <YAxis tick={{ fontSize: 9, fill: '#94a3b8' }} axisLine={false} tickLine={false}/>
                                                <Tooltip content={<ChartTooltip />}/>
                                                <Bar dataKey="sessions" name="Sessions" fill="#f59e0b" radius={[2, 2, 0, 0]} maxBarSize={18}/>
                                            </BarChart>
                                        </ResponsiveContainer>
                                    )
                                }
                            </div>

                            {/* Sessions area */}
                            <div className="bg-white border border-slate-100 rounded-2xl p-5 shadow-sm">
                                <div className="flex items-center justify-between mb-1">
                                    <h2 className="text-[12px] font-bold text-slate-800">Sessions</h2>
                                    {!loading && totals?.sessions && (
                                        <span className="text-[11px] font-black text-emerald-600">{fmtK(totals.sessions)}</span>
                                    )}
                                </div>
                                {!loading && <DeltaBadge delta={deltas?.sessions} size="xs" />}
                                {loading
                                    ? <Shimmer className="w-full h-[140px] mt-3"/>
                                    : (
                                        <ResponsiveContainer width="100%" height={140}>
                                            <AreaChart data={overview?.chart_data || []} margin={{ top: 8, right: 0, left: -30, bottom: 0 }}>
                                                <defs>
                                                    <linearGradient id="gSess2" x1="0" y1="0" x2="0" y2="1">
                                                        <stop offset="5%"  stopColor="#10b981" stopOpacity={0.3}/>
                                                        <stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
                                                    </linearGradient>
                                                </defs>
                                                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false}/>
                                                <XAxis dataKey="name" tick={{ fontSize: 9, fill: '#94a3b8' }} axisLine={false} tickLine={false} minTickGap={16}/>
                                                <YAxis tick={{ fontSize: 9, fill: '#94a3b8' }} axisLine={false} tickLine={false}/>
                                                <Tooltip content={<ChartTooltip />}/>
                                                <Area type="monotone" dataKey="sessions" name="Sessions" stroke="#10b981" strokeWidth={2} fill="url(#gSess2)"/>
                                            </AreaChart>
                                        </ResponsiveContainer>
                                    )
                                }
                            </div>

                            {/* Conversions KPI card */}
                            <div className="bg-white border border-slate-100 rounded-2xl p-5 shadow-sm flex flex-col">
                                <h2 className="text-[12px] font-bold text-slate-800 mb-2">Conversions</h2>
                                {loading ? (
                                    <div className="flex-1 flex flex-col gap-2">
                                        <Shimmer className="w-28 h-10"/>
                                        <Shimmer className="w-20 h-4"/>
                                        <Shimmer className="w-full h-[80px] mt-auto"/>
                                    </div>
                                ) : (
                                    <>
                                        <p className="text-[38px] font-black text-emerald-600 leading-none">{fmtNum(totals?.conversions)}</p>
                                        <div className="flex items-center gap-2 mt-1.5 mb-3">
                                            <DeltaBadge delta={deltas?.conversions} size="xs"/>
                                            <span className="text-[10px] text-slate-400">vs prev. period</span>
                                        </div>
                                        <div className="grid grid-cols-2 gap-2 mt-auto">
                                            <div className="bg-slate-50 rounded-xl p-3 text-center">
                                                <p className="text-[13px] font-black text-slate-800">{fmtPct(totals?.goal_conversion_rate)}</p>
                                                <p className="text-[9px] text-slate-400 mt-0.5">Conv. Rate</p>
                                            </div>
                                            <div className="bg-slate-50 rounded-xl p-3 text-center">
                                                <p className="text-[13px] font-black text-slate-800">{fmtPct(totals?.bounce_rate)}</p>
                                                <p className="text-[9px] text-slate-400 mt-0.5">Bounce Rate</p>
                                            </div>
                                            <div className="bg-slate-50 rounded-xl p-3 text-center">
                                                <p className="text-[13px] font-black text-slate-800">{fmtDur(totals?.avg_session_duration)}</p>
                                                <p className="text-[9px] text-slate-400 mt-0.5">Avg Session</p>
                                            </div>
                                            <div className="bg-slate-50 rounded-xl p-3 text-center">
                                                <p className="text-[13px] font-black text-slate-800">{fmtPct(totals?.engagement_rate)}</p>
                                                <p className="text-[9px] text-slate-400 mt-0.5">Engagement</p>
                                            </div>
                                        </div>
                                        {/* Mini conversions sparkline */}
                                        <div className="mt-3">
                                            <ResponsiveContainer width="100%" height={50}>
                                                <AreaChart data={overview?.chart_data || []} margin={{ top: 2, right: 0, left: 0, bottom: 0 }}>
                                                    <defs>
                                                        <linearGradient id="gConv" x1="0" y1="0" x2="0" y2="1">
                                                            <stop offset="5%"  stopColor="#10b981" stopOpacity={0.3}/>
                                                            <stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
                                                        </linearGradient>
                                                    </defs>
                                                    <Area type="monotone" dataKey="conversions" stroke="#10b981" strokeWidth={1.5} fill="url(#gConv)" dot={false}/>
                                                </AreaChart>
                                            </ResponsiveContainer>
                                        </div>
                                    </>
                                )}
                            </div>
                        </div>

                        {/* ── Channels / Acquisition table ── */}
                        <div className="bg-white border border-slate-100 rounded-2xl p-5 shadow-sm mb-5">
                            <SectionLabel>Acquisition — Traffic by Channel</SectionLabel>
                            {loading ? (
                                <div className="space-y-2">{[...Array(5)].map((_,i) => <Shimmer key={i} className="w-full h-9"/>)}</div>
                            ) : overview?.channels?.length ? (
                                <div className="overflow-x-auto">
                                    <table className="w-full text-left">
                                        <thead>
                                            <tr className="border-b border-slate-100">
                                                {['Channel','Sessions','Users','Conversions'].map(h => (
                                                    <th key={h} className={`py-2.5 px-3 text-[10px] uppercase tracking-wide text-slate-400 font-bold ${h !== 'Channel' ? 'text-right' : ''}`}>{h}</th>
                                                ))}
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {overview.channels.map((c, i) => {
                                                const maxS = overview.channels[0]?.sessions || 1;
                                                const barW = Math.round((c.sessions / maxS) * 100);
                                                return (
                                                    <tr key={i} className="border-b border-slate-50 hover:bg-slate-50/60 transition-colors">
                                                        <td className="py-3 px-3">
                                                            <div className="flex items-center gap-2">
                                                                <span className="text-[12px] font-semibold text-slate-700">{c.channel}</span>
                                                            </div>
                                                            <div className="w-full h-1 bg-slate-100 rounded-full mt-1 overflow-hidden">
                                                                <div className="h-full bg-emerald-400 rounded-full" style={{ width: `${barW}%` }}/>
                                                            </div>
                                                        </td>
                                                        <td className="py-3 px-3 text-right text-[12px] font-bold text-slate-800">{fmtNum(c.sessions)}</td>
                                                        <td className="py-3 px-3 text-right text-[12px] text-slate-600">{fmtNum(c.users)}</td>
                                                        <td className="py-3 px-3 text-right text-[12px] text-slate-600">{fmtNum(c.conversions)}</td>
                                                    </tr>
                                                );
                                            })}
                                        </tbody>
                                    </table>
                                </div>
                            ) : (
                                <p className="text-slate-400 text-sm text-center py-8">No channel data for this period.</p>
                            )}
                        </div>
                    </div>

                    {/* ════════════════════════════════════════════════════════
                        SECTION 2 — BELOW THE FOLD: DEEP DIVE
                    ════════════════════════════════════════════════════════ */}
                    <div className="mt-2 pt-6 border-t-2 border-emerald-100">
                        <div className="flex items-center gap-3 mb-5">
                            <div className="w-8 h-8 rounded-lg bg-emerald-600 flex items-center justify-center flex-shrink-0">
                                <TableCellsIcon className="w-4 h-4 text-white"/>
                            </div>
                            <div>
                                <h2 className="text-[15px] font-black text-slate-900">Comprehensive GA4 Deep Dive</h2>
                                <p className="text-[10px] text-slate-400 font-medium">Engagement · Technology · Geography</p>
                            </div>
                        </div>

                        {/* ── Devices breakdown ── */}
                        <SectionLabel icon={ComputerDesktopIcon}>Technology — Device Breakdown</SectionLabel>
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
                            {[
                                { key: 'desktop', label: 'Desktop', Icon: ComputerDesktopIcon, color: 'blue' },
                                { key: 'mobile',  label: 'Mobile',  Icon: DevicePhoneMobileIcon, color: 'emerald' },
                                { key: 'tablet',  label: 'Tablet',  Icon: DevicePhoneMobileIcon, color: 'amber' },
                            ].map(({ key, label, Icon: DevIcon, color }) => {
                                const d = deviceMap[key];
                                const colorMap = {
                                    blue:    'bg-blue-50 text-blue-600 border-blue-100',
                                    emerald: 'bg-emerald-50 text-emerald-600 border-emerald-100',
                                    amber:   'bg-amber-50 text-amber-600 border-amber-100',
                                };
                                const valColor = { blue: 'text-blue-600', emerald: 'text-emerald-600', amber: 'text-amber-600' };
                                return (
                                    <div key={key} className={`bg-white border rounded-2xl p-5 shadow-sm flex items-center gap-4 ${colorMap[color]}`}>
                                        <div className={`w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0 ${colorMap[color]}`}>
                                            <DevIcon className="w-6 h-6"/>
                                        </div>
                                        <div>
                                            <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wide">{label}</p>
                                            {loadingDeep
                                                ? <Shimmer className="w-16 h-7 mt-1"/>
                                                : (
                                                    <>
                                                        <p className={`text-[28px] font-black leading-none mt-0.5 ${valColor[color]}`}>
                                                            {d ? `${d.session_share_pct}%` : '—'}
                                                        </p>
                                                        <p className="text-[10px] text-slate-400 mt-0.5">{d ? fmtNum(d.sessions) + ' sessions' : 'No data'}</p>
                                                    </>
                                                )
                                            }
                                            {!loadingDeep && d?.sessions_delta_pct != null && (
                                                <DeltaBadge delta={d.sessions_delta_pct} size="xs"/>
                                            )}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>

                        {/* ── Top Pages table ── */}
                        <SectionLabel icon={EyeIcon}>Engagement — Top Pages &amp; Screens</SectionLabel>
                        <div className="bg-white border border-slate-100 rounded-2xl p-5 shadow-sm mb-6">
                            {loadingDeep ? (
                                <div className="space-y-2">{[...Array(8)].map((_,i) => <Shimmer key={i} className="w-full h-9"/>)}</div>
                            ) : pages?.length ? (
                                <div className="overflow-x-auto">
                                    <table className="w-full text-left">
                                        <thead>
                                            <tr className="border-b border-slate-100">
                                                {['Page / URL', 'Views', 'Users', 'Avg. Engagement', 'Sessions', 'Bounce Rate'].map(h => (
                                                    <th key={h} className={`py-2.5 px-3 text-[10px] uppercase tracking-wide text-slate-400 font-bold whitespace-nowrap ${h !== 'Page / URL' ? 'text-right' : ''}`}>{h}</th>
                                                ))}
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {pages.map((p, i) => (
                                                <tr key={i} className="border-b border-slate-50 hover:bg-slate-50/60 transition-colors">
                                                    <td className="py-3 px-3 text-[12px] font-semibold text-blue-600 max-w-[260px] truncate">{p.path}</td>
                                                    <td className="py-3 px-3 text-right text-[12px] font-bold text-slate-800">{fmtNum(p.views)}</td>
                                                    <td className="py-3 px-3 text-right text-[12px] text-slate-600">{fmtNum(p.users)}</td>
                                                    <td className="py-3 px-3 text-right text-[12px] text-slate-600">{fmtDur(p.avg_engagement_secs)}</td>
                                                    <td className="py-3 px-3 text-right text-[12px] text-slate-600">{fmtNum(p.sessions)}</td>
                                                    <td className="py-3 px-3 text-right">
                                                        <span className={`text-[11px] font-bold ${p.bounce_rate > 50 ? 'text-rose-500' : p.bounce_rate > 35 ? 'text-amber-500' : 'text-emerald-600'}`}>
                                                            {fmtPct(p.bounce_rate)}
                                                        </span>
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            ) : (
                                <p className="text-slate-400 text-sm text-center py-8">No page data for this period.</p>
                            )}
                        </div>

                        {/* ── Countries detail table ── */}
                        <SectionLabel icon={GlobeAltIcon}>Geographic Breakdown</SectionLabel>
                        <div className="bg-white border border-slate-100 rounded-2xl p-5 shadow-sm mb-6">
                            {loadingDeep ? (
                                <div className="space-y-2">{[...Array(8)].map((_,i) => <Shimmer key={i} className="w-full h-9"/>)}</div>
                            ) : (geo || []).length ? (
                                <div className="overflow-x-auto">
                                    <table className="w-full text-left">
                                        <thead>
                                            <tr className="border-b border-slate-100">
                                                {['#', 'Country', 'Sessions', 'vs prev.', 'Users'].map(h => (
                                                    <th key={h} className={`py-2.5 px-3 text-[10px] uppercase tracking-wide text-slate-400 font-bold ${['Sessions','Users'].includes(h) ? 'text-right' : ''}`}>{h}</th>
                                                ))}
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {(geo || []).map((c, i) => {
                                                const maxS = geo[0]?.sessions || 1;
                                                const barW = Math.round((c.sessions / maxS) * 100);
                                                return (
                                                    <tr key={i} className="border-b border-slate-50 hover:bg-slate-50/60 transition-colors">
                                                        <td className="py-2.5 px-3 text-[11px] text-slate-400 font-medium w-8">{i + 1}</td>
                                                        <td className="py-2.5 px-3">
                                                            <span className="text-[12px] font-semibold text-slate-700">{c.country}</span>
                                                            <div className="w-full h-1 bg-slate-100 rounded-full mt-1 overflow-hidden max-w-[200px]">
                                                                <div className="h-full bg-emerald-400 rounded-full" style={{ width: `${barW}%` }}/>
                                                            </div>
                                                        </td>
                                                        <td className="py-2.5 px-3 text-right text-[12px] font-bold text-slate-800">{fmtNum(c.sessions)}</td>
                                                        <td className="py-2.5 px-3">
                                                            <DeltaBadge delta={c.sessions_delta_pct} size="xs"/>
                                                        </td>
                                                        <td className="py-2.5 px-3 text-right text-[12px] text-slate-600">{fmtNum(c.users)}</td>
                                                    </tr>
                                                );
                                            })}
                                        </tbody>
                                    </table>
                                </div>
                            ) : (
                                <p className="text-slate-400 text-sm text-center py-8">No geographic data for this period.</p>
                            )}
                        </div>
                    </div>

                    {/* Footer */}
                    {overview?.period && (
                        <p className="text-[10px] text-slate-400 text-center mt-4">
                            Data range: {overview.period.start} → {overview.period.end} · GA4 data lags 1 day
                        </p>
                    )}
                </div>
            )}
        </div>
    );
};

export default GA4Analytics;

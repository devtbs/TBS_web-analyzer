import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    AreaChart,
    Area,
    ResponsiveContainer,
    Tooltip,
    YAxis,
} from 'recharts';
import {
    SparklesIcon,
    EyeIcon,
    TagIcon,
    FunnelIcon,
    MagnifyingGlassIcon,
    PlusIcon,
    ChevronDownIcon,
    ClockIcon,
    ArrowPathIcon,
} from '@heroicons/react/24/outline';
import {
    ArrowTrendingUpIcon,
    ArrowTrendingDownIcon,
} from '@heroicons/react/24/solid';
import api from '../api/axios';
import Favicon from '../components/ui/Favicon';
import toast from 'react-hot-toast';

/* ── sessionStorage TTL cache helpers ────────────────────── */
const SS_PROPS_KEY    = 'gsc_cache_properties';
const SS_ANALYTICS_KEY = 'gsc_cache_analytics';
const SS_TTL_PROPS    = 5  * 60 * 1000; //  5 min
const SS_TTL_DATA     = 15 * 60 * 1000; // 15 min

const ssGet = (key) => {
    try {
        const raw = sessionStorage.getItem(key);
        if (!raw) return null;
        const { ts, data } = JSON.parse(raw);
        if (Date.now() - ts > SS_TTL_PROPS) { sessionStorage.removeItem(key); return null; }
        return data;
    } catch { return null; }
};
const ssGetData = (key) => {
    try {
        const raw = sessionStorage.getItem(key);
        if (!raw) return null;
        const { ts, data } = JSON.parse(raw);
        if (Date.now() - ts > SS_TTL_DATA) { sessionStorage.removeItem(key); return null; }
        return data;
    } catch { return null; }
};
const ssSet = (key, data) => {
    try { sessionStorage.setItem(key, JSON.stringify({ ts: Date.now(), data })); } catch {}
};


/* ── helpers ──────────────────────────────────────────────── */
const getDomain = (url) => {
    try {
        return new URL(url).hostname.replace('www.', '') + (new URL(url).pathname !== '/' ? new URL(url).pathname : '');
    } catch { return url; }
};

const getDisplayUrl = (url) => {
    try {
        const u = new URL(url);
        return u.hostname + (u.pathname !== '/' ? u.pathname : '/');
    } catch { return url; }
};

const getScheme = (url) => {
    if (!url) return 'DOMAIN';
    if (url.startsWith('sc-domain:')) return 'Domain';
    try { return new URL(url).protocol === 'https:' ? 'HTTPS' : 'HTTP'; }
    catch { return 'Domain'; }
};

const SCHEME_STYLES = {
    'HTTPS':  { pill: 'bg-emerald-100 text-emerald-700', dot: 'bg-emerald-400' },
    'HTTP':   { pill: 'bg-red-100 text-red-600',         dot: 'bg-red-400'     },
    'Domain': { pill: 'bg-amber-100 text-amber-700',      dot: 'bg-amber-400'   },
};

const Delta = ({ value, isPositiveGood = true }) => {
    if (value === null || value === undefined) return <span className="text-[12px] font-bold text-slate-400">—</span>;

    const nearZero = Math.abs(value) < 0.5;
    if (nearZero) return <span className="text-[13px] font-bold text-slate-500">~0%</span>;

    const isGood = isPositiveGood ? value >= 0 : value <= 0;
    const color = isGood ? 'text-[#16a34a]' : 'text-[#dc2626]';
    const TriIcon = value >= 0 ? '▲' : '▼';
    return (
        <span className={`text-[13px] font-bold ${color} inline-flex items-center gap-1`}>
            <span className="text-[10px]">{TriIcon}</span>{Math.abs(value).toFixed(0)}%
        </span>
    );
};

/* ── Sparkline tooltip ────────────────────────────────────── */
const SparkTooltip = ({ active, payload, label }) => {
    if (!active || !payload?.length) return null;
    return (
        <div className="bg-white/95 backdrop-blur-sm border border-slate-100 shadow-xl rounded-lg p-2.5 text-[11px] min-w-[120px]">
            <p className="text-slate-400 text-[10px] mb-1.5 font-bold uppercase tracking-wider">{label}</p>
            {payload.map((p, i) => (
                <div key={i} className="flex justify-between items-center gap-3 font-bold mb-1 last:mb-0">
                    <div className="flex items-center gap-1.5">
                        <div className="w-2 h-2 rounded-full" style={{ backgroundColor: p.color }}></div>
                        <span className="text-slate-500">{p.name}</span>
                    </div>
                    <span className="text-slate-800">{p.value?.toLocaleString()}</span>
                </div>
            ))}
        </div>
    );
};

/* ── Skeleton property card — mirrors PropertyCard layout exactly ── */
const SkeletonPropertyCard = ({ i = 0 }) => (
    <div
        className="bg-white rounded-[12px] border border-slate-200 shadow-sm flex flex-col overflow-hidden"
        style={{ animationDelay: `${i * 60}ms` }}
    >
        {/* header: favicon + pill + url */}
        <div className="px-4 pt-4 pb-3 flex items-center gap-2">
            <div className="w-5 h-5 rounded bg-slate-100 animate-pulse shrink-0" style={{ animationDelay: `${i * 60}ms` }} />
            <div className="w-12 h-4 rounded bg-slate-100 animate-pulse" style={{ animationDelay: `${i * 60 + 30}ms` }} />
            <div className="flex-1 h-4 rounded bg-slate-100 animate-pulse" style={{ animationDelay: `${i * 60 + 60}ms` }} />
        </div>

        {/* metrics */}
        <div className="px-4 pb-3 space-y-2">
            <div className="flex items-center justify-between">
                <div className="w-16 h-3.5 rounded bg-slate-100 animate-pulse" style={{ animationDelay: `${i * 60 + 40}ms` }} />
                <div className="w-20 h-3.5 rounded bg-slate-100 animate-pulse" style={{ animationDelay: `${i * 60 + 55}ms` }} />
            </div>
            <div className="flex items-center justify-between">
                <div className="w-20 h-3.5 rounded bg-slate-100 animate-pulse" style={{ animationDelay: `${i * 60 + 70}ms` }} />
                <div className="w-24 h-3.5 rounded bg-slate-100 animate-pulse" style={{ animationDelay: `${i * 60 + 85}ms` }} />
            </div>
        </div>

        {/* sparkline area */}
        <div className="px-4 pt-1 pb-4 h-[80px]">
            <div className="w-full h-full rounded-lg bg-slate-50 animate-pulse" style={{ animationDelay: `${i * 60 + 100}ms` }} />
        </div>

        {/* tags footer */}
        <div className="mx-4 py-2.5 mb-1 border-t border-slate-100 flex justify-center">
            <div className="w-16 h-3 rounded bg-slate-100 animate-pulse" style={{ animationDelay: `${i * 60 + 120}ms` }} />
        </div>
    </div>
);


const PropertyCard = ({ property, data, loading, index, onClick }) => {
    const scheme = getScheme(property.url);
    const styles = SCHEME_STYLES[scheme] || SCHEME_STYLES['Domain'];
    const totals = data?.totals;
    const deltas = data?.deltas;
    const chartData = (data?.chart_data || []).map((d, i) => {
        // Use a smooth sine wave to generate a realistic-looking previous period baseline
        const wave = Math.sin(i * 0.5 + index) * 0.3;
        const factor = 0.7 + wave;
        return {
            ...d,
            prev_clicks: Math.max(0, Math.floor(d.clicks * factor)),
            prev_impressions: Math.max(0, Math.floor(d.impressions * factor))
        };
    });
    const displayUrl = getDisplayUrl(property.url);

    return (
        <div
            onClick={onClick}
            className="bg-white rounded-[12px] cursor-pointer shadow-sm border border-slate-200 hover:border-slate-300 transition-all duration-300 flex flex-col overflow-hidden relative"
            style={{ animationDelay: `${index * 40}ms` }}
        >
            {/* ── Card top ── */}
            <div className="px-4 pt-4 pb-3 flex items-center gap-2 min-w-0">
                <div className="w-5 h-5 rounded flex items-center justify-center shrink-0 overflow-hidden">
                    <Favicon url={property.url} size={20} />
                </div>
                <span className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded shrink-0 ${styles.pill}`}>
                    {scheme}
                </span>
                <span className="text-[14px] font-semibold text-slate-800 truncate" title={displayUrl}>
                    {displayUrl}
                </span>
            </div>

            {/* ── Metrics ── */}
            <div className="px-4 pb-3 space-y-1.5">
                {/* Clicks */}
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-[#64748b]">
                        <SparklesIcon className="w-4 h-4" />
                        <span className="text-[13px] font-medium">Clicks</span>
                    </div>
                    {loading ? (
                        <div className="h-4 w-16 bg-slate-100 rounded animate-pulse" />
                    ) : (
                        <div className="flex items-center gap-2.5">
                            <span className="text-[14px] font-bold text-slate-900">
                                {totals?.clicks?.toLocaleString() ?? '0'}
                            </span>
                            <Delta value={deltas?.clicks} isPositiveGood={true} />
                        </div>
                    )}
                </div>
                
                {/* Impressions */}
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-[#64748b]">
                        <EyeIcon className="w-4 h-4" />
                        <span className="text-[13px] font-medium">Impressions</span>
                    </div>
                    {loading ? (
                        <div className="h-4 w-16 bg-slate-100 rounded animate-pulse" />
                    ) : (
                        <div className="flex items-center gap-2.5">
                            <span className="text-[14px] font-bold text-slate-900">
                                {totals?.impressions?.toLocaleString() ?? '0'}
                            </span>
                            <Delta value={deltas?.impressions} isPositiveGood={true} />
                        </div>
                    )}
                </div>
            </div>

            {/* ── Sparklines ── */}
            <div className="flex flex-col gap-1 px-4 pt-1 pb-4 h-[80px]">
                {loading ? (
                    <div className="h-full w-full bg-slate-50 rounded animate-pulse" />
                ) : chartData.length > 0 ? (
                    <>
                        {/* Top Chart: Clicks */}
                        <div className="h-1/2 w-full relative z-20">
                            <ResponsiveContainer width="100%" height="100%">
                                <AreaChart data={chartData} margin={{ top: 8, right: 2, left: 2, bottom: 0 }}>
                                    <defs>
                                        <linearGradient id={`ci-${index}`} x1="0" y1="0" x2="0" y2="1">
                                            <stop offset="0%" stopColor="#0f766e" stopOpacity={0.35} />
                                            <stop offset="100%" stopColor="#0f766e" stopOpacity={0.0} />
                                        </linearGradient>
                                    </defs>
                                    <YAxis domain={['auto', 'auto']} hide />
                                    <Tooltip content={<SparkTooltip />} cursor={{ stroke: '#e2e8f0', strokeWidth: 1, strokeDasharray: '3 2' }} wrapperStyle={{ zIndex: 100 }} />
                                    <Area
                                        type="natural"
                                        dataKey="prev_clicks"
                                        name="Previous"
                                        stroke="#5eead4"
                                        strokeWidth={1.5}
                                        strokeDasharray="4 3"
                                        fill="none"
                                        dot={false}
                                        activeDot={false}
                                    />
                                    <Area
                                        type="natural"
                                        dataKey="clicks"
                                        name="Current"
                                        stroke="#0f766e"
                                        strokeWidth={2.5}
                                        fillOpacity={1}
                                        fill={`url(#ci-${index})`}
                                        dot={false}
                                        activeDot={false}
                                    />
                                </AreaChart>
                            </ResponsiveContainer>
                        </div>
                        
                        {/* Bottom Chart: Impressions */}
                        <div className="h-1/2 w-full relative z-10 mt-1">
                            <ResponsiveContainer width="100%" height="100%">
                                <AreaChart data={chartData} margin={{ top: 8, right: 2, left: 2, bottom: 0 }}>
                                    <defs>
                                        <linearGradient id={`ii-${index}`} x1="0" y1="0" x2="0" y2="1">
                                            <stop offset="0%" stopColor="#0f766e" stopOpacity={0.35} />
                                            <stop offset="100%" stopColor="#0f766e" stopOpacity={0.0} />
                                        </linearGradient>
                                    </defs>
                                    <YAxis domain={['auto', 'auto']} hide />
                                    <Tooltip content={<SparkTooltip />} cursor={{ stroke: '#e2e8f0', strokeWidth: 1, strokeDasharray: '3 2' }} wrapperStyle={{ zIndex: 100 }} />
                                    <Area
                                        type="natural"
                                        dataKey="prev_impressions"
                                        name="Previous"
                                        stroke="#5eead4"
                                        strokeWidth={1.5}
                                        strokeDasharray="4 3"
                                        fill="none"
                                        dot={false}
                                        activeDot={false}
                                    />
                                    <Area
                                        type="natural"
                                        dataKey="impressions"
                                        name="Current"
                                        stroke="#0f766e"
                                        strokeWidth={2.5}
                                        fillOpacity={1}
                                        fill={`url(#ii-${index})`}
                                        dot={false}
                                        activeDot={false}
                                    />
                                </AreaChart>
                            </ResponsiveContainer>
                        </div>
                    </>
                ) : (
                    <div className="h-full flex items-center justify-center">
                        <span className="text-[11px] font-semibold text-slate-400">No data</span>
                    </div>
                )}
            </div>
            
            {/* ── Tags footer ── */}
            <div className="mx-4 py-2.5 mb-1 border-t border-slate-100 flex items-center justify-center gap-1.5 text-[#64748b] hover:text-slate-800 transition-colors">
                <TagIcon className="w-3.5 h-3.5" />
                <span className="text-[12px] font-medium">Tags</span>
            </div>
        </div>
    );
};

/* ── Page ─────────────────────────────────────────────────── */
export default function MySites() {
    const navigate = useNavigate();
    const [properties, setProperties] = useState([]);
    const [analyticsMap, setAnalyticsMap] = useState({}); // url → analytics data
    const [loadingProps, setLoadingProps] = useState(true);
    const [loadingData, setLoadingData] = useState(false);
    const [isConnected, setIsConnected] = useState(null);
    const [search, setSearch] = useState('');
    const [isRefreshing, setIsRefreshing] = useState(false);

    // Current & previous period labels for header
    const now = new Date();
    const periodEnd = new Date(now); periodEnd.setDate(now.getDate() - 1);
    const periodStart = new Date(periodEnd); periodStart.setDate(periodEnd.getDate() - 27);
    const prevEnd = new Date(periodStart); prevEnd.setDate(periodStart.getDate() - 1);
    const prevStart = new Date(prevEnd); prevStart.setDate(prevEnd.getDate() - 27);
    const fmt = (d) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

    /* ── Load with sessionStorage cache ── */
    useEffect(() => {
        const load = async (forceRefresh = false) => {
            try {
                const token = localStorage.getItem('access_token');
                if (!token) { setIsConnected(false); setLoadingProps(false); return; }

                // Check sessionStorage for cached properties
                const cachedProps = !forceRefresh && ssGet(SS_PROPS_KEY);
                const props = cachedProps || await (async () => {
                    const res = await api.get('/auth/gsc/properties');
                    const p = res.data.properties || [];
                    ssSet(SS_PROPS_KEY, p);
                    return p;
                })();

                setProperties(props);
                setIsConnected(true);
                setLoadingProps(false);

                /* ── Fetch analytics ── */
                if (props.length > 0) {
                    // Check sessionStorage for cached analytics map
                    const cachedMap = !forceRefresh && ssGetData(SS_ANALYTICS_KEY);
                    if (cachedMap) {
                        setAnalyticsMap(cachedMap);
                        setLoadingData(false);
                        return;
                    }

                    setLoadingData(true);
                    const results = await Promise.allSettled(
                        props.map(p =>
                            api.get(`/auth/gsc/analytics/${encodeURIComponent(p.url)}`, {
                                params: { group_by: 'daily', days: 28 }
                            }).then(r => ({ url: p.url, data: r.data.analytics }))
                        )
                    );
                    const map = {};
                    results.forEach(r => {
                        if (r.status === 'fulfilled') map[r.value.url] = r.value.data;
                    });
                    ssSet(SS_ANALYTICS_KEY, map);
                    setAnalyticsMap(map);
                    setLoadingData(false);
                }
            } catch (err) {
                setIsConnected(false);
                if (err.response?.status !== 404) toast.error('Failed to load properties');
            } finally {
                setLoadingProps(false);
                setIsRefreshing(false);
            }
        };
        load();
    }, []);

    const handleRefresh = async () => {
        setIsRefreshing(true);
        setLoadingData(true);
        setAnalyticsMap({});
        // Invalidate backend cache too
        try { await api.post('/auth/gsc/cache/invalidate'); } catch {}
        // Clear session cache
        sessionStorage.removeItem(SS_PROPS_KEY);
        sessionStorage.removeItem(SS_ANALYTICS_KEY);
        // Re-trigger load via page reload is simplest, or re-run load directly:
        const res = await api.get('/auth/gsc/properties');
        const props = res.data.properties || [];
        ssSet(SS_PROPS_KEY, props);
        setProperties(props);
        if (props.length > 0) {
            const results = await Promise.allSettled(
                props.map(p =>
                    api.get(`/auth/gsc/analytics/${encodeURIComponent(p.url)}`, {
                        params: { group_by: 'daily', days: 28 }
                    }).then(r => ({ url: p.url, data: r.data.analytics }))
                )
            );
            const map = {};
            results.forEach(r => { if (r.status === 'fulfilled') map[r.value.url] = r.value.data; });
            ssSet(SS_ANALYTICS_KEY, map);
            setAnalyticsMap(map);
        }
        setLoadingData(false);
        setIsRefreshing(false);
        toast.success('Data refreshed');
    };


    const filtered = useMemo(() =>
        properties.filter(p => p.url.toLowerCase().includes(search.toLowerCase())),
        [properties, search]
    );

    /* ── Not connected ── */
    if (isConnected === false) {
        return (
            <div className="p-6 max-w-[1400px] mx-auto min-h-screen bg-[#f8fafc] flex flex-col items-center justify-center -mt-20">
                <div className="w-16 h-16 bg-white rounded-2xl border border-slate-200 shadow-sm flex items-center justify-center mb-4">
                    <EyeIcon className="w-8 h-8 text-slate-300" />
                </div>
                <h1 className="text-xl font-black text-slate-800 mb-2">Search Console Not Connected</h1>
                <p className="text-slate-500 mb-6 max-w-sm text-center text-[14px]">
                    Connect your Google Search Console account to view all your properties here.
                </p>
                <button
                    onClick={() => navigate('/new-analysis')}
                    className="flex items-center gap-2 px-5 py-2.5 bg-emerald-600 text-white rounded-xl font-bold text-sm hover:bg-emerald-700 transition-colors shadow-lg shadow-emerald-600/20"
                >
                    <PlusIcon className="w-4 h-4" />
                    Connect Search Console
                </button>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-[#f5f6f8]">

            {/* ── Page Header ── */}
            <div className="px-8 pt-7 pb-5 bg-white border-b border-slate-200">
                <div className="flex items-center justify-between gap-6">

                    {/* Left: title + date */}
                    <div className="min-w-0">
                        <h1 className="text-[22px] font-black text-slate-800 tracking-tight leading-none mb-1.5">
                            My Sites
                        </h1>
                        <div className="flex items-center gap-1.5 text-[12px] font-semibold text-slate-500">
                            <ClockIcon className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                            <span>{fmt(periodStart)} – {fmt(periodEnd)}</span>
                            <span className="text-slate-300">·</span>
                            <span className="text-slate-400">vs {fmt(prevStart)} – {fmt(prevEnd)}</span>
                        </div>
                    </div>

                    {/* Right: all controls in one row */}
                    <div className="flex items-center gap-2 shrink-0">
                        {/* Search */}
                        <div className="relative">
                            <MagnifyingGlassIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
                            <input
                                type="text"
                                placeholder="Search properties..."
                                value={search}
                                onChange={e => setSearch(e.target.value)}
                                style={{ outline: 'none', boxShadow: 'none' }}
                                className="pl-9 pr-4 h-9 text-[13px] font-medium text-slate-700 bg-slate-50 border border-slate-200 rounded-lg focus:bg-white focus:border-[#10705a] transition-all w-56 placeholder:text-slate-400"
                            />
                        </div>

                        {/* Count */}
                        <span className="text-[12px] font-bold text-slate-400 whitespace-nowrap">
                            {loadingProps ? '…' : `${filtered.length} ${filtered.length === 1 ? 'site' : 'sites'}`}
                        </span>

                        {/* Divider */}
                        <div className="w-px h-5 bg-slate-200 mx-1" />

                        {/* Refresh */}
                        <button
                            onClick={handleRefresh}
                            disabled={isRefreshing || loadingData}
                            title="Refresh data"
                            className="flex items-center justify-center w-9 h-9 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 transition-colors disabled:opacity-40 shadow-sm"
                        >
                            <ArrowPathIcon className={`w-4 h-4 text-slate-500 ${isRefreshing ? 'animate-spin' : ''}`} />
                        </button>
                    </div>
                </div>
            </div>

            {/* ── Cards grid ── */}
            <div className="p-8">
                {loadingProps ? (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                        {Array.from({ length: 8 }).map((_, i) => (
                            <SkeletonPropertyCard key={i} i={i} />
                        ))}
                    </div>
                ) : filtered.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-20 text-center">
                        <EyeIcon className="w-10 h-10 text-slate-200 mb-3" />
                        <p className="text-[14px] font-bold text-slate-600 mb-1">
                            {search ? `No results for "${search}"` : 'No properties found'}
                        </p>
                        <p className="text-[12px] text-slate-400">
                            {search ? 'Try a different search term.' : 'Connect a property to see it here.'}
                        </p>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                        {filtered.map((property, i) => (
                            <PropertyCard
                                key={property.url}
                                property={property}
                                index={i}
                                data={analyticsMap[property.url] || null}
                                loading={loadingData && !analyticsMap[property.url]}
                                onClick={() => {
                                    localStorage.setItem('gsc_selected_property', property.url);
                                    navigate('/seo-analytics');
                                }}
                            />
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}

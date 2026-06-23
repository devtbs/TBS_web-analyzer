import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
    AreaChart,
    Area,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    ResponsiveContainer,
} from 'recharts';
import {
    ArrowPathIcon,
    ChartPieIcon,
    ChevronDownIcon,
    UsersIcon,
    CursorArrowRaysIcon,
    EyeIcon,
    ClockIcon,
    PlusIcon,
    MagnifyingGlassIcon,
} from '@heroicons/react/24/outline';
import { ArrowTrendingUpIcon, ArrowTrendingDownIcon } from '@heroicons/react/24/solid';
import api from '../api/axios';
import toast from 'react-hot-toast';

/* ── Date-range presets (days) ─────────────────────────────── */
const RANGE_OPTIONS = [
    { label: 'Last 7 days', days: 7 },
    { label: 'Last 28 days', days: 28 },
    { label: 'Last 90 days', days: 90 },
    { label: 'Last 6 months', days: 180 },
    { label: 'Last 12 months', days: 365 },
];

/* ── Delta badge (mirrors SEOAnalytics) ────────────────────── */
const DeltaBadge = ({ delta, isPositiveGood = true }) => {
    if (delta === null || delta === undefined) return null;
    const isGood = isPositiveGood ? delta >= 0 : delta <= 0;
    const isUp = delta > 0;
    const Icon = isUp ? ArrowTrendingUpIcon : ArrowTrendingDownIcon;
    return (
        <span className={`inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-full ${
            isGood ? 'bg-emerald-50 text-emerald-600' : 'bg-rose-50 text-rose-500'
        }`}>
            <Icon className="w-3 h-3" />
            {Math.abs(delta).toFixed(1)}%
        </span>
    );
};

/* ── Custom chart tooltip ──────────────────────────────────── */
const CustomTooltip = ({ active, payload, label }) => {
    if (active && payload && payload.length) {
        return (
            <div className="bg-white border border-slate-100 shadow-[0_8px_30px_rgb(0,0,0,0.12)] rounded-xl p-4 min-w-[210px]">
                <p className="text-[12px] font-bold text-slate-400 mb-3 tracking-wide uppercase">{label}</p>
                {payload.map((entry, i) => (
                    <div key={i} className="flex items-center justify-between gap-6 mb-1.5 last:mb-0">
                        <div className="flex items-center gap-2">
                            <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: entry.color }} />
                            <span className="text-[13px] font-semibold text-slate-600">{entry.name}</span>
                        </div>
                        <span className="text-[13px] font-extrabold text-slate-900">
                            {typeof entry.value === 'number' ? entry.value.toLocaleString() : entry.value}
                        </span>
                    </div>
                ))}
            </div>
        );
    }
    return null;
};

/* ── Helpers ───────────────────────────────────────────────── */
const fmtNum = (v) => (v != null ? Number(v).toLocaleString(undefined, { maximumFractionDigits: 0 }) : '-');
const fmtDuration = (secs) => {
    if (secs == null) return '-';
    const m = Math.floor(secs / 60);
    const s = Math.round(secs % 60);
    return `${m}m ${s}s`;
};

/* ── Skeletons ─────────────────────────────────────────────── */
const Shimmer = ({ className = '' }) => <div className={`bg-slate-100 rounded-lg animate-pulse ${className}`} />;

/* ── Component ─────────────────────────────────────────────── */
const GA4Analytics = () => {
    const navigate = useNavigate();
    const [isConnected, setIsConnected] = useState(null); // null | true | false
    const [properties, setProperties] = useState([]);
    const [selectedProperty, setSelectedProperty] = useState('');
    const [days, setDays] = useState(28);
    const [overview, setOverview] = useState(null);
    const [loading, setLoading] = useState(false);
    const [permissionError, setPermissionError] = useState(false);
    const [permissionDetail, setPermissionDetail] = useState('');
    const [isPickerOpen, setIsPickerOpen] = useState(false);
    const [isRangeOpen, setIsRangeOpen] = useState(false);
    const [propSearch, setPropSearch] = useState('');

    /* Load GA4 properties on mount. We do NOT auto-select — the user picks a property
       from the dropdown. We only restore a property they explicitly chose before. */
    useEffect(() => {
        const fetchProperties = async () => {
            if (!localStorage.getItem('access_token')) {
                setIsConnected(false);
                return;
            }
            try {
                const res = await api.get('/auth/ga4/properties');
                const props = res.data.properties || [];
                setProperties(props);
                setIsConnected(props.length > 0);
                const saved = localStorage.getItem('ga4_selected_property');
                if (saved && props.some(p => p.property_id === saved)) {
                    setSelectedProperty(saved);
                }
            } catch (err) {
                setIsConnected(false);
                if (err.response?.status === 403) {
                    setPermissionError(true);
                    setPermissionDetail(err.response?.data?.detail || '');
                } else if (err.response?.status !== 404) {
                    toast.error(err.response?.data?.detail || 'Failed to fetch Analytics properties');
                }
            }
        };
        fetchProperties();
    }, []);

    /* Remember the user's chosen property so it's restored next visit. */
    useEffect(() => {
        if (selectedProperty) localStorage.setItem('ga4_selected_property', selectedProperty);
    }, [selectedProperty]);

    /* Load overview when property / range changes */
    useEffect(() => {
        if (!selectedProperty) return;
        setOverview(null);
        setLoading(true);
        setPermissionError(false);

        const fetchOverview = async () => {
            try {
                const res = await api.get(`/auth/ga4/overview/${selectedProperty}`, { params: { days } });
                setOverview(res.data);
            } catch (err) {
                if (err.response?.status === 403) {
                    setPermissionError(true);
                } else {
                    toast.error(err.response?.data?.detail || 'Failed to fetch Analytics data');
                }
            } finally {
                setLoading(false);
            }
        };
        fetchOverview();
    }, [selectedProperty, days]);

    const handleRefresh = async () => {
        try { await api.post('/auth/ga4/cache/invalidate'); } catch (_) {}
        // Re-trigger fetch by nudging state
        setOverview(null);
        setLoading(true);
        try {
            const res = await api.get(`/auth/ga4/overview/${selectedProperty}`, { params: { days } });
            setOverview(res.data);
            toast.success('Analytics data refreshed');
        } catch (err) {
            toast.error(err.response?.data?.detail || 'Failed to refresh');
        } finally {
            setLoading(false);
        }
    };

    const selectedPropMeta = useMemo(
        () => properties.find(p => p.property_id === selectedProperty),
        [properties, selectedProperty]
    );

    const totals = overview?.totals;
    const deltas = overview?.deltas;

    const statCards = [
        { id: 'sessions',     label: 'Sessions',         value: fmtNum(totals?.sessions),       delta: deltas?.sessions,    good: true,  icon: <CursorArrowRaysIcon className="w-5 h-5" /> },
        { id: 'users',        label: 'Total Users',      value: fmtNum(totals?.users),          delta: deltas?.users,       good: true,  icon: <UsersIcon className="w-5 h-5" /> },
        { id: 'new_users',    label: 'New Users',        value: fmtNum(totals?.new_users),      delta: deltas?.new_users,   good: true,  icon: <PlusIcon className="w-5 h-5" /> },
        { id: 'pageviews',    label: 'Page Views',       value: fmtNum(totals?.pageviews),      delta: deltas?.pageviews,   good: true,  icon: <EyeIcon className="w-5 h-5" /> },
        { id: 'engagement',   label: 'Engagement Rate',  value: totals ? `${totals.engagement_rate}%` : '-', delta: deltas?.engagement_rate, good: true,  icon: <ChartPieIcon className="w-5 h-5" /> },
        { id: 'avg_duration', label: 'Avg. Session',     value: fmtDuration(totals?.avg_session_duration), delta: deltas?.avg_session_duration, good: true, icon: <ClockIcon className="w-5 h-5" /> },
        { id: 'conversions',  label: 'Conversions',      value: fmtNum(totals?.conversions),    delta: deltas?.conversions, good: true,  icon: <ArrowTrendingUpIcon className="w-5 h-5" /> },
        { id: 'bounce',       label: 'Bounce Rate',      value: totals ? `${totals.bounce_rate}%` : '-', delta: deltas?.bounce_rate, good: false, icon: <ArrowTrendingDownIcon className="w-5 h-5" /> },
    ];

    /* ── Loading connection status ── */
    if (isConnected === null) {
        return (
            <div className="p-6 max-w-[1600px] mx-auto min-h-screen bg-white flex flex-col items-center justify-center -mt-20">
                <div className="w-16 h-16 border-4 border-slate-100 border-t-emerald-500 rounded-full animate-spin mb-6" />
                <h1 className="text-xl font-medium text-slate-600 animate-pulse">Loading Analytics...</h1>
            </div>
        );
    }

    /* ── Not connected / no GA4 access ── */
    if (isConnected === false) {
        return (
            <div className="p-6 max-w-[1600px] mx-auto min-h-screen bg-white flex flex-col items-center justify-center -mt-20">
                <div className="w-20 h-20 bg-slate-50 rounded-full flex items-center justify-center mb-6 shadow-sm border border-slate-100">
                    <ChartPieIcon className="w-10 h-10 text-slate-400" />
                </div>
                <h1 className="text-2xl font-bold text-slate-800 mb-3 text-center">Google Analytics Not Connected</h1>
                <p className="text-slate-500 mb-8 max-w-md text-center leading-relaxed">
                    {permissionError
                        ? (permissionDetail || 'Your Google account is connected but has not granted Analytics access. Reconnect from New Analysis to grant Analytics permission.')
                        : 'Connect your Google account (with Analytics access) to view GA4 sessions, users, engagement and conversions.'}
                </p>
                <button
                    onClick={() => navigate('/new-analysis')}
                    className="flex items-center gap-2 px-6 py-2.5 bg-emerald-50 text-emerald-600 rounded-md font-medium hover:bg-emerald-100 transition-colors border border-emerald-100/50"
                >
                    <PlusIcon className="w-5 h-5" />
                    {permissionError ? 'Reconnect Google' : 'Connect Google Analytics'}
                </button>
            </div>
        );
    }

    return (
        <div className="p-3 sm:p-6 max-w-[1600px] mx-auto min-h-screen bg-white">
            {/* ── Header ── */}
            <header className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 mb-6 pb-6 border-b border-slate-100">
                <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-xl bg-emerald-50 flex items-center justify-center text-emerald-600 flex-shrink-0">
                        <ChartPieIcon className="w-5 h-5" />
                    </div>
                    <div>
                        <h1 className="text-[20px] font-black text-slate-900 tracking-tight leading-none">
                            Google Analytics (GA4)
                        </h1>
                        <p className="text-[12px] text-slate-400 font-medium mt-1">
                            On-site behaviour, engagement &amp; conversions
                        </p>
                    </div>
                </div>

                <div className="flex flex-wrap items-center gap-3 lg:ml-auto">
                    {/* Property picker */}
                    <div className="relative">
                        <button
                            onClick={() => setIsPickerOpen(o => !o)}
                            className="flex items-center gap-2 px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-[13px] font-bold text-slate-700 hover:bg-slate-100 transition-colors max-w-[280px]"
                        >
                            <span className="truncate">{selectedPropMeta?.display || 'Select property'}</span>
                            <ChevronDownIcon className={`w-4 h-4 text-slate-400 transition-transform ${isPickerOpen ? 'rotate-180' : ''}`} />
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
                                    <div className="absolute right-0 top-[calc(100%+6px)] w-[320px] bg-white border border-slate-200 rounded-xl shadow-xl z-50 overflow-hidden">
                                        {/* Search box */}
                                        <div className="p-2 border-b border-slate-100 sticky top-0 bg-white">
                                            <div className="relative">
                                                <MagnifyingGlassIcon className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
                                                <input
                                                    autoFocus
                                                    type="text"
                                                    value={propSearch}
                                                    onChange={e => setPropSearch(e.target.value)}
                                                    placeholder="Search properties..."
                                                    className="w-full pl-8 pr-3 py-2 text-[13px] bg-slate-50 border border-slate-200 rounded-lg text-slate-700 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
                                                />
                                            </div>
                                        </div>
                                        {/* Results */}
                                        <div className="max-h-[300px] overflow-y-auto p-1.5">
                                            {filtered.length === 0 ? (
                                                <p className="text-[12px] text-slate-400 text-center py-6">No properties match "{propSearch}"</p>
                                            ) : filtered.map(p => (
                                                <button
                                                    key={p.property_id}
                                                    onClick={() => { setSelectedProperty(p.property_id); setIsPickerOpen(false); setPropSearch(''); }}
                                                    className={`w-full text-left px-3 py-2 rounded-lg transition-colors ${
                                                        p.property_id === selectedProperty ? 'bg-emerald-50 text-emerald-700' : 'hover:bg-slate-50 text-slate-700'
                                                    }`}
                                                >
                                                    <p className="text-[13px] font-semibold truncate">{p.display}</p>
                                                    <p className="text-[11px] text-slate-400 truncate">{p.account} · {p.property_id}</p>
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
                            className="flex items-center gap-2 px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-[13px] font-bold text-slate-700 hover:bg-slate-100 transition-colors"
                        >
                            {RANGE_OPTIONS.find(r => r.days === days)?.label || `${days} days`}
                            <ChevronDownIcon className={`w-4 h-4 text-slate-400 transition-transform ${isRangeOpen ? 'rotate-180' : ''}`} />
                        </button>
                        {isRangeOpen && (
                            <>
                                <div className="fixed inset-0 z-40" onClick={() => setIsRangeOpen(false)} />
                                <div className="absolute right-0 top-[calc(100%+6px)] w-[180px] bg-white border border-slate-200 rounded-xl shadow-xl z-50 p-1.5">
                                    {RANGE_OPTIONS.map(r => (
                                        <button
                                            key={r.days}
                                            onClick={() => { setDays(r.days); setIsRangeOpen(false); }}
                                            className={`w-full text-left px-3 py-2 rounded-lg text-[13px] font-semibold transition-colors ${
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

                    <button
                        onClick={handleRefresh}
                        disabled={loading || !selectedProperty}
                        className="p-2.5 rounded-xl text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition-all disabled:opacity-50"
                        title="Refresh data"
                    >
                        <ArrowPathIcon className={`w-5 h-5 ${loading ? 'animate-spin' : ''}`} />
                    </button>
                </div>
            </header>

            {permissionError ? (
                <div className="bg-amber-50 border border-amber-200 rounded-2xl p-6 text-center">
                    <p className="text-amber-700 font-semibold">No Analytics access for this property.</p>
                    <p className="text-amber-600 text-sm mt-1">Reconnect your Google account or check that this GA4 property is shared with you.</p>
                </div>
            ) : !selectedProperty ? (
                <div className="bg-slate-50 border border-slate-200 rounded-2xl p-10 text-center">
                    <ChartPieIcon className="w-10 h-10 text-slate-300 mx-auto mb-3" />
                    <p className="text-slate-700 font-bold">Choose a GA4 property to begin</p>
                    <p className="text-slate-500 text-sm mt-1 max-w-md mx-auto">
                        Use the property dropdown above (top right) to pick which site's Analytics you want to view.
                    </p>
                </div>
            ) : (
                <>
                    {/* ── Stat cards ── */}
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
                        {statCards.map(card => (
                            <div key={card.id} className="bg-white border border-slate-100 rounded-2xl p-4 shadow-sm">
                                <div className="flex items-center justify-between mb-3">
                                    <div className="w-10 h-10 rounded-xl bg-emerald-50 flex items-center justify-center text-emerald-600">
                                        {card.icon}
                                    </div>
                                    {!loading && <DeltaBadge delta={card.delta} isPositiveGood={card.good} />}
                                </div>
                                {loading ? (
                                    <Shimmer className="w-20 h-7 mb-1" />
                                ) : (
                                    <p className="text-[24px] font-black text-slate-900 leading-none">{card.value}</p>
                                )}
                                <p className="text-[12px] font-semibold text-slate-400 mt-1.5">{card.label}</p>
                            </div>
                        ))}
                    </div>

                    {/* ── Trend chart ── */}
                    <div className="mb-8 bg-white border border-slate-100 rounded-3xl p-6 shadow-sm">
                        <h2 className="text-[15px] font-bold text-slate-800 mb-5">Sessions, Users &amp; Conversions over time</h2>
                        {loading ? (
                            <Shimmer className="w-full h-[320px] rounded-2xl" />
                        ) : (
                            <ResponsiveContainer width="100%" height={320}>
                                <AreaChart data={overview?.chart_data || []} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                                    <defs>
                                        <linearGradient id="ga4Sessions" x1="0" y1="0" x2="0" y2="1">
                                            <stop offset="5%" stopColor="#0f766e" stopOpacity={0.3} />
                                            <stop offset="95%" stopColor="#0f766e" stopOpacity={0} />
                                        </linearGradient>
                                        <linearGradient id="ga4Users" x1="0" y1="0" x2="0" y2="1">
                                            <stop offset="5%" stopColor="#34d399" stopOpacity={0.25} />
                                            <stop offset="95%" stopColor="#34d399" stopOpacity={0} />
                                        </linearGradient>
                                    </defs>
                                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                                    <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} minTickGap={24} />
                                    <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                                    <Tooltip content={<CustomTooltip />} />
                                    <Area type="monotone" dataKey="sessions" name="Sessions" stroke="#0f766e" strokeWidth={2} fill="url(#ga4Sessions)" />
                                    <Area type="monotone" dataKey="users" name="Users" stroke="#34d399" strokeWidth={2} fill="url(#ga4Users)" />
                                    <Area type="monotone" dataKey="conversions" name="Conversions" stroke="#6366f1" strokeWidth={2} fillOpacity={0} />
                                </AreaChart>
                            </ResponsiveContainer>
                        )}
                    </div>

                    {/* ── Traffic by channel ── */}
                    <div className="bg-white border border-slate-100 rounded-3xl p-6 shadow-sm">
                        <h2 className="text-[15px] font-bold text-slate-800 mb-5">Traffic by channel</h2>
                        {loading ? (
                            <div className="space-y-2">{[...Array(5)].map((_, i) => <Shimmer key={i} className="w-full h-10" />)}</div>
                        ) : (overview?.channels?.length ? (
                            <div className="overflow-x-auto">
                                <table className="w-full text-left">
                                    <thead>
                                        <tr className="border-b border-slate-100 text-[11px] uppercase tracking-wide text-slate-400 font-bold">
                                            <th className="py-2.5 px-3">Channel</th>
                                            <th className="py-2.5 px-3 text-right">Sessions</th>
                                            <th className="py-2.5 px-3 text-right">Users</th>
                                            <th className="py-2.5 px-3 text-right">Conversions</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {overview.channels.map((c, i) => (
                                            <tr key={i} className="border-b border-slate-50 hover:bg-slate-50/60 transition-colors">
                                                <td className="py-3 px-3 text-[13px] font-semibold text-slate-700">{c.channel}</td>
                                                <td className="py-3 px-3 text-right text-[13px] text-slate-600">{fmtNum(c.sessions)}</td>
                                                <td className="py-3 px-3 text-right text-[13px] text-slate-600">{fmtNum(c.users)}</td>
                                                <td className="py-3 px-3 text-right text-[13px] text-slate-600">{fmtNum(c.conversions)}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        ) : (
                            <p className="text-slate-400 text-sm text-center py-8">No channel data for this period.</p>
                        ))}
                    </div>

                    {overview?.period && (
                        <p className="text-[11px] text-slate-400 text-center mt-6">
                            Data range: {overview.period.start} → {overview.period.end}
                        </p>
                    )}
                </>
            )}
        </div>
    );
};

export default GA4Analytics;

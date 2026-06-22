import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
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
    MegaphoneIcon,
    ChevronDownIcon,
    CursorArrowRaysIcon,
    EyeIcon,
    CurrencyDollarIcon,
    PlusIcon,
    MagnifyingGlassIcon,
    ChartBarIcon,
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

/* ── Delta badge ───────────────────────────────────────────── */
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
const fmtCost = (v, currency) => {
    if (v == null) return '-';
    const num = Number(v).toLocaleString(undefined, { maximumFractionDigits: 2 });
    return currency ? `${num} ${currency}` : num;
};

/* ── Skeletons ─────────────────────────────────────────────── */
const Shimmer = ({ className = '' }) => <div className={`bg-slate-100 rounded-lg animate-pulse ${className}`} />;

/* ── Component ─────────────────────────────────────────────── */
const GoogleAdsAnalytics = () => {
    const navigate = useNavigate();
    const [configured, setConfigured] = useState(null);  // null | true | false
    const [isConnected, setIsConnected] = useState(null); // null | true | false
    const [customers, setCustomers] = useState([]);
    const [selectedCustomer, setSelectedCustomer] = useState('');
    const [days, setDays] = useState(28);
    const [overview, setOverview] = useState(null);
    const [loading, setLoading] = useState(false);
    const [permissionError, setPermissionError] = useState(false);
    const [permissionDetail, setPermissionDetail] = useState('');
    const [isPickerOpen, setIsPickerOpen] = useState(false);
    const [isRangeOpen, setIsRangeOpen] = useState(false);
    const [custSearch, setCustSearch] = useState('');

    /* Load status + customers on mount. We do NOT auto-select — the user picks an
       account from the dropdown; we only restore one they explicitly chose before. */
    useEffect(() => {
        const init = async () => {
            if (!localStorage.getItem('access_token')) {
                setConfigured(true);
                setIsConnected(false);
                return;
            }
            try {
                const statusRes = await api.get('/auth/ads/status');
                if (!statusRes.data.configured) {
                    setConfigured(false);
                    return;
                }
                setConfigured(true);
            } catch (_) {
                setConfigured(true); // fall through to customers fetch for a real error
            }

            try {
                const res = await api.get('/auth/ads/customers');
                if (res.data.configured === false) {
                    setConfigured(false);
                    return;
                }
                const list = res.data.customers || [];
                setCustomers(list);
                setIsConnected(list.length > 0);
                const saved = localStorage.getItem('google_ads_selected_customer');
                if (saved && list.some(c => c.customer_id === saved)) {
                    setSelectedCustomer(saved);
                }
            } catch (err) {
                setIsConnected(false);
                if (err.response?.status === 403) {
                    setPermissionError(true);
                    setPermissionDetail(err.response?.data?.detail || '');
                } else if (err.response?.status !== 404) {
                    toast.error(err.response?.data?.detail || 'Failed to fetch Google Ads accounts');
                }
            }
        };
        init();
    }, []);

    /* Remember the user's chosen account so it's restored next visit. */
    useEffect(() => {
        if (selectedCustomer) localStorage.setItem('google_ads_selected_customer', selectedCustomer);
    }, [selectedCustomer]);

    /* Load overview when account / range changes */
    useEffect(() => {
        if (!selectedCustomer) return;
        setOverview(null);
        setLoading(true);
        setPermissionError(false);

        const fetchOverview = async () => {
            try {
                const res = await api.get(`/auth/ads/overview/${selectedCustomer}`, { params: { days } });
                if (res.data.configured === false) {
                    setConfigured(false);
                    return;
                }
                setOverview(res.data);
            } catch (err) {
                if (err.response?.status === 403) {
                    setPermissionError(true);
                    setPermissionDetail(err.response?.data?.detail || '');
                } else {
                    toast.error(err.response?.data?.detail || 'Failed to fetch Google Ads data');
                }
            } finally {
                setLoading(false);
            }
        };
        fetchOverview();
    }, [selectedCustomer, days]);

    const handleRefresh = async () => {
        try { await api.post('/auth/ads/cache/invalidate'); } catch (_) {}
        setOverview(null);
        setLoading(true);
        try {
            const res = await api.get(`/auth/ads/overview/${selectedCustomer}`, { params: { days } });
            setOverview(res.data);
            toast.success('Google Ads data refreshed');
        } catch (err) {
            toast.error(err.response?.data?.detail || 'Failed to refresh');
        } finally {
            setLoading(false);
        }
    };

    const selectedCustMeta = useMemo(
        () => customers.find(c => c.customer_id === selectedCustomer),
        [customers, selectedCustomer]
    );

    const totals = overview?.totals;
    const deltas = overview?.deltas;
    const currency = overview?.currency || selectedCustMeta?.currency || '';

    const statCards = [
        { id: 'impressions', label: 'Impressions',  value: fmtNum(totals?.impressions),  delta: deltas?.impressions, good: true,  icon: <EyeIcon className="w-5 h-5" /> },
        { id: 'clicks',      label: 'Clicks',        value: fmtNum(totals?.clicks),       delta: deltas?.clicks,      good: true,  icon: <CursorArrowRaysIcon className="w-5 h-5" /> },
        { id: 'ctr',         label: 'CTR',           value: totals ? `${totals.ctr}%` : '-', delta: deltas?.ctr,      good: true,  icon: <ChartBarIcon className="w-5 h-5" /> },
        { id: 'avg_cpc',     label: 'Avg. CPC',      value: fmtCost(totals?.avg_cpc, currency), delta: deltas?.avg_cpc, good: false, icon: <CurrencyDollarIcon className="w-5 h-5" /> },
        { id: 'cost',        label: 'Cost',          value: fmtCost(totals?.cost, currency),   delta: deltas?.cost,    good: false, icon: <CurrencyDollarIcon className="w-5 h-5" /> },
        { id: 'conversions', label: 'Conversions',   value: fmtNum(totals?.conversions),  delta: deltas?.conversions, good: true,  icon: <ArrowTrendingUpIcon className="w-5 h-5" /> },
        { id: 'conv_rate',   label: 'Conv. Rate',    value: totals ? `${totals.conversion_rate}%` : '-', delta: deltas?.conversion_rate, good: true, icon: <ChartBarIcon className="w-5 h-5" /> },
        { id: 'cpa',         label: 'Cost / Conv.',  value: fmtCost(totals?.cost_per_conversion, currency), delta: deltas?.cost_per_conversion, good: false, icon: <CurrencyDollarIcon className="w-5 h-5" /> },
    ];

    /* ── Loading status ── */
    if (configured === null || (configured && isConnected === null && !permissionError)) {
        return (
            <div className="p-6 max-w-[1600px] mx-auto min-h-screen bg-white flex flex-col items-center justify-center -mt-20">
                <div className="w-16 h-16 border-4 border-slate-100 border-t-blue-500 rounded-full animate-spin mb-6" />
                <h1 className="text-xl font-medium text-slate-600 animate-pulse">Loading Google Ads...</h1>
            </div>
        );
    }

    /* ── Not configured (no developer token yet) ── */
    if (configured === false) {
        return (
            <div className="p-6 max-w-[1600px] mx-auto min-h-screen bg-white flex flex-col items-center justify-center -mt-20">
                <div className="w-20 h-20 bg-blue-50 rounded-full flex items-center justify-center mb-6 shadow-sm border border-blue-100">
                    <MegaphoneIcon className="w-10 h-10 text-blue-400" />
                </div>
                <h1 className="text-2xl font-bold text-slate-800 mb-3 text-center">Google Ads Not Configured</h1>
                <p className="text-slate-500 mb-2 max-w-md text-center leading-relaxed">
                    The Google Ads integration needs a developer token before it can pull live data.
                </p>
                <p className="text-slate-400 text-sm max-w-md text-center">
                    A developer token is issued from a Google Ads Manager (MCC) account and approved by Google.
                    Once it's added to the server configuration, this page will light up automatically.
                </p>
            </div>
        );
    }

    /* ── Not connected / no Ads access ── */
    if (isConnected === false) {
        return (
            <div className="p-6 max-w-[1600px] mx-auto min-h-screen bg-white flex flex-col items-center justify-center -mt-20">
                <div className="w-20 h-20 bg-slate-50 rounded-full flex items-center justify-center mb-6 shadow-sm border border-slate-100">
                    <MegaphoneIcon className="w-10 h-10 text-slate-400" />
                </div>
                <h1 className="text-2xl font-bold text-slate-800 mb-3 text-center">Google Ads Not Connected</h1>
                <p className="text-slate-500 mb-8 max-w-md text-center leading-relaxed">
                    {permissionError
                        ? (permissionDetail || 'Your Google account is connected but has not granted Google Ads access. Reconnect from New Analysis to grant Ads permission.')
                        : 'Connect your Google account (with Ads access) to view campaign impressions, clicks, cost and conversions.'}
                </p>
                <button
                    onClick={() => navigate('/new-analysis')}
                    className="flex items-center gap-2 px-6 py-2.5 bg-blue-50 text-blue-600 rounded-md font-medium hover:bg-blue-100 transition-colors border border-blue-100/50"
                >
                    <PlusIcon className="w-5 h-5" />
                    {permissionError ? 'Reconnect Google' : 'Connect Google Ads'}
                </button>
            </div>
        );
    }

    return (
        <div className="p-3 sm:p-6 max-w-[1600px] mx-auto min-h-screen bg-white">
            {/* ── Header ── */}
            <header className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 mb-6 pb-6 border-b border-slate-100">
                <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-xl bg-blue-50 flex items-center justify-center text-blue-600 flex-shrink-0">
                        <MegaphoneIcon className="w-5 h-5" />
                    </div>
                    <div>
                        <h1 className="text-[20px] font-black text-slate-900 tracking-tight leading-none">
                            Google Ads
                        </h1>
                        <p className="text-[12px] text-slate-400 font-medium mt-1">
                            Paid campaign performance, spend &amp; conversions
                        </p>
                    </div>
                </div>

                <div className="flex flex-wrap items-center gap-3 lg:ml-auto">
                    {/* Account picker */}
                    <div className="relative">
                        <button
                            onClick={() => setIsPickerOpen(o => !o)}
                            className="flex items-center gap-2 px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-[13px] font-bold text-slate-700 hover:bg-slate-100 transition-colors max-w-[280px]"
                        >
                            <span className="truncate">{selectedCustMeta?.display || 'Select account'}</span>
                            <ChevronDownIcon className={`w-4 h-4 text-slate-400 transition-transform ${isPickerOpen ? 'rotate-180' : ''}`} />
                        </button>
                        {isPickerOpen && (() => {
                            const q = custSearch.trim().toLowerCase();
                            const filtered = q
                                ? customers.filter(c =>
                                    (c.display || '').toLowerCase().includes(q) ||
                                    (c.customer_id || '').includes(q))
                                : customers;
                            return (
                                <>
                                    <div className="fixed inset-0 z-40" onClick={() => { setIsPickerOpen(false); setCustSearch(''); }} />
                                    <div className="absolute right-0 top-[calc(100%+6px)] w-[320px] bg-white border border-slate-200 rounded-xl shadow-xl z-50 overflow-hidden">
                                        <div className="p-2 border-b border-slate-100 sticky top-0 bg-white">
                                            <div className="relative">
                                                <MagnifyingGlassIcon className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
                                                <input
                                                    autoFocus
                                                    type="text"
                                                    value={custSearch}
                                                    onChange={e => setCustSearch(e.target.value)}
                                                    placeholder="Search accounts..."
                                                    className="w-full pl-8 pr-3 py-2 text-[13px] bg-slate-50 border border-slate-200 rounded-lg text-slate-700 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                                                />
                                            </div>
                                        </div>
                                        <div className="max-h-[300px] overflow-y-auto p-1.5">
                                            {filtered.length === 0 ? (
                                                <p className="text-[12px] text-slate-400 text-center py-6">No accounts match "{custSearch}"</p>
                                            ) : filtered.map(c => (
                                                <button
                                                    key={c.customer_id}
                                                    onClick={() => { setSelectedCustomer(c.customer_id); setIsPickerOpen(false); setCustSearch(''); }}
                                                    className={`w-full text-left px-3 py-2 rounded-lg transition-colors ${
                                                        c.customer_id === selectedCustomer ? 'bg-blue-50 text-blue-700' : 'hover:bg-slate-50 text-slate-700'
                                                    }`}
                                                >
                                                    <p className="text-[13px] font-semibold truncate">{c.display}</p>
                                                    <p className="text-[11px] text-slate-400 truncate">{c.customer_id}{c.currency ? ` · ${c.currency}` : ''}</p>
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
                                                r.days === days ? 'bg-blue-50 text-blue-700' : 'hover:bg-slate-50 text-slate-700'
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
                        disabled={loading || !selectedCustomer}
                        className="p-2.5 rounded-xl text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition-all disabled:opacity-50"
                        title="Refresh data"
                    >
                        <ArrowPathIcon className={`w-5 h-5 ${loading ? 'animate-spin' : ''}`} />
                    </button>
                </div>
            </header>

            {permissionError ? (
                <div className="bg-amber-50 border border-amber-200 rounded-2xl p-6 text-center">
                    <p className="text-amber-700 font-semibold">No Google Ads access for this account.</p>
                    <p className="text-amber-600 text-sm mt-1">Reconnect your Google account or check that this Ads account is shared with you.</p>
                </div>
            ) : !selectedCustomer ? (
                <div className="bg-slate-50 border border-slate-200 rounded-2xl p-10 text-center">
                    <MegaphoneIcon className="w-10 h-10 text-slate-300 mx-auto mb-3" />
                    <p className="text-slate-700 font-bold">Choose a Google Ads account to begin</p>
                    <p className="text-slate-500 text-sm mt-1 max-w-md mx-auto">
                        Use the account dropdown above (top right) to pick which account's campaigns you want to view.
                    </p>
                </div>
            ) : (
                <>
                    {/* ── Stat cards ── */}
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
                        {statCards.map(card => (
                            <div key={card.id} className="bg-white border border-slate-100 rounded-2xl p-4 shadow-sm">
                                <div className="flex items-center justify-between mb-3">
                                    <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center text-blue-600">
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
                        <h2 className="text-[15px] font-bold text-slate-800 mb-5">Clicks, Cost &amp; Conversions over time</h2>
                        {loading ? (
                            <Shimmer className="w-full h-[320px] rounded-2xl" />
                        ) : (
                            <ResponsiveContainer width="100%" height={320}>
                                <AreaChart data={overview?.chart_data || []} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                                    <defs>
                                        <linearGradient id="adsClicks" x1="0" y1="0" x2="0" y2="1">
                                            <stop offset="5%" stopColor="#2563eb" stopOpacity={0.3} />
                                            <stop offset="95%" stopColor="#2563eb" stopOpacity={0} />
                                        </linearGradient>
                                        <linearGradient id="adsCost" x1="0" y1="0" x2="0" y2="1">
                                            <stop offset="5%" stopColor="#60a5fa" stopOpacity={0.25} />
                                            <stop offset="95%" stopColor="#60a5fa" stopOpacity={0} />
                                        </linearGradient>
                                    </defs>
                                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                                    <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} minTickGap={24} />
                                    <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                                    <Tooltip content={<CustomTooltip />} />
                                    <Area type="monotone" dataKey="clicks" name="Clicks" stroke="#2563eb" strokeWidth={2} fill="url(#adsClicks)" />
                                    <Area type="monotone" dataKey="cost" name="Cost" stroke="#60a5fa" strokeWidth={2} fill="url(#adsCost)" />
                                    <Area type="monotone" dataKey="conversions" name="Conversions" stroke="#9333ea" strokeWidth={2} fillOpacity={0} />
                                </AreaChart>
                            </ResponsiveContainer>
                        )}
                    </div>

                    {/* ── Top campaigns ── */}
                    <div className="bg-white border border-slate-100 rounded-3xl p-6 shadow-sm">
                        <h2 className="text-[15px] font-bold text-slate-800 mb-5">Top campaigns</h2>
                        {loading ? (
                            <div className="space-y-2">{[...Array(5)].map((_, i) => <Shimmer key={i} className="w-full h-10" />)}</div>
                        ) : (overview?.campaigns?.length ? (
                            <div className="overflow-x-auto">
                                <table className="w-full text-left">
                                    <thead>
                                        <tr className="border-b border-slate-100 text-[11px] uppercase tracking-wide text-slate-400 font-bold">
                                            <th className="py-2.5 px-3">Campaign</th>
                                            <th className="py-2.5 px-3 text-right">Impressions</th>
                                            <th className="py-2.5 px-3 text-right">Clicks</th>
                                            <th className="py-2.5 px-3 text-right">Cost</th>
                                            <th className="py-2.5 px-3 text-right">Conversions</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {overview.campaigns.map((c, i) => (
                                            <tr key={i} className="border-b border-slate-50 hover:bg-slate-50/60 transition-colors">
                                                <td className="py-3 px-3 text-[13px] font-semibold text-slate-700">{c.name}</td>
                                                <td className="py-3 px-3 text-right text-[13px] text-slate-600">{fmtNum(c.impressions)}</td>
                                                <td className="py-3 px-3 text-right text-[13px] text-slate-600">{fmtNum(c.clicks)}</td>
                                                <td className="py-3 px-3 text-right text-[13px] text-slate-600">{fmtCost(c.cost, currency)}</td>
                                                <td className="py-3 px-3 text-right text-[13px] text-slate-600">{fmtNum(c.conversions)}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        ) : (
                            <p className="text-slate-400 text-sm text-center py-8">No campaign data for this period.</p>
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

export default GoogleAdsAnalytics;

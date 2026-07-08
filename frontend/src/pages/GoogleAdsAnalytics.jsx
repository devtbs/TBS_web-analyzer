import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { usePagination } from '../hooks/usePagination';
import Pagination from '../components/ui/Pagination';
import {
    AreaChart, Area, BarChart, Bar, ComposedChart, Line,
    XAxis, YAxis, CartesianGrid, Tooltip, Legend,
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
    TableCellsIcon,
    GlobeAltIcon,
    DevicePhoneMobileIcon,
    UserGroupIcon,
    MapPinIcon,
    ClockIcon,
    SparklesIcon,
} from '@heroicons/react/24/outline';
import { ArrowTrendingUpIcon, ArrowTrendingDownIcon } from '@heroicons/react/24/solid';
import api from '../api/axios';
import toast from 'react-hot-toast';
import { useAuth } from '../context/AuthContext';

/* Flatten the grouped /all response into a single list, tagging each item with
   the Google account it belongs to. */
const flattenGroups = (groups, key) =>
    (groups || []).flatMap(g =>
        (g[key] || []).map(item => ({ ...item, account_id: g.account_id, google_email: g.google_email }))
    );

/* ── Date-range presets ─────────────────────────────────────── */
const RANGE_OPTIONS = [
    { label: 'Last 7 days', days: 7 },
    { label: 'Last 28 days', days: 28 },
    { label: 'Last 90 days', days: 90 },
    { label: 'Last 6 months', days: 180 },
    { label: 'Last 12 months', days: 365 },
];

/* ── Formatters ─────────────────────────────────────────────── */
const fmtNum = (v) => (v != null ? Number(v).toLocaleString(undefined, { maximumFractionDigits: 0 }) : '-');
const fmtCost = (v, currency) => {
    if (v == null) return '-';
    const num = Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return currency ? `${num} ${currency}` : num;
};
const fmtPct = (v) => (v != null ? `${Number(v).toFixed(2)}%` : '-');
const fmtRoas = (v) => (v != null && v !== 0 ? `${Number(v).toFixed(2)}x` : '-');

/* ── Delta badge ─────────────────────────────────────────────── */
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

/* ── Custom chart tooltip ────────────────────────────────────── */
const CustomTooltip = ({ active, payload, label, currency }) => {
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

/* ── Shimmer skeleton ────────────────────────────────────────── */
const Shimmer = ({ className = '' }) => <div className={`bg-slate-100 rounded-lg animate-pulse ${className}`} />;

/* ── Section heading ─────────────────────────────────────────── */
const SectionHeading = ({ icon: Icon, title, subtitle }) => (
    <div className="flex items-center gap-3 mb-5">
        <div className="w-9 h-9 rounded-xl bg-blue-50 flex items-center justify-center text-blue-600 flex-shrink-0">
            <Icon className="w-5 h-5" />
        </div>
        <div>
            <h2 className="text-[15px] font-bold text-slate-800 leading-none">{title}</h2>
            {subtitle && <p className="text-[12px] text-slate-400 mt-0.5">{subtitle}</p>}
        </div>
    </div>
);

/* ── Status badge ────────────────────────────────────────────── */
const StatusDot = ({ status }) => {
    const enabled = (status || '').toUpperCase() === 'ENABLED';
    return (
        <span className="inline-flex items-center gap-1.5">
            <span className={`w-2 h-2 rounded-full ${enabled ? 'bg-emerald-400' : 'bg-slate-300'}`} />
            <span className={`text-[11px] font-semibold ${enabled ? 'text-emerald-600' : 'text-slate-400'}`}>
                {enabled ? 'Active' : 'Paused'}
            </span>
        </span>
    );
};

/* ── Table wrapper ───────────────────────────────────────────── */
const DataTable = ({ headers, children, empty = 'No data for this period.' }) => (
    <div className="overflow-x-auto">
        <table className="w-full text-left">
            <thead>
                <tr className="border-b border-slate-100 text-[11px] uppercase tracking-wide text-slate-400 font-bold">
                    {headers.map((h, i) => (
                        <th key={i} className={`py-2.5 px-3 ${i > 0 ? 'text-right' : ''}`}>{h}</th>
                    ))}
                </tr>
            </thead>
            <tbody>{children}</tbody>
        </table>
        {!children?.length && (
            <p className="text-slate-400 text-sm text-center py-8">{empty}</p>
        )}
    </div>
);

/* ── Heatmap cell ────────────────────────────────────────────── */
const HeatCell = ({ value, max, label }) => {
    const intensity = max > 0 ? value / max : 0;
    const bg = `rgba(37,99,235,${(intensity * 0.7 + 0.05).toFixed(2)})`;
    return (
        <div
            className="flex flex-col items-center justify-center rounded-lg p-2 min-h-[52px] text-center"
            style={{ backgroundColor: bg }}
        >
            <span className="text-[10px] font-bold text-white/80 truncate w-full text-center">{label}</span>
            <span className="text-[12px] font-black text-white mt-0.5">{fmtNum(value)}</span>
        </div>
    );
};

/* ── Main component ──────────────────────────────────────────── */
const GoogleAdsAnalytics = () => {
    const navigate = useNavigate();
    const { switchAccount } = useAuth();
    const [configured, setConfigured] = useState(null);
    const [isConnected, setIsConnected] = useState(null);
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
    const [deepDive, setDeepDive] = useState(null);
    const [deepDiveLoading, setDeepDiveLoading] = useState(false);
    const [deepDiveLoaded, setDeepDiveLoaded] = useState(false);

    const campPag = usePagination(overview?.campaigns, 10);
    const kwPag = usePagination(deepDive?.keywords, 10);
    const stPag = usePagination(deepDive?.search_terms, 10);
    const geoPag = usePagination(deepDive?.geo, 10);

    useEffect(() => {
        const init = async () => {
            if (!localStorage.getItem('access_token')) {
                setConfigured(true);
                setIsConnected(false);
                return;
            }
            try {
                const statusRes = await api.get('/auth/ads/status');
                if (!statusRes.data.configured) { setConfigured(false); return; }
                setConfigured(true);
            } catch (_) {
                setConfigured(true);
            }
            try {
                // Aggregate Ads customers across ALL connected Google accounts.
                const res = await api.get('/auth/ads/customers/all');
                if (res.data.configured === false) { setConfigured(false); return; }
                const list = flattenGroups(res.data.groups, 'customers');
                setCustomers(list);
                setIsConnected(list.length > 0);
                const saved = localStorage.getItem('google_ads_selected_customer');
                const savedCust = saved && list.find(c => c.customer_id === saved);
                if (savedCust) {
                    setSelectedCustomer(saved);
                    switchAccount(savedCust.account_id);  // point the API at the right account
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

    useEffect(() => {
        if (selectedCustomer) localStorage.setItem('google_ads_selected_customer', selectedCustomer);
    }, [selectedCustomer]);

    useEffect(() => {
        if (!selectedCustomer) return;
        setOverview(null);
        setDeepDive(null);
        setDeepDiveLoaded(false);
        setLoading(true);
        setPermissionError(false);
        const fetch = async () => {
            try {
                const res = await api.get(`/auth/ads/overview/${selectedCustomer}`, { params: { days } });
                if (res.data.configured === false) { setConfigured(false); return; }
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
        fetch();
    }, [selectedCustomer, days]);

    const handleRefresh = async () => {
        try { await api.post('/auth/ads/cache/invalidate'); } catch (_) {}
        setOverview(null);
        setDeepDive(null);
        setDeepDiveLoaded(false);
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

    const loadDeepDive = async () => {
        if (deepDiveLoaded || deepDiveLoading) return;
        setDeepDiveLoading(true);
        try {
            const res = await api.get(`/auth/ads/deep-dive/${selectedCustomer}`, { params: { days } });
            setDeepDive(res.data);
            setDeepDiveLoaded(true);
        } catch (err) {
            toast.error(err.response?.data?.detail || 'Failed to load deep-dive data');
        } finally {
            setDeepDiveLoading(false);
        }
    };

    const selectedCustMeta = useMemo(
        () => customers.find(c => c.customer_id === selectedCustomer),
        [customers, selectedCustomer]
    );

    const totals = overview?.totals;
    const deltas = overview?.deltas;
    const currency = overview?.currency || selectedCustMeta?.currency || '';

    // ROAS hardcoded as conversions_value / cost
    const roas = totals?.cost > 0 ? (totals.conversions_value / totals.cost) : 0;
    const roasDelta = deltas?.roas ?? null;

    const statCards = [
        { id: 'cost',        label: 'Cost',         value: fmtCost(totals?.cost, currency),             delta: deltas?.cost,            good: false, icon: <CurrencyDollarIcon className="w-5 h-5" /> },
        { id: 'impressions', label: 'Impressions',   value: fmtNum(totals?.impressions),                 delta: deltas?.impressions,     good: true,  icon: <EyeIcon className="w-5 h-5" /> },
        { id: 'clicks',      label: 'Clicks',        value: fmtNum(totals?.clicks),                      delta: deltas?.clicks,          good: true,  icon: <CursorArrowRaysIcon className="w-5 h-5" /> },
        { id: 'ctr',         label: 'CTR',           value: totals ? fmtPct(totals.ctr) : '-',           delta: deltas?.ctr,             good: true,  icon: <ChartBarIcon className="w-5 h-5" /> },
        { id: 'conversions', label: 'Conversions',   value: fmtNum(totals?.conversions),                 delta: deltas?.conversions,     good: true,  icon: <ArrowTrendingUpIcon className="w-5 h-5" /> },
        { id: 'cvr',         label: 'Conv. Rate',    value: totals ? fmtPct(totals.conversion_rate) : '-', delta: deltas?.conversion_rate, good: true, icon: <ChartBarIcon className="w-5 h-5" /> },
        { id: 'roas',        label: 'ROAS',          value: totals ? fmtRoas(roas) : '-',                delta: roasDelta,               good: true,  icon: <SparklesIcon className="w-5 h-5" /> },
    ];

    /* ── Loading / error states ── */
    if (configured === null || (configured && isConnected === null && !permissionError)) {
        return (
            <div className="p-6 max-w-[1600px] mx-auto min-h-screen bg-white flex flex-col items-center justify-center -mt-20">
                <div className="w-16 h-16 border-4 border-slate-100 border-t-blue-500 rounded-full animate-spin mb-6" />
                <h1 className="text-xl font-medium text-slate-600 animate-pulse">Loading Google Ads...</h1>
            </div>
        );
    }
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
    if (isConnected === false) {
        return (
            <div className="p-6 max-w-[1600px] mx-auto min-h-screen bg-white flex flex-col items-center justify-center -mt-20">
                <div className="w-20 h-20 bg-slate-50 rounded-full flex items-center justify-center mb-6 shadow-sm border border-slate-100">
                    <MegaphoneIcon className="w-10 h-10 text-slate-400" />
                </div>
                <h1 className="text-2xl font-bold text-slate-800 mb-3 text-center">Google Ads Not Connected</h1>
                <p className="text-slate-500 mb-8 max-w-md text-center leading-relaxed">
                    {permissionError
                        ? (permissionDetail || 'Your Google account is connected but has not granted Google Ads access.')
                        : 'Connect your Google account (with Ads access) to view campaign performance data.'}
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

            {/* ══ HEADER ══════════════════════════════════════════ */}
            <header className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 mb-6 pb-6 border-b border-slate-100">
                <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-xl bg-blue-50 flex items-center justify-center text-blue-600 flex-shrink-0">
                        <MegaphoneIcon className="w-5 h-5" />
                    </div>
                    <div>
                        <h1 className="text-[20px] font-black text-slate-900 tracking-tight leading-none">Google Ads</h1>
                        <p className="text-[12px] text-slate-400 font-medium mt-1">Paid campaign performance, spend &amp; conversions</p>
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
                            <ChevronDownIcon className={`w-4 h-4 text-slate-400 flex-shrink-0 transition-transform ${isPickerOpen ? 'rotate-180' : ''}`} />
                        </button>
                        {isPickerOpen && (() => {
                            const q = custSearch.trim().toLowerCase();
                            const filtered = q
                                ? customers.filter(c => (c.display || '').toLowerCase().includes(q) || (c.customer_id || '').includes(q))
                                : customers;
                            return (
                                <>
                                    <div className="fixed inset-0 z-40" onClick={() => { setIsPickerOpen(false); setCustSearch(''); }} />
                                    <div className="absolute right-0 top-[calc(100%+6px)] w-[320px] bg-white border border-slate-200 rounded-xl shadow-xl z-50 overflow-hidden">
                                        <div className="p-2 border-b border-slate-100 sticky top-0 bg-white">
                                            <div className="relative">
                                                <MagnifyingGlassIcon className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
                                                <input
                                                    autoFocus type="text" value={custSearch}
                                                    onChange={e => setCustSearch(e.target.value)}
                                                    placeholder="Search accounts..."
                                                    className="w-full pl-8 pr-3 py-2 text-[13px] bg-slate-50 border border-slate-200 rounded-lg text-slate-700 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                                                />
                                            </div>
                                        </div>
                                        <div className="max-h-[300px] overflow-y-auto p-1.5">
                                            {filtered.length === 0 ? (
                                                <p className="text-[12px] text-slate-400 text-center py-6">No accounts match "{custSearch}"</p>
                                            ) : Object.entries(
                                                filtered.reduce((acc, c) => {
                                                    (acc[c.google_email] ||= []).push(c);
                                                    return acc;
                                                }, {})
                                            ).map(([email, items]) => (
                                                <div key={email} className="mb-1">
                                                    <p className="px-3 pt-2 pb-1 text-[10px] font-bold uppercase tracking-wide text-slate-400 truncate">{email}</p>
                                                    {items.map(c => (
                                                        <button
                                                            key={c.customer_id}
                                                            onClick={() => { switchAccount(c.account_id); setSelectedCustomer(c.customer_id); setIsPickerOpen(false); setCustSearch(''); }}
                                                            className={`w-full text-left px-3 py-2 rounded-lg transition-colors ${c.customer_id === selectedCustomer ? 'bg-blue-50 text-blue-700' : 'hover:bg-slate-50 text-slate-700'}`}
                                                        >
                                                            <p className="text-[13px] font-semibold truncate">{c.display}</p>
                                                            <p className="text-[11px] text-slate-400 truncate">{c.customer_id}{c.currency ? ` · ${c.currency}` : ''}</p>
                                                        </button>
                                                    ))}
                                                </div>
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
                                            className={`w-full text-left px-3 py-2 rounded-lg text-[13px] font-semibold transition-colors ${r.days === days ? 'bg-blue-50 text-blue-700' : 'hover:bg-slate-50 text-slate-700'}`}
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
                    <p className="text-slate-500 text-sm mt-1 max-w-md mx-auto">Use the account dropdown above to pick which account's campaigns you want to view.</p>
                </div>
            ) : (
                <>
                    {/* ══ FOLD 1 — OVERVIEW ═══════════════════════════════ */}

                    {/* Scorecards: Cost · Impressions · Clicks · CTR · Conversions · CVR · ROAS */}
                    <div className="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-7 gap-3 mb-8">
                        {statCards.map(card => (
                            <div key={card.id} className="bg-white border border-slate-100 rounded-2xl p-4 shadow-sm">
                                <div className="flex items-center justify-between mb-3">
                                    <div className="w-9 h-9 rounded-xl bg-blue-50 flex items-center justify-center text-blue-600">
                                        {card.icon}
                                    </div>
                                    {!loading && <DeltaBadge delta={card.delta} isPositiveGood={card.good} />}
                                </div>
                                {loading
                                    ? <Shimmer className="w-20 h-7 mb-1" />
                                    : <p className="text-[22px] font-black text-slate-900 leading-none">{card.value}</p>
                                }
                                <p className="text-[11px] font-semibold text-slate-400 mt-1.5">{card.label}</p>
                            </div>
                        ))}
                    </div>

                    {/* Dual trend charts */}
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
                        {/* Clicks vs Impressions */}
                        <div className="bg-white border border-slate-100 rounded-3xl p-6 shadow-sm">
                            <h2 className="text-[14px] font-bold text-slate-800 mb-1">Clicks vs Impressions</h2>
                            <p className="text-[11px] text-slate-400 mb-4">Volume trend over selected period</p>
                            {loading ? (
                                <Shimmer className="w-full h-[240px] rounded-2xl" />
                            ) : (
                                <ResponsiveContainer width="100%" height={240}>
                                    <ComposedChart data={overview?.chart_data || []} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                                        <defs>
                                            <linearGradient id="gClicks" x1="0" y1="0" x2="0" y2="1">
                                                <stop offset="5%" stopColor="#2563eb" stopOpacity={0.25} />
                                                <stop offset="95%" stopColor="#2563eb" stopOpacity={0} />
                                            </linearGradient>
                                        </defs>
                                        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                                        <XAxis dataKey="name" tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} minTickGap={24} />
                                        <YAxis yAxisId="left" tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                                        <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                                        <Tooltip content={<CustomTooltip />} />
                                        <Legend wrapperStyle={{ fontSize: 11, paddingTop: 8 }} />
                                        <Area yAxisId="left" type="monotone" dataKey="clicks" name="Clicks" stroke="#2563eb" strokeWidth={2} fill="url(#gClicks)" />
                                        <Line yAxisId="right" type="monotone" dataKey="impressions" name="Impressions" stroke="#f59e0b" strokeWidth={2} dot={false} />
                                    </ComposedChart>
                                </ResponsiveContainer>
                            )}
                        </div>

                        {/* Cost vs Conversions */}
                        <div className="bg-white border border-slate-100 rounded-3xl p-6 shadow-sm">
                            <h2 className="text-[14px] font-bold text-slate-800 mb-1">Cost vs Conversions</h2>
                            <p className="text-[11px] text-slate-400 mb-4">Spend efficiency over selected period</p>
                            {loading ? (
                                <Shimmer className="w-full h-[240px] rounded-2xl" />
                            ) : (
                                <ResponsiveContainer width="100%" height={240}>
                                    <ComposedChart data={overview?.chart_data || []} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                                        <defs>
                                            <linearGradient id="gCost" x1="0" y1="0" x2="0" y2="1">
                                                <stop offset="5%" stopColor="#60a5fa" stopOpacity={0.25} />
                                                <stop offset="95%" stopColor="#60a5fa" stopOpacity={0} />
                                            </linearGradient>
                                        </defs>
                                        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                                        <XAxis dataKey="name" tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} minTickGap={24} />
                                        <YAxis yAxisId="left" tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                                        <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                                        <Tooltip content={<CustomTooltip />} />
                                        <Legend wrapperStyle={{ fontSize: 11, paddingTop: 8 }} />
                                        <Area yAxisId="left" type="monotone" dataKey="cost" name="Cost" stroke="#60a5fa" strokeWidth={2} fill="url(#gCost)" />
                                        <Line yAxisId="right" type="monotone" dataKey="conversions" name="Conversions" stroke="#9333ea" strokeWidth={2} dot={false} />
                                    </ComposedChart>
                                </ResponsiveContainer>
                            )}
                        </div>
                    </div>

                    {/* Campaign performance table */}
                    <div className="bg-white border border-slate-100 rounded-3xl p-6 shadow-sm mb-10">
                        <SectionHeading icon={TableCellsIcon} title="Ad Campaign Performance" subtitle="Top campaigns by spend — active period" />
                        {loading ? (
                            <div className="space-y-2">{[...Array(5)].map((_, i) => <Shimmer key={i} className="w-full h-10" />)}</div>
                        ) : (overview?.campaigns?.length ? (
                            <>
                                <DataTable headers={['Campaign', 'Status', 'Impressions', 'Clicks', 'CTR', 'Cost', 'Conversions', 'ROAS']}>
                                    {campPag.pageItems.map((c, i) => {
                                        const campRoas = c.cost > 0 ? (c.conversions_value / c.cost) : 0;
                                        return (
                                            <tr key={i} className="border-b border-slate-50 hover:bg-slate-50/60 transition-colors">
                                                <td className="py-3 px-3 text-[13px] font-semibold text-slate-700 max-w-[240px]">
                                                    <span className="truncate block">{c.name}</span>
                                                </td>
                                                <td className="py-3 px-3"><StatusDot status={c.status} /></td>
                                                <td className="py-3 px-3 text-right text-[13px] text-slate-600">{fmtNum(c.impressions)}</td>
                                                <td className="py-3 px-3 text-right text-[13px] text-slate-600">{fmtNum(c.clicks)}</td>
                                                <td className="py-3 px-3 text-right text-[13px] text-slate-600">{fmtPct(c.ctr)}</td>
                                                <td className="py-3 px-3 text-right text-[13px] text-slate-600">{fmtCost(c.cost, currency)}</td>
                                                <td className="py-3 px-3 text-right text-[13px] text-slate-600">{fmtNum(c.conversions)}</td>
                                                <td className="py-3 px-3 text-right text-[13px] font-bold text-blue-600">{fmtRoas(campRoas)}</td>
                                            </tr>
                                        );
                                    })}
                                </DataTable>
                                <Pagination {...campPag} onPageChange={campPag.setPage} className="rounded-b-3xl" />
                            </>
                        ) : (
                            <p className="text-slate-400 text-sm text-center py-8">No campaign data for this period.</p>
                        ))}
                    </div>

                    {overview?.period && (
                        <p className="text-[11px] text-slate-400 text-center mb-6">
                            Data range: {overview.period.start} → {overview.period.end}
                        </p>
                    )}

                    {/* ══ FOLD 2 ENTRY POINT ══════════════════════════════ */}
                    {!deepDiveLoaded && (
                        <div className="border-t border-slate-100 pt-8 mb-8 text-center">
                            <p className="text-[13px] text-slate-500 mb-4">Keyword analysis, device splits, demographics, geo &amp; scheduling data</p>
                            <button
                                onClick={loadDeepDive}
                                disabled={deepDiveLoading}
                                className="inline-flex items-center gap-2 px-6 py-2.5 bg-blue-600 text-white rounded-xl text-[13px] font-bold hover:bg-blue-700 transition-colors disabled:opacity-60"
                            >
                                {deepDiveLoading ? (
                                    <ArrowPathIcon className="w-4 h-4 animate-spin" />
                                ) : (
                                    <ChartBarIcon className="w-4 h-4" />
                                )}
                                {deepDiveLoading ? 'Loading deep dive…' : 'Load Deep Dive Analytics'}
                            </button>
                        </div>
                    )}

                    {/* ══ FOLD 2 — DEEP DIVE ══════════════════════════════ */}
                    {deepDiveLoading && !deepDive && (
                        <div className="space-y-6">
                            {[...Array(4)].map((_, i) => (
                                <div key={i} className="bg-white border border-slate-100 rounded-3xl p-6 shadow-sm">
                                    <Shimmer className="w-48 h-5 mb-5" />
                                    <div className="space-y-2">{[...Array(5)].map((_, j) => <Shimmer key={j} className="w-full h-9" />)}</div>
                                </div>
                            ))}
                        </div>
                    )}

                    {deepDive && (
                        <div className="space-y-8 border-t border-slate-100 pt-8">
                            <h2 className="text-[18px] font-black text-slate-900 tracking-tight">Deep Dive Analytics</h2>

                            {/* 1. Keywords */}
                            <div className="bg-white border border-slate-100 rounded-3xl p-6 shadow-sm">
                                <SectionHeading icon={MagnifyingGlassIcon} title="Keyword Performance" subtitle="Top keywords by conversions" />
                                <DataTable headers={['Keyword', 'Match Type', 'Clicks', 'Cost', 'Conversions', 'ROAS']}>
                                    {kwPag.pageItems.map((kw, i) => (
                                        <tr key={i} className="border-b border-slate-50 hover:bg-slate-50/60 transition-colors">
                                            <td className="py-2.5 px-3 text-[13px] font-semibold text-slate-700">{kw.keyword}</td>
                                            <td className="py-2.5 px-3 text-[12px] text-slate-500">{(kw.match_type || '').replace('_', ' ')}</td>
                                            <td className="py-2.5 px-3 text-right text-[13px] text-slate-600">{fmtNum(kw.clicks)}</td>
                                            <td className="py-2.5 px-3 text-right text-[13px] text-slate-600">{fmtCost(kw.cost, currency)}</td>
                                            <td className="py-2.5 px-3 text-right text-[13px] text-slate-600">{fmtNum(kw.conversions)}</td>
                                            <td className="py-2.5 px-3 text-right text-[13px] font-bold text-blue-600">{fmtRoas(kw.roas)}</td>
                                        </tr>
                                    ))}
                                </DataTable>
                                <Pagination {...kwPag} onPageChange={kwPag.setPage} className="rounded-b-3xl" />
                            </div>

                            {/* 2. Search Terms */}
                            <div className="bg-white border border-slate-100 rounded-3xl p-6 shadow-sm">
                                <SectionHeading icon={MagnifyingGlassIcon} title="Search Terms Report" subtitle="Top user queries by clicks" />
                                <DataTable headers={['Search Term', 'Impressions', 'Clicks', 'CTR', 'Cost', 'Conversions']}>
                                    {stPag.pageItems.map((st, i) => (
                                        <tr key={i} className="border-b border-slate-50 hover:bg-slate-50/60 transition-colors">
                                            <td className="py-2.5 px-3 text-[13px] font-semibold text-slate-700">{st.term}</td>
                                            <td className="py-2.5 px-3 text-right text-[13px] text-slate-600">{fmtNum(st.impressions)}</td>
                                            <td className="py-2.5 px-3 text-right text-[13px] text-slate-600">{fmtNum(st.clicks)}</td>
                                            <td className="py-2.5 px-3 text-right text-[13px] text-slate-600">{fmtPct(st.ctr)}</td>
                                            <td className="py-2.5 px-3 text-right text-[13px] text-slate-600">{fmtCost(st.cost, currency)}</td>
                                            <td className="py-2.5 px-3 text-right text-[13px] text-slate-600">{fmtNum(st.conversions)}</td>
                                        </tr>
                                    ))}
                                </DataTable>
                                <Pagination {...stPag} onPageChange={stPag.setPage} className="rounded-b-3xl" />
                            </div>

                            {/* 3. Network & Device */}
                            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                                <div className="bg-white border border-slate-100 rounded-3xl p-6 shadow-sm">
                                    <SectionHeading icon={GlobeAltIcon} title="Network Split" subtitle="Clicks by ad network type" />
                                    <ResponsiveContainer width="100%" height={200}>
                                        <BarChart data={deepDive.networks || []} layout="vertical" margin={{ top: 0, right: 20, left: 40, bottom: 0 }}>
                                            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
                                            <XAxis type="number" tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                                            <YAxis type="category" dataKey="network" tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} width={80} />
                                            <Tooltip formatter={(v) => fmtNum(v)} />
                                            <Bar dataKey="clicks" name="Clicks" fill="#2563eb" radius={[0, 4, 4, 0]} />
                                        </BarChart>
                                    </ResponsiveContainer>
                                </div>
                                <div className="bg-white border border-slate-100 rounded-3xl p-6 shadow-sm">
                                    <SectionHeading icon={DevicePhoneMobileIcon} title="Device Split" subtitle="Clicks by device type" />
                                    <ResponsiveContainer width="100%" height={200}>
                                        <BarChart data={deepDive.devices || []} layout="vertical" margin={{ top: 0, right: 20, left: 40, bottom: 0 }}>
                                            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
                                            <XAxis type="number" tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                                            <YAxis type="category" dataKey="device" tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} width={80} />
                                            <Tooltip formatter={(v) => fmtNum(v)} />
                                            <Bar dataKey="clicks" name="Clicks" fill="#9333ea" radius={[0, 4, 4, 0]} />
                                        </BarChart>
                                    </ResponsiveContainer>
                                </div>
                            </div>

                            {/* 4. Demographics */}
                            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                                <div className="bg-white border border-slate-100 rounded-3xl p-6 shadow-sm">
                                    <SectionHeading icon={UserGroupIcon} title="Age Range" subtitle="Clicks by age group" />
                                    <ResponsiveContainer width="100%" height={220}>
                                        <BarChart data={deepDive.age_ranges || []} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                                            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                                            <XAxis dataKey="age_range" tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false}
                                                tickFormatter={v => (v || '').replace('AGE_RANGE_', '').replace('_', '-')} />
                                            <YAxis tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                                            <Tooltip formatter={(v) => fmtNum(v)} />
                                            <Bar dataKey="clicks" name="Clicks" fill="#f59e0b" radius={[4, 4, 0, 0]} />
                                        </BarChart>
                                    </ResponsiveContainer>
                                </div>
                                <div className="bg-white border border-slate-100 rounded-3xl p-6 shadow-sm">
                                    <SectionHeading icon={UserGroupIcon} title="Gender" subtitle="Clicks by gender" />
                                    <ResponsiveContainer width="100%" height={220}>
                                        <BarChart data={deepDive.genders || []} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                                            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                                            <XAxis dataKey="gender" tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false}
                                                tickFormatter={v => (v || '').replace('GENDER_', '')} />
                                            <YAxis tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                                            <Tooltip formatter={(v) => fmtNum(v)} />
                                            <Bar dataKey="clicks" name="Clicks" fill="#10b981" radius={[4, 4, 0, 0]} />
                                        </BarChart>
                                    </ResponsiveContainer>
                                </div>
                            </div>

                            {/* 5. Geographic */}
                            <div className="bg-white border border-slate-100 rounded-3xl p-6 shadow-sm">
                                <SectionHeading icon={MapPinIcon} title="Geographic Performance" subtitle="Top locations by cost" />
                                <DataTable headers={['Location ID', 'Type', 'Impressions', 'Clicks', 'CTR', 'Cost', 'Conversions']}>
                                    {geoPag.pageItems.map((g, i) => (
                                        <tr key={i} className="border-b border-slate-50 hover:bg-slate-50/60 transition-colors">
                                            <td className="py-2.5 px-3 text-[13px] font-semibold text-slate-700">{g.country_criterion_id}</td>
                                            <td className="py-2.5 px-3 text-[12px] text-slate-500">{(g.location_type || '').replace('_', ' ')}</td>
                                            <td className="py-2.5 px-3 text-right text-[13px] text-slate-600">{fmtNum(g.impressions)}</td>
                                            <td className="py-2.5 px-3 text-right text-[13px] text-slate-600">{fmtNum(g.clicks)}</td>
                                            <td className="py-2.5 px-3 text-right text-[13px] text-slate-600">{fmtPct(g.ctr)}</td>
                                            <td className="py-2.5 px-3 text-right text-[13px] text-slate-600">{fmtCost(g.cost, currency)}</td>
                                            <td className="py-2.5 px-3 text-right text-[13px] text-slate-600">{fmtNum(g.conversions)}</td>
                                        </tr>
                                    ))}
                                </DataTable>
                                <Pagination {...geoPag} onPageChange={geoPag.setPage} className="rounded-b-3xl" />
                            </div>

                            {/* 6. Day-of-Week heatmap */}
                            <div className="bg-white border border-slate-100 rounded-3xl p-6 shadow-sm">
                                <SectionHeading icon={ClockIcon} title="Day of Week" subtitle="Clicks intensity by day" />
                                {(() => {
                                    const data = deepDive.by_day_of_week || [];
                                    const maxClicks = Math.max(...data.map(d => d.clicks), 1);
                                    const DOW_LABELS = { MONDAY: 'Mon', TUESDAY: 'Tue', WEDNESDAY: 'Wed', THURSDAY: 'Thu', FRIDAY: 'Fri', SATURDAY: 'Sat', SUNDAY: 'Sun' };
                                    return (
                                        <div className="grid grid-cols-7 gap-2">
                                            {data.map((d, i) => (
                                                <HeatCell key={i} value={d.clicks} max={maxClicks} label={DOW_LABELS[d.day] || d.day} />
                                            ))}
                                        </div>
                                    );
                                })()}
                            </div>

                            {/* 7. Hour-of-Day */}
                            <div className="bg-white border border-slate-100 rounded-3xl p-6 shadow-sm">
                                <SectionHeading icon={ClockIcon} title="Hour of Day" subtitle="Click distribution across 24 hours" />
                                <ResponsiveContainer width="100%" height={200}>
                                    <BarChart data={deepDive.by_hour || []} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                                        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                                        <XAxis dataKey="hour" tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false}
                                            tickFormatter={h => `${h}:00`} interval={3} />
                                        <YAxis tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                                        <Tooltip formatter={(v) => fmtNum(v)} labelFormatter={h => `${h}:00 – ${h}:59`} />
                                        <Bar dataKey="clicks" name="Clicks" fill="#2563eb" radius={[3, 3, 0, 0]} />
                                    </BarChart>
                                </ResponsiveContainer>
                            </div>
                        </div>
                    )}
                </>
            )}
        </div>
    );
};

export default GoogleAdsAnalytics;

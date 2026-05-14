import { useState, useEffect, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
    ArrowLeftIcon,
    CalendarDaysIcon,
    ChevronDownIcon,
    ArrowUpIcon,
    ArrowDownIcon,
    ArrowPathIcon,
    ArrowDownTrayIcon,
    PlusIcon,
    XMarkIcon,
} from '@heroicons/react/24/outline';
import {
    ArrowTrendingUpIcon,
    ArrowTrendingDownIcon,
} from '@heroicons/react/24/solid';
import api from '../api/axios';
import toast from 'react-hot-toast';

/* ── sessionStorage cache (15-min TTL) ───────────────────── */
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

/* ── Helpers ─────────────────────────────────────────────── */
const presetToDays = (preset) => {
    switch (preset) {
        case 'Last 7 days':  return 7;
        case 'Last 14 days': return 14;
        case 'Last 28 days': return 28;
        case 'Last 3 months': return 90;
        case 'Last 6 months': return 180;
        default: return 28;
    }
};

const fmt = (dateStr) => {
    if (!dateStr) return '';
    const d = new Date(dateStr + 'T00:00:00');
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
};

const shortenUrl = (url) => {
    const stripped = url.replace(/^https?:\/\/(www\.)?/, '');
    if (/^[^/]+\/?$/.test(stripped)) return stripped.replace(/\/?$/, '/');
    return stripped.replace(/\/$/, '');
};

/* ── Skeleton components ─────────────────────────────────── */
const KpiSkeleton = () => (
    <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm flex-1 min-w-[140px]">
        <div className="flex items-center gap-2 mb-3">
            <div className="w-4 h-4 bg-slate-100 rounded animate-pulse" />
            <div className="h-3 w-20 bg-slate-100 rounded animate-pulse" />
        </div>
        <div className="h-8 w-12 bg-slate-100 rounded animate-pulse" />
    </div>
);

const SkeletonRow = ({ i }) => (
    <tr className="border-b border-slate-50">
        <td className="py-3.5 px-5">
            <div className="flex items-center gap-2">
                <div className="w-3.5 h-3.5 bg-slate-100 rounded animate-pulse" style={{ animationDelay: `${i * 35}ms` }} />
                <div className="h-3 bg-slate-100 rounded animate-pulse" style={{ width: `${140 + (i % 5) * 30}px`, animationDelay: `${i * 35}ms` }} />
            </div>
        </td>
        <td className="py-3.5 px-5">
            <div className="h-3 w-10 bg-slate-100 rounded animate-pulse ml-auto" style={{ animationDelay: `${i * 35 + 15}ms` }} />
        </td>
        <td className="py-3.5 px-5">
            <div className="h-3 w-14 bg-slate-100 rounded animate-pulse ml-auto" style={{ animationDelay: `${i * 35 + 30}ms` }} />
        </td>
        <td className="py-3.5 px-5">
            <div className="h-3 w-10 bg-slate-100 rounded animate-pulse ml-auto" style={{ animationDelay: `${i * 35 + 45}ms` }} />
        </td>
    </tr>
);

/* ── Sort Icon ───────────────────────────────────────────── */
const SortIcon = ({ field, sortField, sortDir }) => {
    if (sortField !== field) return <ChevronDownIcon className="w-3.5 h-3.5 text-slate-300 inline ml-0.5" />;
    return sortDir === 'asc'
        ? <ArrowUpIcon className="w-3.5 h-3.5 text-emerald-500 inline ml-0.5" />
        : <ArrowDownIcon className="w-3.5 h-3.5 text-emerald-500 inline ml-0.5" />;
};

/* ── KPI Card ────────────────────────────────────────────── */
const KpiCard = ({ label, count, isNew, icon: Icon }) => (
    <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm flex-1 min-w-[140px]">
        <div className="flex items-center gap-1.5 mb-3">
            <Icon className={`w-4 h-4 ${isNew ? 'text-emerald-500' : 'text-rose-400'}`} />
            <span className="text-[12px] font-semibold text-slate-500">{label}</span>
        </div>
        <div className="text-[32px] font-black leading-none text-slate-900">{count}</div>
    </div>
);

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

/* ── Main Page ───────────────────────────────────────────── */
export default function NewLostRankingsPage() {
    const navigate = useNavigate();

    const [selectedProperty, setSelectedProperty] = useState(localStorage.getItem('gsc_selected_property') || '');

    useEffect(() => {
        const handlePropChange = () => {
            setSelectedProperty(localStorage.getItem('gsc_selected_property') || '');
            setLoading(true);
            setData(null);
        };
        window.addEventListener('gsc_property_changed', handlePropChange);
        return () => window.removeEventListener('gsc_property_changed', handlePropChange);
    }, []);

    // Data
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);       // skeleton on first load
    const [isUpdating, setIsUpdating] = useState(false); // fade on date change

    // Date
    const [selectedPreset, setSelectedPreset] = useState('Last 28 days');
    const [days, setDays] = useState(28);
    const [isDatePickerOpen, setIsDatePickerOpen] = useState(false);

    // Tabs
    const [statusTab, setStatusTab] = useState('New');   // 'New' | 'Lost'
    const [typeTab, setTypeTab] = useState('Queries');   // 'Queries' | 'Pages'

    // Sort
    const [sortField, setSortField] = useState('clicks');
    const [sortDir, setSortDir] = useState('desc');

    // Search
    const [search, setSearch] = useState('');

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

    /* ── Fetch with sessionStorage cache ───────────────────── */
    useEffect(() => {
        if (!selectedProperty) { setLoading(false); return; }

        const cacheKey = `new_lost_rankings_${selectedProperty}_${days}`;
        const cached = ssGet(cacheKey);

        if (cached) {
            setData(cached);
            setLoading(false);
            return;
        }

        // First time → show skeletons; date change → inline fade
        if (!data) setLoading(true);
        else setIsUpdating(true);

        api.get(
            `/auth/gsc/new-lost-rankings/${encodeURIComponent(selectedProperty)}`,
            { params: { days } }
        ).then(res => {
            ssSet(cacheKey, res.data);
            setData(res.data);
        }).catch(err => {
            toast.error(err.response?.data?.detail || 'Failed to fetch rankings');
        }).finally(() => {
            setLoading(false);
            setIsUpdating(false);
        });
    }, [selectedProperty, days]);

    /* ── Computed rows ─────────────────────────────────────── */
    const rows = useMemo(() => {
        if (!data) return [];
        const key = `${statusTab === 'New' ? 'new' : 'lost'}_${typeTab === 'Queries' ? 'queries' : 'pages'}`;
        let items = data[key] || [];
        if (search.trim()) {
            const q = search.toLowerCase();
            items = items.filter(r => r.name.toLowerCase().includes(q));
        }
        // Apply metric filters
        metricFilters.forEach(({ dimension, operator, expression }) => {
            const val = parseFloat(expression);
            if (isNaN(val)) return;
            items = items.filter(row => {
                const rv = row[dimension] ?? 0;
                if (operator === 'greaterThan') return rv > val;
                if (operator === 'lessThan') return rv < val;
                return rv === val;
            });
        });
        return [...items].sort((a, b) => {
            const mul = sortDir === 'asc' ? 1 : -1;
            if (sortField === 'name') return mul * a.name.localeCompare(b.name);
            return mul * ((a[sortField] || 0) - (b[sortField] || 0));
        });
    }, [data, statusTab, typeTab, sortField, sortDir, search, metricFilters]);

    const handleSort = (field) => {
        if (sortField === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
        else { setSortField(field); setSortDir('desc'); }
    };

    const counts = data?.counts || { new_queries: 0, lost_queries: 0, new_pages: 0, lost_pages: 0 };
    const period = data?.period || {};
    const totalForTab = statusTab === 'New'
        ? (typeTab === 'Queries' ? counts.new_queries : counts.new_pages)
        : (typeTab === 'Queries' ? counts.lost_queries : counts.lost_pages);

    /* ── Render ─────────────────────────────────────────────── */
    return (
        <div className="flex-1 bg-[#f5f6f8] min-h-screen">

            {/* ── Top Bar ── */}
            <div className="flex items-center justify-between px-6 py-4 bg-white border-b border-slate-100 sticky top-0 z-20">
                <div className="flex items-center gap-3">
                    <button
                        onClick={() => navigate(-1)}
                        className="flex items-center gap-1.5 text-slate-500 hover:text-slate-800 text-[13px] font-semibold transition-colors"
                    >
                        <ArrowLeftIcon className="w-4 h-4" />
                        Back to Dashboard
                    </button>
                    <span className="text-slate-300 text-lg">|</span>
                    <h1 className="text-[17px] font-black text-slate-900 tracking-tight">
                        New &amp; Lost Rankings
                    </h1>
                    {!loading && (
                        <span className="text-[12px] font-bold text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full">
                            {counts.new_queries + counts.lost_queries} total
                        </span>
                    )}
                </div>

                {/* Date Picker */}
                <div className="relative">
                    <button
                        onClick={() => setIsDatePickerOpen(o => !o)}
                        disabled={isUpdating}
                        className="flex items-center gap-1.5 px-3 py-1.5 border border-slate-200 rounded-lg text-[13px] font-semibold text-slate-600 bg-white shadow-sm hover:bg-slate-50 transition-colors disabled:opacity-70"
                    >
                        {isUpdating
                            ? <div className="w-4 h-4 border-[2px] border-slate-400 border-t-transparent rounded-full animate-spin" />
                            : <CalendarDaysIcon className="w-4 h-4 text-slate-400" />
                        }
                        {selectedPreset}
                        <ChevronDownIcon className="w-4 h-4 text-slate-400" />
                    </button>
                    {isDatePickerOpen && (
                        <>
                            <div className="fixed inset-0 z-40" onClick={() => setIsDatePickerOpen(false)} />
                            <div className="absolute right-0 top-full mt-2 bg-white border border-slate-200 rounded-2xl shadow-[0_12px_40px_rgb(0,0,0,0.12)] z-50 p-4 w-[200px]">
                                {['Last 7 days', 'Last 14 days', 'Last 28 days', 'Last 3 months', 'Last 6 months'].map(p => (
                                    <button
                                        key={p}
                                        onClick={() => {
                                            setSelectedPreset(p);
                                            setDays(presetToDays(p));
                                            setIsDatePickerOpen(false);
                                        }}
                                        className={`w-full text-left px-3 py-2 rounded-lg text-[13px] font-semibold transition-all mb-0.5 ${selectedPreset === p ? 'bg-emerald-50 text-emerald-700' : 'text-slate-600 hover:bg-slate-50'}`}
                                    >
                                        {p}
                                    </button>
                                ))}
                            </div>
                        </>
                    )}
                </div>
            </div>

            <div className={`p-6 transition-opacity duration-300 ${isUpdating ? 'opacity-60 pointer-events-none' : ''}`}>

                {/* ── KPI Cards ── */}
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
                    {loading ? (
                        Array.from({ length: 4 }).map((_, i) => <KpiSkeleton key={i} />)
                    ) : (
                        <>
                            <KpiCard label="New Queries"  count={counts.new_queries}  isNew={true}  icon={ArrowTrendingUpIcon} />
                            <KpiCard label="Lost Queries" count={counts.lost_queries} isNew={false} icon={ArrowTrendingDownIcon} />
                            <KpiCard label="New Pages"    count={counts.new_pages}    isNew={true}  icon={ArrowTrendingUpIcon} />
                            <KpiCard label="Lost Pages"   count={counts.lost_pages}   isNew={false} icon={ArrowTrendingDownIcon} />
                        </>
                    )}
                </div>

                {/* ── Table Card ── */}
                <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">

                    {/* Toolbar */}
                    <div className="flex flex-wrap items-center gap-3 px-5 py-4 border-b border-slate-100">
                        {/* New / Lost */}
                        <div className="flex items-center gap-1.5">
                            {['New', 'Lost'].map(tab => (
                                <button
                                    key={tab}
                                    onClick={() => setStatusTab(tab)}
                                    disabled={loading}
                                    className={`flex items-center gap-1.5 px-3 py-1 text-[12px] font-bold rounded-md border transition-all disabled:opacity-40 ${
                                        statusTab === tab
                                            ? tab === 'New'
                                                ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                                                : 'bg-rose-50 text-rose-600 border-rose-200'
                                            : 'bg-white text-slate-500 border-slate-200 hover:bg-slate-50'
                                    }`}
                                >
                                    {tab === 'New'
                                        ? <ArrowTrendingUpIcon className="w-3.5 h-3.5" />
                                        : <ArrowTrendingDownIcon className="w-3.5 h-3.5" />
                                    }
                                    {tab}
                                    {!loading && (
                                        <span className="font-black">
                                            ({tab === 'New'
                                                ? (typeTab === 'Queries' ? counts.new_queries : counts.new_pages)
                                                : (typeTab === 'Queries' ? counts.lost_queries : counts.lost_pages)
                                            })
                                        </span>
                                    )}
                                </button>
                            ))}
                        </div>

                        {/* Queries / Pages */}
                        <div className="flex bg-slate-100 rounded-lg p-0.5">
                            {['Queries', 'Pages'].map(tab => (
                                <button
                                    key={tab}
                                    onClick={() => setTypeTab(tab)}
                                    disabled={loading}
                                    className={`px-3 py-1 text-[12px] font-bold rounded-md transition-all disabled:opacity-40 ${
                                        typeTab === tab ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                                    }`}
                                >
                                    {tab}
                                </button>
                            ))}
                        </div>


                        {/* Search + Metric Filter + Download */}
                        <div className="ml-auto flex flex-wrap items-center gap-2">
                            {/* Active metric chips */}
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

                            {/* Add metric filter */}
                            <div className="relative" ref={filterMenuRef}>
                                <button onClick={() => setFilterMenuOpen(p => !p)}
                                    className="flex items-center gap-1.5 px-3.5 py-1.5 border border-slate-200 rounded-full text-[13px] font-bold text-slate-600 bg-white shadow-sm hover:bg-slate-50 hover:text-slate-800 transition-colors">
                                    <PlusIcon className="w-4 h-4 text-emerald-600" />
                                    Metric filter
                                </button>
                                {filterMenuOpen && (
                                    <div className="absolute right-0 top-full mt-1.5 z-50 w-44 bg-white border border-slate-200 rounded-lg shadow-lg overflow-hidden py-1">
                                        {['clicks', 'impressions', 'position'].map(dim => (
                                            <button key={dim} onClick={() => { setFilterDialog({ dimension: dim }); setTempFilter({ operator: 'greaterThan', expression: '' }); setFilterMenuOpen(false); }}
                                                className="w-full text-left px-4 py-2 text-[13px] font-medium text-slate-700 hover:bg-slate-50 transition-colors capitalize">
                                                {dim}
                                            </button>
                                        ))}
                                    </div>
                                )}
                                {filterDialog && (
                                    <div ref={filterDialogRef} className="absolute right-0 top-full mt-1.5 z-50 w-72 bg-white border border-slate-200 rounded-xl shadow-xl overflow-hidden">
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
                                            <input type="number" step={filterDialog.dimension === 'position' ? '0.1' : '1'} value={tempFilter.expression}
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

                            <input
                                type="text"
                                placeholder={`Filter ${typeTab.toLowerCase()}…`}
                                value={search}
                                onChange={e => setSearch(e.target.value)}
                                disabled={loading}
                                className="text-[12px] border border-slate-200 rounded-lg px-3 py-1.5 text-slate-700 bg-white focus:outline-none focus:ring-2 focus:ring-emerald-300 w-[160px] disabled:opacity-40"
                            />
                            <button 
                                onClick={() => handleDownloadCSV(rows, `${statusTab.toLowerCase()}_${typeTab.toLowerCase()}_rankings.csv`)}
                                title="Download CSV"
                                className="p-1.5 text-slate-400 hover:text-slate-700 border border-slate-200 rounded-lg transition-colors"
                            >
                                <ArrowDownTrayIcon className="w-4 h-4" />
                            </button>
                        </div>
                    </div>

                    {/* Table */}
                    <div className="overflow-x-auto">
                        <table className="w-full text-left text-sm whitespace-nowrap">
                            <thead className="text-[11px] font-bold uppercase tracking-wider text-slate-400 bg-slate-50 border-b border-slate-100">
                                <tr>
                                    <th className="py-3 px-5 text-slate-600 w-[50%]">
                                        <button onClick={() => handleSort('name')} disabled={loading} className="flex items-center gap-1 hover:text-slate-800 transition-colors disabled:cursor-default">
                                            {typeTab === 'Queries' ? 'Query' : 'Page'}
                                            {!loading && <SortIcon field="name" sortField={sortField} sortDir={sortDir} />}
                                        </button>
                                    </th>
                                    <th className="py-3 px-5 text-right">
                                        <button onClick={() => handleSort('clicks')} disabled={loading} className="flex items-center gap-1 hover:text-slate-800 transition-colors ml-auto disabled:cursor-default">
                                            Clicks {!loading && <SortIcon field="clicks" sortField={sortField} sortDir={sortDir} />}
                                        </button>
                                    </th>
                                    <th className="py-3 px-5 text-right">
                                        <button onClick={() => handleSort('impressions')} disabled={loading} className="flex items-center gap-1 hover:text-slate-800 transition-colors ml-auto disabled:cursor-default">
                                            Impressions {!loading && <SortIcon field="impressions" sortField={sortField} sortDir={sortDir} />}
                                        </button>
                                    </th>
                                    <th className="py-3 px-5 text-right">
                                        <button onClick={() => handleSort('position')} disabled={loading} className="flex items-center gap-1 hover:text-slate-800 transition-colors ml-auto disabled:cursor-default">
                                            Avg Position {!loading && <SortIcon field="position" sortField={sortField} sortDir={sortDir} />}
                                        </button>
                                    </th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-50">
                                {loading ? (
                                    Array.from({ length: 10 }).map((_, i) => <SkeletonRow key={i} i={i} />)
                                ) : rows.length === 0 ? (
                                    <tr>
                                        <td colSpan={4} className="py-16 text-center text-slate-400 text-[13px]">
                                            No {statusTab.toLowerCase()} {typeTab.toLowerCase()} found for this period.
                                        </td>
                                    </tr>
                                ) : rows.map((row, i) => (
                                    <motion.tr
                                        key={row.name}
                                        initial={{ opacity: 0, y: 3 }}
                                        animate={{ opacity: 1, y: 0 }}
                                        transition={{ duration: 0.1, delay: Math.min(i * 0.015, 0.3) }}
                                        className="hover:bg-slate-50/60 transition-colors group"
                                    >
                                        <td className="py-3.5 px-5">
                                            <div className="flex items-center gap-2">
                                                {statusTab === 'New'
                                                    ? <ArrowTrendingUpIcon className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                                                    : <ArrowTrendingDownIcon className="w-3.5 h-3.5 text-rose-400 shrink-0" />
                                                }
                                                <span className="text-[13px] font-semibold text-slate-700 truncate max-w-[400px]" title={row.name}>
                                                    {typeTab === 'Pages' ? shortenUrl(row.name) : row.name}
                                                </span>
                                            </div>
                                        </td>
                                        <td className="py-3.5 px-5 text-right text-[13px] font-bold text-slate-800">
                                            {row.clicks.toLocaleString()}
                                        </td>
                                        <td className="py-3.5 px-5 text-right text-[13px] font-bold text-slate-800">
                                            {row.impressions.toLocaleString()}
                                        </td>
                                        <td className="py-3.5 px-5 text-right text-[13px] font-bold text-slate-800">
                                            {row.position.toFixed(1)}
                                        </td>
                                    </motion.tr>
                                ))}
                            </tbody>
                        </table>
                    </div>

                    {/* Footer */}
                    {!loading && rows.length > 0 && (
                        <div className="px-5 py-3 border-t border-slate-100 flex items-center justify-between">
                            <span className="text-[12px] text-slate-400 font-medium">
                                Showing {rows.length} of {totalForTab} {statusTab.toLowerCase()} {typeTab.toLowerCase()}
                            </span>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}

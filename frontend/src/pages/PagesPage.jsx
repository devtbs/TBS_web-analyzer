import { useState, useEffect, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
    ArrowLeftIcon,
    ChevronDownIcon,
    ArrowUpIcon,
    ArrowDownIcon,
    ClockIcon,
    ArrowDownTrayIcon,
    MagnifyingGlassIcon,
    PlusIcon,
    XMarkIcon,
} from '@heroicons/react/24/outline';
import api from '../api/axios';
import toast from 'react-hot-toast';

/* ── sessionStorage cache (15-min TTL) ────────────────────── */
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
const PRESETS = ['Last 7 days', 'Last 14 days', 'Last 28 days', 'Last 3 months', 'Last 6 months'];
const presetToDays = (p) => {
    switch (p) {
        case 'Last 7 days':   return 7;
        case 'Last 14 days':  return 14;
        case 'Last 28 days':  return 28;
        case 'Last 3 months': return 90;
        case 'Last 6 months': return 180;
        default: return 28;
    }
};
const shortenUrl = (url) => {
    const s = url.replace(/^https?:\/\/(www\.)?/, '');
    const short = /^[^/]+\/?$/.test(s) ? s.replace(/\/?$/, '/') : s.replace(/\/$/, '');
    // Decode percent-encoded (e.g. Thai) paths so they're readable; fall back on malformed input.
    try { return decodeURIComponent(short); } catch { return short; }
};

const METRIC_DIMS = ['clicks', 'impressions', 'ctr', 'position'];

/* ── Delta badge ─────────────────────────────────────────── */
// lowerIsBetter (position): a decrease is "good" (green) even though the arrow points down.
const Delta = ({ value, lowerIsBetter = false }) => {
    if (value == null) return <span className="text-slate-300 text-[11px] ml-1.5">—</span>;
    const up = value >= 0;
    const good = lowerIsBetter ? value < 0 : value >= 0;
    return (
        <span className={`inline-flex items-center gap-0.5 text-[11px] font-bold ml-1.5 ${good ? 'text-emerald-500' : 'text-rose-500'}`}>
            {up ? <ArrowUpIcon className="w-2.5 h-2.5" /> : <ArrowDownIcon className="w-2.5 h-2.5" />}
            {Math.abs(value)}%
        </span>
    );
};

/* ── Skeleton row ────────────────────────────────────────── */
const SkeletonRow = ({ i, cols = 5 }) => (
    <tr className="border-b border-slate-50">
        <td className="py-3.5 px-4">
            <div className="h-3 bg-slate-100 rounded animate-pulse" style={{ width: `${160 + (i % 5) * 40}px`, animationDelay: `${i * 35}ms` }} />
        </td>
        {Array.from({ length: cols - 1 }).map((_, j) => (
            <td key={j} className="py-3.5 px-4 text-right">
                <div className="h-3 w-12 bg-slate-100 rounded animate-pulse ml-auto" style={{ animationDelay: `${i * 35 + j * 15}ms` }} />
            </td>
        ))}
    </tr>
);

/* ── Sort icon ───────────────────────────────────────────── */
const SortIcon = ({ col, sortKey, sortDir }) => {
    if (sortKey !== col) return <ChevronDownIcon className="w-3 h-3 text-slate-300 ml-1 inline" />;
    return sortDir === 'desc'
        ? <ArrowDownIcon className="w-3 h-3 text-emerald-500 ml-1 inline" />
        : <ArrowUpIcon className="w-3 h-3 text-emerald-500 ml-1 inline" />;
};

/* ── Operator label ─────────────────────────────────────── */
const opLabel = (op) => op === 'greaterThan' ? '>' : op === 'lessThan' ? '<' : '=';

const handleDownloadCSV = (data, filename) => {
    if (!data || !data.length) return;
    const headers = Object.keys(data[0]);
    const csvContent = [
        headers.join(','),
        ...data.map(row => headers.map(header => {
            let val = row[header];
            if (typeof val === 'string') return `"${val.replace(/"/g, '""')}"`;
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

export default function PagesPage() {
    const navigate = useNavigate();
    const [selectedProperty, setSelectedProperty] = useState(localStorage.getItem('gsc_selected_property') || '');

    useEffect(() => {
        const handlePropChange = () => {
            setSelectedProperty(localStorage.getItem('gsc_selected_property') || '');
            setLoading(true);
            setRawPages([]);
        };
        window.addEventListener('gsc_property_changed', handlePropChange);
        return () => window.removeEventListener('gsc_property_changed', handlePropChange);
    }, []);

    const [rawPages, setRawPages]       = useState([]);
    const [loading, setLoading]         = useState(true);
    const [isUpdating, setIsUpdating]   = useState(false);
    const [preset, setPreset]           = useState('Last 28 days');
    const [days, setDays]               = useState(28);
    const [isPresetOpen, setIsPresetOpen] = useState(false);
    const [sortKey, setSortKey]         = useState('clicks');
    const [sortDir, setSortDir]         = useState('desc');
    const [currentPage, setCurrentPage] = useState(1);
    const PAGE_SIZE = 50;
    const [search, setSearch]           = useState('');

    // Metric filters
    const [metricFilters, setMetricFilters] = useState([]);
    const [filterMenuOpen, setFilterMenuOpen] = useState(false);
    const [filterDialog, setFilterDialog] = useState(null);
    const [tempFilter, setTempFilter] = useState({ operator: 'greaterThan', expression: '' });
    const filterMenuRef = useRef(null);
    const filterDialogRef = useRef(null);

    // Close popover on outside click
    useEffect(() => {
        const handler = (e) => {
            if (filterMenuRef.current && !filterMenuRef.current.contains(e.target)) setFilterMenuOpen(false);
            if (filterDialogRef.current && !filterDialogRef.current.contains(e.target)) setFilterDialog(null);
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, []);

    /* ── Fetch with sessionStorage cache ── */
    useEffect(() => {
        if (!selectedProperty) { setLoading(false); return; }
        const cacheKey = `pages_v2_${selectedProperty}_${days}`;
        const cached = ssGet(cacheKey);
        if (cached) { setRawPages(cached); setLoading(false); return; }
        if (rawPages.length === 0) setLoading(true); else setIsUpdating(true);

        api.get(`/auth/gsc/pages/${encodeURIComponent(selectedProperty)}`, { params: { days } })
            .then(res => {
                const d = res.data.pages || [];
                ssSet(cacheKey, d);
                setRawPages(d);
            })
            .catch(err => toast.error(err.response?.data?.detail || 'Failed to load pages'))
            .finally(() => { setLoading(false); setIsUpdating(false); });
    }, [selectedProperty, days]);

    const pages = useMemo(() => rawPages, [rawPages]);

    /* ── Filter + sort ── */
    const filtered = useMemo(() => {
        let list = [...pages];
        if (search.trim()) list = list.filter(p => p.url.toLowerCase().includes(search.toLowerCase()));
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
            const av = a[sortKey] ?? 0, bv = b[sortKey] ?? 0;
            return sortDir === 'desc' ? bv - av : av - bv;
        });
        return list;
    }, [pages, search, sortKey, sortDir, metricFilters]);

    const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
    const displayed  = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

    const handleSort = (key) => {
        if (sortKey === key) setSortDir(d => d === 'desc' ? 'asc' : 'desc');
        else { setSortKey(key); setSortDir('desc'); }
        setCurrentPage(1);
    };

    useEffect(() => { setCurrentPage(1); }, [search, metricFilters]);

    const applyFilter = () => {
        if (!tempFilter.expression.trim()) return;
        setMetricFilters(prev => [...prev.filter(f => f.dimension !== filterDialog.dimension), {
            dimension: filterDialog.dimension,
            operator: tempFilter.operator,
            expression: tempFilter.expression,
        }]);
        setFilterDialog(null);
        setCurrentPage(1);
    };

    return (
        <div className="min-h-screen bg-[#f5f6f8]">
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 bg-white border-b border-slate-100 sticky top-0 z-20">
                <div className="flex items-center gap-3">
                    <button onClick={() => navigate('/seo-analytics')} className="flex items-center gap-1.5 text-[13px] font-semibold text-slate-500 hover:text-slate-800 transition-colors">
                        <ArrowLeftIcon className="w-4 h-4" /> Back to Dashboard
                    </button>
                    <span className="text-slate-300">|</span>
                    <h1 className="text-[17px] font-black text-slate-900">Pages</h1>
                    {!loading && (
                        <span className="text-[12px] font-bold text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full">
                            {pages.length} total
                        </span>
                    )}
                </div>
                <div className="flex items-center gap-2">
                    {/* Search */}
                    <div className="flex items-center gap-2 px-4 h-10 bg-white border border-slate-200 rounded-lg shadow-sm hover:border-slate-300 transition-colors group">
                        <MagnifyingGlassIcon className="w-3.5 h-3.5 text-slate-400 group-hover:text-emerald-500 transition-colors" />
                        <input
                            type="text"
                            placeholder="Filter pages…"
                            value={search}
                            onChange={e => setSearch(e.target.value)}
                            className="bg-transparent border-none focus:ring-0 p-0 outline-none w-36 text-slate-800 font-bold text-[13px] placeholder:text-slate-300"
                        />
                    </div>
                    {/* Date picker */}
                    <div className="relative">
                        <button
                            onClick={() => setIsPresetOpen(o => !o)}
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
                        {isPresetOpen && (
                            <>
                                <div className="fixed inset-0 z-40" onClick={() => setIsPresetOpen(false)} />
                                <div className="absolute right-0 top-full mt-2 bg-white border border-slate-200 rounded-xl shadow-xl z-50 py-1.5 w-44">
                                    {PRESETS.map(p => (
                                        <button key={p} onClick={() => { setPreset(p); setDays(presetToDays(p)); setIsPresetOpen(false); }}
                                            className={`w-full text-left px-4 py-2 text-[13px] font-semibold transition-colors ${preset === p ? 'text-emerald-700 bg-emerald-50' : 'text-slate-700 hover:bg-slate-50'}`}>
                                            {p}
                                        </button>
                                    ))}
                                </div>
                            </>
                        )}
                    </div>
                    <button onClick={() => handleDownloadCSV(pages, 'pages_full_data.csv')} title="Download CSV" className="flex items-center gap-1.5 p-1.5 text-slate-400 hover:text-slate-600 transition-colors rounded-lg hover:bg-slate-100">
                        <ArrowDownTrayIcon className="w-4 h-4" />
                    </button>
                </div>
            </div>

            {/* Metric Filter Bar */}
            <div className="flex flex-wrap items-center gap-2 px-6 py-3 bg-white border-b border-slate-100">
                {/* Active chips */}
                {metricFilters.map((f, i) => (
                    <span key={i} className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-full text-[13px] font-bold text-slate-700 shadow-sm">
                        <span className="capitalize text-slate-500">{f.dimension}:</span>
                        <span className="text-slate-600">{opLabel(f.operator)}</span>
                        <span className="text-slate-900 mx-1">{f.expression}</span>
                        <button onClick={() => { setMetricFilters(prev => prev.filter((_, idx) => idx !== i)); setCurrentPage(1); }}
                            className="text-slate-400 hover:text-red-500 transition-colors ml-0.5">
                            <XMarkIcon className="w-3.5 h-3.5" />
                        </button>
                    </span>
                ))}

                {/* Add metric filter button */}
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
                            {METRIC_DIMS.map(dim => (
                                <button
                                    key={dim}
                                    onClick={() => {
                                        setFilterDialog({ dimension: dim });
                                        setTempFilter({ operator: 'greaterThan', expression: '' });
                                        setFilterMenuOpen(false);
                                    }}
                                    className="w-full text-left px-4 py-2 text-[13px] font-medium text-slate-700 hover:bg-slate-50 transition-colors capitalize"
                                >
                                    {dim}
                                </button>
                            ))}
                        </div>
                    )}

                    {/* Filter dialog */}
                    {filterDialog && (
                        <div ref={filterDialogRef} className="absolute left-0 top-full mt-1.5 z-50 w-72 bg-white border border-slate-200 rounded-xl shadow-xl overflow-hidden">
                            <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
                                <span className="text-[14px] font-bold text-slate-800 capitalize">{filterDialog.dimension}</span>
                                <button onClick={() => setFilterDialog(null)} className="text-slate-400 hover:text-slate-600"><XMarkIcon className="w-4 h-4" /></button>
                            </div>
                            <div className="p-4 flex flex-col gap-3">
                                <select
                                    value={tempFilter.operator}
                                    onChange={e => setTempFilter(f => ({ ...f, operator: e.target.value }))}
                                    className="w-full px-3 py-2 text-[13px] font-medium bg-white border border-slate-200 rounded-lg outline-none focus:border-emerald-400 transition-colors"
                                >
                                    <option value="greaterThan">Greater than (&gt;)</option>
                                    <option value="lessThan">Less than (&lt;)</option>
                                    <option value="equals">Equals (=)</option>
                                </select>
                                <input
                                    type="number"
                                    step={['ctr', 'position'].includes(filterDialog.dimension) ? '0.1' : '1'}
                                    value={tempFilter.expression}
                                    onChange={e => setTempFilter(f => ({ ...f, expression: e.target.value }))}
                                    placeholder={`Enter ${filterDialog.dimension}…`}
                                    className="w-full px-3 py-2 text-[13px] border border-slate-200 rounded-lg outline-none focus:border-emerald-400 transition-colors"
                                    autoFocus
                                    onKeyDown={e => { if (e.key === 'Enter') applyFilter(); }}
                                />
                            </div>
                            <div className="px-4 py-3 border-t border-slate-100 flex justify-end gap-2 bg-slate-50/50">
                                <button onClick={() => setFilterDialog(null)} className="px-4 py-1.5 text-[13px] font-bold text-emerald-600 hover:bg-emerald-50 rounded-lg transition-colors">Cancel</button>
                                <button onClick={applyFilter} className="px-4 py-1.5 text-[13px] font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg transition-colors shadow-sm">Apply</button>
                            </div>
                        </div>
                    )}
                </div>

                {metricFilters.length > 0 && (
                    <span className="text-[12px] text-slate-400 font-medium ml-auto">
                        {filtered.length} result{filtered.length !== 1 ? 's' : ''}
                    </span>
                )}
            </div>

            {/* Table */}
            <div className={`p-6 transition-opacity duration-300 ${isUpdating ? 'opacity-50 pointer-events-none' : ''}`}>
                <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
                    <div className="overflow-x-auto">
                        <table className="w-full text-left whitespace-nowrap">
                            <thead className="bg-slate-50 border-b border-slate-100 text-[11px] font-bold uppercase tracking-wider text-slate-400">
                                <tr>
                                    <th className="py-3 px-4 text-slate-600">
                                        <button onClick={() => handleSort('url')} disabled={loading} className="hover:text-slate-800 transition-colors">
                                            Page <SortIcon col="url" sortKey={sortKey} sortDir={sortDir} />
                                        </button>
                                    </th>
                                    {[['clicks','Clicks'],['impressions','Impressions'],['ctr','CTR'],['position','Position']].map(([k, label]) => (
                                        <th key={k} className="py-3 px-4 text-right">
                                            <button onClick={() => handleSort(k)} disabled={loading} className="flex items-center gap-1 ml-auto hover:text-slate-800 transition-colors">
                                                {label} <SortIcon col={k} sortKey={sortKey} sortDir={sortDir} />
                                            </button>
                                        </th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-50">
                                {loading ? (
                                    Array.from({ length: 12 }).map((_, i) => <SkeletonRow key={i} i={i} cols={5} />)
                                ) : displayed.length === 0 ? (
                                    <tr><td colSpan={5} className="py-16 text-center text-slate-400">No pages found.</td></tr>
                                ) : displayed.map((row, idx) => (
                                    <motion.tr key={row.url}
                                        initial={{ opacity: 0, y: 3 }}
                                        animate={{ opacity: 1, y: 0 }}
                                        transition={{ duration: 0.1, delay: Math.min(idx * 0.012, 0.3) }}
                                        className="hover:bg-slate-50/60 transition-colors"
                                    >
                                        <td className="py-3.5 px-4">
                                            <span className="text-[13px] font-semibold text-slate-700 truncate block max-w-[480px]" title={row.url}>
                                                {shortenUrl(row.url)}
                                            </span>
                                        </td>
                                        <td className="py-3.5 px-4 text-right whitespace-nowrap">
                                            <span className="text-[13px] font-bold text-slate-800">{row.clicks.toLocaleString()}</span>
                                            <Delta value={row.clicks_delta} />
                                        </td>
                                        <td className="py-3.5 px-4 text-right whitespace-nowrap">
                                            <span className="text-[13px] font-bold text-slate-800">{row.impressions.toLocaleString()}</span>
                                            <Delta value={row.impressions_delta} />
                                        </td>
                                        <td className="py-3.5 px-4 text-right whitespace-nowrap">
                                            <span className="text-[13px] font-bold text-slate-700">{row.ctr.toFixed(2)}%</span>
                                            <Delta value={row.ctr_delta} />
                                        </td>
                                        <td className="py-3.5 px-4 text-right whitespace-nowrap">
                                            <span className="text-[13px] font-bold text-slate-700">{row.position.toFixed(1)}</span>
                                            <Delta value={row.position_delta} lowerIsBetter />
                                        </td>
                                    </motion.tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>

            {!loading && filtered.length > 0 && totalPages > 1 && (
                <div className="sticky bottom-0 border-t border-slate-200 bg-white px-6 py-4 flex items-center justify-between shadow-[0_-4px_20px_-5px_rgba(0,0,0,0.1)] z-20">
                    <span className="text-[13px] text-slate-500 font-medium">
                        Showing {(currentPage - 1) * PAGE_SIZE + 1} to {Math.min(currentPage * PAGE_SIZE, filtered.length)} of {filtered.length} pages
                    </span>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={() => { setCurrentPage(p => Math.max(1, p - 1)); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
                            disabled={currentPage === 1}
                            className="px-3 py-1.5 text-[13px] font-semibold text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                        >
                            Previous
                        </button>
                        <button
                            onClick={() => { setCurrentPage(p => Math.min(totalPages, p + 1)); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
                            disabled={currentPage === totalPages}
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

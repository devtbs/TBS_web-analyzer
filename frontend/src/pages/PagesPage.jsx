import { useState, useEffect, useMemo } from 'react';
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
    return /^[^/]+\/?$/.test(s) ? s.replace(/\/?$/, '/') : s.replace(/\/$/, '');
};

/* ── Delta badge ─────────────────────────────────────────── */
const Delta = ({ value }) => {
    if (value == null) return <span className="text-slate-300 text-[11px] ml-1">—</span>;
    const up = value >= 0;
    return (
        <span className={`inline-flex items-center gap-0.5 text-[11px] font-bold ml-1.5 ${up ? 'text-emerald-500' : 'text-rose-500'}`}>
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

/* ══════════════════════════════════════════════════════════
   PagesPage — uses same /auth/gsc/analytics/ endpoint as SEOAnalytics
   ══════════════════════════════════════════════════════════ */
export default function PagesPage() {
    const navigate = useNavigate();
    const selectedProperty = localStorage.getItem('gsc_selected_property') || '';

    const [rawPages, setRawPages]       = useState([]);   // raw from pages endpoint
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

    /* ── Fetch with sessionStorage cache ── */
    useEffect(() => {
        if (!selectedProperty) { setLoading(false); return; }
        const cacheKey = `pages_${selectedProperty}_${days}`;
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

    /* ── Schema is already flat — just pass through ── */
    const pages = useMemo(() => rawPages, [rawPages]);

    /* ── Filter + sort ── */
    const filtered = useMemo(() => {
        let list = [...pages];
        if (search.trim()) list = list.filter(p => p.url.toLowerCase().includes(search.toLowerCase()));
        list.sort((a, b) => {
            const av = a[sortKey] ?? 0, bv = b[sortKey] ?? 0;
            return sortDir === 'desc' ? bv - av : av - bv;
        });
        return list;
    }, [pages, search, sortKey, sortDir]);

    const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
    const displayed  = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

    const handleSort = (key) => {
        if (sortKey === key) setSortDir(d => d === 'desc' ? 'asc' : 'desc');
        else { setSortKey(key); setSortDir('desc'); }
        setCurrentPage(1);
    };

    // Reset to page 1 when search changes
    useEffect(() => { setCurrentPage(1); }, [search]);

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
                    {/* Search — same pattern as SEOAnalytics */}
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
                    <button className="p-1.5 text-slate-400 hover:text-slate-600 border border-slate-200 rounded-lg transition-colors bg-white">
                        <ArrowDownTrayIcon className="w-4 h-4" />
                    </button>
                </div>
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
                                        <td className="py-3.5 px-4 text-right">
                                            <span className="text-[13px] font-bold text-slate-800">{row.clicks.toLocaleString()}</span>
                                        </td>
                                        <td className="py-3.5 px-4 text-right text-[13px] font-bold text-slate-800">
                                            {row.impressions.toLocaleString()}
                                        </td>
                                        <td className="py-3.5 px-4 text-right text-[13px] font-bold text-slate-700">
                                            {row.ctr.toFixed(2)}%
                                        </td>
                                        <td className="py-3.5 px-4 text-right text-[13px] font-bold text-slate-700">
                                            {row.position.toFixed(1)}
                                        </td>
                                    </motion.tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                    {!loading && filtered.length > 0 && (
                        <div className="px-4 py-3 border-t border-slate-100 flex items-center justify-between">
                            <span className="text-[12px] text-slate-400 font-medium">
                                Showing {(currentPage - 1) * PAGE_SIZE + 1}–{Math.min(currentPage * PAGE_SIZE, filtered.length)} of {filtered.length} pages
                            </span>
                            <div className="flex items-center gap-1">
                                <button
                                    onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                                    disabled={currentPage === 1}
                                    className="px-2.5 py-1 text-[12px] font-semibold rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                                >
                                    ← Prev
                                </button>
                                <span className="px-3 text-[12px] font-bold text-slate-500">
                                    {currentPage} / {totalPages}
                                </span>
                                <button
                                    onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                                    disabled={currentPage === totalPages}
                                    className="px-2.5 py-1 text-[12px] font-semibold rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                                >
                                    Next →
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}

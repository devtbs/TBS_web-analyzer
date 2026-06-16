import { useState, useEffect, useMemo, Fragment } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
    ArrowLeftIcon, ChevronDownIcon, ChevronRightIcon, ArrowUpIcon, ArrowDownIcon,
    ClockIcon, ArrowDownTrayIcon, MagnifyingGlassIcon,
} from '@heroicons/react/24/outline';
import api from '../../api/axios';
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

const PRESETS = ['Last 7 days', 'Last 14 days', 'Last 28 days', 'Last 3 months', 'Last 6 months'];
const presetToDays = (p) => ({
    'Last 7 days': 7, 'Last 14 days': 14, 'Last 28 days': 28,
    'Last 3 months': 90, 'Last 6 months': 180,
}[p] ?? 28);

const SortIcon = ({ col, sortKey, sortDir }) => {
    if (sortKey !== col) return <ChevronDownIcon className="w-3 h-3 text-slate-300 ml-1 inline" />;
    return sortDir === 'desc'
        ? <ArrowDownIcon className="w-3 h-3 text-emerald-500 ml-1 inline" />
        : <ArrowUpIcon className="w-3 h-3 text-emerald-500 ml-1 inline" />;
};

const downloadCSV = (data, filename) => {
    if (!data || !data.length) return;
    const flat = data.map(r => {
        const o = {};
        for (const [k, v] of Object.entries(r)) {
            if (Array.isArray(v) || typeof v === 'object') continue; // skip nested
            o[k] = v;
        }
        return o;
    });
    const headers = Object.keys(flat[0]);
    const csv = [
        headers.join(','),
        ...flat.map(row => headers.map(h => {
            const val = row[h];
            return typeof val === 'string' ? `"${val.replace(/"/g, '""')}"` : val;
        }).join(',')),
    ].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.setAttribute('download', filename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
};

/**
 * Reusable Search-Console insight page (table-based), powering the GSC Wizard-style tools.
 *
 * Props:
 *  - title, subtitle, emptyText, cachePrefix, csvName
 *  - endpoint(prop, days) -> url string
 *  - responseKey: key in the API response holding the array
 *  - searchKey: row field to free-text filter on
 *  - columns: [{ key, label, align?, sortType?, render?(row) }]
 *  - defaultSort: { key, dir }
 *  - expand?: { childKey, render(childRow) } — makes rows expandable
 */
export default function InsightTablePage({
    title, subtitle, emptyText = 'No data found for this period.',
    cachePrefix, csvName, endpoint, responseKey, searchKey,
    columns, defaultSort, expand = null, summary = null,
}) {
    const navigate = useNavigate();
    const [selectedProperty, setSelectedProperty] = useState(localStorage.getItem('gsc_selected_property') || '');
    const [rows, setRows] = useState([]);
    const [meta, setMeta] = useState(null);   // full API response (for charts that need extra data)
    const [loading, setLoading] = useState(true);
    const [isUpdating, setIsUpdating] = useState(false);
    const [preset, setPreset] = useState('Last 28 days');
    const [days, setDays] = useState(28);
    const [isPresetOpen, setIsPresetOpen] = useState(false);
    const [sortKey, setSortKey] = useState(defaultSort?.key);
    const [sortDir, setSortDir] = useState(defaultSort?.dir || 'desc');
    const [search, setSearch] = useState('');
    const [currentPage, setCurrentPage] = useState(1);
    const [expanded, setExpanded] = useState(() => new Set());
    const PAGE_SIZE = 50;

    useEffect(() => {
        const onChange = () => {
            setSelectedProperty(localStorage.getItem('gsc_selected_property') || '');
            setLoading(true);
            setRows([]);
        };
        window.addEventListener('gsc_property_changed', onChange);
        return () => window.removeEventListener('gsc_property_changed', onChange);
    }, []);

    useEffect(() => {
        if (!selectedProperty) { setLoading(false); return; }
        // `v2` namespaces the cache to the current response shape — bumping it
        // safely invalidates any entries saved under an older data format.
        const cacheKey = `${cachePrefix}_v2_${selectedProperty}_${days}`;
        const cached = ssGet(cacheKey);
        if (cached && typeof cached === 'object' && !Array.isArray(cached)) {
            setRows(cached[responseKey] || []); setMeta(cached); setLoading(false); return;
        }
        if (rows.length === 0) setLoading(true); else setIsUpdating(true);
        api.get(endpoint(selectedProperty, days))
            .then(res => {
                ssSet(cacheKey, res.data);
                setRows(res.data[responseKey] || []);
                setMeta(res.data);
            })
            .catch(err => toast.error(err.response?.data?.detail || `Failed to load ${title}`))
            .finally(() => { setLoading(false); setIsUpdating(false); });
    }, [selectedProperty, days]); // eslint-disable-line

    const filtered = useMemo(() => {
        let list = [...rows];
        if (search.trim() && searchKey) {
            const s = search.toLowerCase();
            list = list.filter(r => String(r[searchKey] ?? '').toLowerCase().includes(s));
        }
        if (sortKey) {
            list.sort((a, b) => {
                const av = a[sortKey], bv = b[sortKey];
                if (typeof av === 'string' || typeof bv === 'string') {
                    return sortDir === 'desc'
                        ? String(bv).localeCompare(String(av))
                        : String(av).localeCompare(String(bv));
                }
                return sortDir === 'desc' ? (bv ?? 0) - (av ?? 0) : (av ?? 0) - (bv ?? 0);
            });
        }
        return list;
    }, [rows, search, sortKey, sortDir, searchKey]);

    const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
    const displayed = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

    useEffect(() => { setCurrentPage(1); }, [search]);

    const handleSort = (key) => {
        if (sortKey === key) setSortDir(d => d === 'desc' ? 'asc' : 'desc');
        else { setSortKey(key); setSortDir('desc'); }
        setCurrentPage(1);
    };

    const toggleExpand = (i) => {
        setExpanded(prev => {
            const n = new Set(prev);
            n.has(i) ? n.delete(i) : n.add(i);
            return n;
        });
    };

    const colCount = columns.length + (expand ? 1 : 0);

    return (
        <div className="min-h-screen bg-[#f5f6f8]">
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 bg-white border-b border-slate-100 sticky top-0 z-20">
                <div className="flex items-center gap-3">
                    <button onClick={() => navigate('/seo-analytics')}
                        className="flex items-center gap-1.5 text-[13px] font-semibold text-slate-500 hover:text-slate-800 transition-colors">
                        <ArrowLeftIcon className="w-4 h-4" /> Back to Dashboard
                    </button>
                    <span className="text-slate-300">|</span>
                    <div>
                        <h1 className="text-[17px] font-black text-slate-900 leading-tight">{title}</h1>
                        {subtitle && <p className="text-[11px] text-slate-400 font-medium">{subtitle}</p>}
                    </div>
                    {!loading && (
                        <span className="text-[12px] font-bold text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full">
                            {filtered.length} found
                        </span>
                    )}
                </div>

                <div className="flex items-center gap-2">
                    {searchKey && (
                        <div className="flex items-center gap-2 px-4 h-10 bg-white border border-slate-200 rounded-lg shadow-sm hover:border-slate-300 transition-colors group">
                            <MagnifyingGlassIcon className="w-3.5 h-3.5 text-slate-400 group-hover:text-emerald-500 transition-colors" />
                            <input type="text" placeholder="Filter…" value={search} onChange={e => setSearch(e.target.value)}
                                className="bg-transparent border-none focus:ring-0 p-0 outline-none w-36 text-slate-800 font-bold text-[13px] placeholder:text-slate-300" />
                        </div>
                    )}
                    <div className="relative">
                        <button onClick={() => setIsPresetOpen(o => !o)} disabled={isUpdating}
                            className="flex items-center gap-1.5 px-3 py-1.5 border border-slate-200 rounded-lg text-[13px] font-semibold text-slate-600 bg-white shadow-sm hover:bg-slate-50 transition-colors disabled:opacity-70">
                            {isUpdating
                                ? <div className="w-4 h-4 border-[2px] border-slate-300 border-t-emerald-500 rounded-full animate-spin" />
                                : <ClockIcon className="w-4 h-4 text-slate-400" />}
                            {preset}
                            <ChevronDownIcon className="w-3.5 h-3.5 text-slate-400" />
                        </button>
                        {isPresetOpen && (
                            <>
                                <div className="fixed inset-0 z-40" onClick={() => setIsPresetOpen(false)} />
                                <div className="absolute right-0 top-full mt-2 bg-white border border-slate-200 rounded-xl shadow-xl z-50 py-1.5 w-44">
                                    {PRESETS.map(p => (
                                        <button key={p}
                                            onClick={() => { setPreset(p); setDays(presetToDays(p)); setIsPresetOpen(false); }}
                                            className={`w-full text-left px-4 py-2 text-[13px] font-semibold transition-colors ${preset === p ? 'text-emerald-700 bg-emerald-50' : 'text-slate-700 hover:bg-slate-50'}`}>
                                            {p}
                                        </button>
                                    ))}
                                </div>
                            </>
                        )}
                    </div>
                    <button onClick={() => downloadCSV(filtered, csvName)} title="Download CSV"
                        className="flex items-center gap-1.5 p-1.5 text-slate-400 hover:text-slate-600 transition-colors rounded-lg hover:bg-slate-100">
                        <ArrowDownTrayIcon className="w-4 h-4" />
                    </button>
                </div>
            </div>

            {/* No property selected */}
            {!selectedProperty && !loading ? (
                <div className="p-16 text-center text-slate-400 text-[14px] font-medium">
                    Select a property from the sidebar to view this report.
                </div>
            ) : (
                <div className={`p-6 transition-opacity duration-300 ${isUpdating ? 'opacity-50 pointer-events-none' : ''}`}>
                    {/* Summary cards + chart */}
                    {summary && !loading && rows.length > 0 && (() => {
                        const SummaryComp = summary;
                        return <div className="mb-6"><SummaryComp rows={rows} meta={meta} /></div>;
                    })()}
                    <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
                        <div className="overflow-x-auto">
                            <table className="w-full text-left whitespace-nowrap">
                                <thead className="bg-slate-50 border-b border-slate-100 text-[11px] font-bold uppercase tracking-wider text-slate-400">
                                    <tr>
                                        {expand && <th className="py-3 px-2 w-8" />}
                                        {columns.map(c => (
                                            <th key={c.key} className={`py-3 px-4 ${c.align === 'right' ? 'text-right' : 'text-slate-600'}`}>
                                                <button onClick={() => handleSort(c.key)} disabled={loading}
                                                    className={`hover:text-slate-800 transition-colors ${c.align === 'right' ? 'flex items-center gap-1 ml-auto' : ''}`}>
                                                    {c.label} <SortIcon col={c.key} sortKey={sortKey} sortDir={sortDir} />
                                                </button>
                                            </th>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-50">
                                    {loading ? (
                                        Array.from({ length: 12 }).map((_, i) => (
                                            <tr key={i} className="border-b border-slate-50">
                                                {Array.from({ length: colCount }).map((_, j) => (
                                                    <td key={j} className="py-3.5 px-4">
                                                        <div className="h-3 bg-slate-100 rounded animate-pulse" style={{ width: j === 0 ? '60%' : '40px', animationDelay: `${i * 35 + j * 15}ms` }} />
                                                    </td>
                                                ))}
                                            </tr>
                                        ))
                                    ) : displayed.length === 0 ? (
                                        <tr><td colSpan={colCount} className="py-16 text-center text-slate-400">{emptyText}</td></tr>
                                    ) : displayed.map((row, idx) => {
                                        const globalIdx = (currentPage - 1) * PAGE_SIZE + idx;
                                        const isOpen = expanded.has(globalIdx);
                                        return (
                                            <Fragment key={globalIdx}>
                                                <motion.tr
                                                    initial={{ opacity: 0, y: 3 }} animate={{ opacity: 1, y: 0 }}
                                                    transition={{ duration: 0.1, delay: Math.min(idx * 0.012, 0.3) }}
                                                    className={`hover:bg-slate-50/60 transition-colors ${expand ? 'cursor-pointer' : ''}`}
                                                    onClick={expand ? () => toggleExpand(globalIdx) : undefined}>
                                                    {expand && (
                                                        <td className="py-3.5 px-2 text-slate-400">
                                                            {isOpen ? <ChevronDownIcon className="w-4 h-4" /> : <ChevronRightIcon className="w-4 h-4" />}
                                                        </td>
                                                    )}
                                                    {columns.map(c => (
                                                        <td key={c.key} className={`py-3.5 px-4 ${c.align === 'right' ? 'text-right' : ''}`}>
                                                            {c.render ? c.render(row) : (
                                                                <span className="text-[13px] font-semibold text-slate-700 truncate block max-w-[480px]" title={String(row[c.key])}>
                                                                    {row[c.key]}
                                                                </span>
                                                            )}
                                                        </td>
                                                    ))}
                                                </motion.tr>
                                                {expand && isOpen && (
                                                    <tr className="bg-slate-50/40">
                                                        <td colSpan={colCount} className="px-10 py-3">
                                                            <div className="space-y-1.5">
                                                                {(row[expand.childKey] || []).map((child, ci) => (
                                                                    <div key={ci}>{expand.render(child)}</div>
                                                                ))}
                                                            </div>
                                                        </td>
                                                    </tr>
                                                )}
                                            </Fragment>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
            )}

            {!loading && filtered.length > 0 && totalPages > 1 && (
                <div className="sticky bottom-0 border-t border-slate-200 bg-white px-6 py-4 flex items-center justify-between shadow-[0_-4px_20px_-5px_rgba(0,0,0,0.1)] z-20">
                    <span className="text-[13px] text-slate-500 font-medium">
                        Showing {(currentPage - 1) * PAGE_SIZE + 1} to {Math.min(currentPage * PAGE_SIZE, filtered.length)} of {filtered.length}
                    </span>
                    <div className="flex items-center gap-2">
                        <button onClick={() => { setCurrentPage(p => Math.max(1, p - 1)); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
                            disabled={currentPage === 1}
                            className="px-3 py-1.5 text-[13px] font-semibold text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors">
                            Previous
                        </button>
                        <button onClick={() => { setCurrentPage(p => Math.min(totalPages, p + 1)); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
                            disabled={currentPage === totalPages}
                            className="px-3 py-1.5 text-[13px] font-semibold text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors">
                            Next
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}

/* Small shared cell renderers */
export const num = (v) => (v ?? 0).toLocaleString();
export const pct = (v) => `${(v ?? 0).toFixed(2)}%`;
export const pos = (v) => v == null ? '—' : Number(v).toFixed(1);
export const PosDelta = ({ value }) => {
    if (value == null || value === 0) return <span className="text-slate-300">—</span>;
    // For position, a NEGATIVE change means improved (moved up) → green
    const improved = value < 0;
    return (
        <span className={`inline-flex items-center gap-0.5 text-[12px] font-bold ${improved ? 'text-emerald-500' : 'text-rose-500'}`}>
            {improved ? <ArrowUpIcon className="w-3 h-3" /> : <ArrowDownIcon className="w-3 h-3" />}
            {Math.abs(value).toFixed(1)}
        </span>
    );
};

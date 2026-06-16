import { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    ArrowLeftIcon, MagnifyingGlassIcon, ArrowDownTrayIcon, PlayIcon, FireIcon,
} from '@heroicons/react/24/outline';
import api from '../api/axios';
import toast from 'react-hot-toast';

/* ── helpers ──────────────────────────────────────────────── */
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const compact = (v) => {
    const n = v ?? 0;
    if (n >= 1000000) return (n / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
    if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
    return `${n}`;
};

const periodLabel = (p, granularity) => {
    if (granularity === 'week') {
        const [, m, d] = p.split('-');
        return `${+d} ${MON[+m - 1]}`;
    }
    const [y, m] = p.split('-');
    return `${MON[+m - 1]} '${y.slice(2)}`;
};

/* column label without the year (the year lives in its own header band) */
const shortLabel = (p, granularity) => {
    if (granularity === 'week') {
        const [, m, d] = p.split('-');
        return `${+d} ${MON[+m - 1]}`;
    }
    return MON[+p.split('-')[1] - 1];
};
const yearOf = (p) => p.slice(0, 4);
const num = (v) => (v ?? 0).toLocaleString();

const METRICS = {
    clicks: { label: 'Clicks', invert: false, fmt: num, key: 'clicks' },
    impressions: { label: 'Impressions', invert: false, fmt: num, key: 'impressions' },
    position: { label: 'Avg. Position', invert: true, fmt: (v) => (v == null ? '·' : v.toFixed(1)), key: 'position' },
    ctr: { label: 'CTR', invert: false, fmt: (v) => `${(v ?? 0).toFixed(1)}%`, key: 'ctr' },
};

/* Fixed Red → Green shading. A cell reaches full color once its period-over-period
   change hits THRESHOLD percent. */
const GRADIENT = { good: [16, 185, 129], bad: [244, 63, 94] };
const THRESHOLD = 80;   // change (%) at which a cell reaches full color
const PER_PAGE = 50;

/* derive a default brand guess from the selected property */
const deriveBrand = (property) => {
    if (!property) return '';
    let host = property
        .replace(/^sc-domain:/, '')
        .replace(/^https?:\/\//, '')
        .replace(/^www\./, '');
    host = host.split('/')[0];
    const labels = host.split('.');
    const sld = labels.length >= 2 ? labels[labels.length - 2] : labels[0];
    return (sld || '').split(/[-_]/)[0];
};

const hasData = (cell) => cell && cell.impressions > 0;

/* signed % where positive = "good" for the metric (position is inverted) */
const goodPct = (cell, prev, metric) => {
    if (!hasData(cell) || !hasData(prev)) return null;
    const k = METRICS[metric].key;
    const cur = cell[k];
    const old = prev[k];
    if (cur == null || old == null) return null;
    if (METRICS[metric].invert) {
        // position: a smaller number is better
        return old ? ((old - cur) / old) * 100 : 0;
    }
    if (old === 0) return cur > 0 ? 100 : 0;
    return ((cur - old) / old) * 100;
};

export default function QueryDecayPage() {
    const navigate = useNavigate();
    const [selectedProperty, setSelectedProperty] = useState(localStorage.getItem('gsc_selected_property') || '');

    // data-shaping controls (require Run Analysis)
    const [granularity, setGranularity] = useState('month');
    const [periods, setPeriods] = useState(16);

    // view controls (instant, client-side)
    const [metric, setMetric] = useState('clicks');
    const [brandFilter, setBrandFilter] = useState('all');
    const [brandText, setBrandText] = useState('');
    const [search, setSearch] = useState('');
    const [sort, setSort] = useState('clicks');
    const [page, setPage] = useState(1);

    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(false);
    const [ran, setRan] = useState(false);

    useEffect(() => {
        const onChange = () => {
            const p = localStorage.getItem('gsc_selected_property') || '';
            setSelectedProperty(p); setData(null); setRan(false); setBrandText(deriveBrand(p));
        };
        window.addEventListener('gsc_property_changed', onChange);
        return () => window.removeEventListener('gsc_property_changed', onChange);
    }, []);
    useEffect(() => { setBrandText(deriveBrand(selectedProperty)); }, [selectedProperty]);

    const run = useCallback(() => {
        if (!selectedProperty) return toast.error('Select a property first');
        setLoading(true); setRan(true);
        api.get(`/auth/gsc/query-decay/${encodeURIComponent(selectedProperty)}`, { params: { periods, granularity } })
            .then(res => setData(res.data || { queries: [], periods: [] }))
            .catch(err => { toast.error(err.response?.data?.detail || 'Failed to load query decay'); setData({ queries: [], periods: [] }); })
            .finally(() => setLoading(false));
    }, [selectedProperty, periods, granularity]);

    const periodList = data?.periods || [];

    const brandTerms = useMemo(
        () => brandText.split(',').map(s => s.trim().toLowerCase()).filter(t => t.length >= 2),
        [brandText],
    );
    const isBranded = useCallback((q) => {
        const s = (q || '').toLowerCase();
        return brandTerms.some(t => s.includes(t));
    }, [brandTerms]);

    const rows = useMemo(() => {
        let list = data?.queries || [];
        if (search.trim()) {
            const s = search.toLowerCase();
            list = list.filter(q => q.query.toLowerCase().includes(s));
        }
        if (brandFilter === 'branded') list = list.filter(q => isBranded(q.query));
        else if (brandFilter === 'nonbranded') list = list.filter(q => !isBranded(q.query));

        const k = METRICS[metric].key;
        const trendScore = (q) => {
            const present = q.cells.filter(hasData);
            if (present.length < 2) return 0;
            const first = present[0][k] ?? 0;
            const last = present[present.length - 1][k] ?? 0;
            return METRICS[metric].invert ? first - last : last - first; // negative = decaying
        };
        list = [...list];
        if (sort === 'decay') list.sort((a, b) => trendScore(a) - trendScore(b));
        else list.sort((a, b) => b.clicks - a.clicks);
        return list;
    }, [data, search, brandFilter, isBranded, sort, metric]);

    const totalPages = Math.max(1, Math.ceil(rows.length / PER_PAGE));
    // Snap back to page 1 whenever the filtered set changes
    useEffect(() => { setPage(1); }, [search, brandFilter, sort, metric, data]);
    const safePage = Math.min(page, totalPages);
    const pageRows = useMemo(
        () => rows.slice((safePage - 1) * PER_PAGE, safePage * PER_PAGE),
        [rows, safePage],
    );

    // Group periods into consecutive year spans for the header band (2025, 2026…)
    const yearGroups = useMemo(() => {
        const groups = [];
        periodList.forEach(p => {
            const y = yearOf(p);
            const last = groups[groups.length - 1];
            if (last && last.year === y) last.count += 1;
            else groups.push({ year: y, count: 1 });
        });
        return groups;
    }, [periodList]);

    // Turn aggregated clicks/impr/position-weight into the selected metric's value
    const aggVal = useCallback((o) => {
        if (metric === 'clicks') return o.clicks;
        if (metric === 'impressions') return o.impr;
        if (metric === 'ctr') return o.impr ? (o.clicks / o.impr) * 100 : 0;
        return o.impr ? o.pw / o.impr : null; // position
    }, [metric]);

    // Per-column totals (over ALL filtered rows) + grand total for the TOTALS row
    const { colTotals, grandTotal } = useMemo(() => {
        const cols = periodList.map(() => ({ clicks: 0, impr: 0, pw: 0 }));
        const grand = { clicks: 0, impr: 0, pw: 0 };
        rows.forEach(q => {
            q.cells.forEach((c, idx) => {
                const col = cols[idx];
                col.clicks += c.clicks; col.impr += c.impressions;
                if (c.impressions) col.pw += c.position * c.impressions;
            });
            grand.clicks += q.clicks; grand.impr += q.impressions;
        });
        cols.forEach(c => { grand.pw += c.pw; });
        return { colTotals: cols, grandTotal: grand };
    }, [rows, periodList]);

    // Per-query row total (rightmost TOTALS column) for the selected metric
    const rowTotal = useCallback((q) => {
        let pw = 0, im = 0;
        q.cells.forEach(c => { if (c.impressions) { pw += c.position * c.impressions; im += c.impressions; } });
        return aggVal({ clicks: q.clicks, impr: q.impressions, pw });
    }, [aggVal]);

    const cellStyle = useCallback((cell, prev) => {
        if (!hasData(cell)) return { background: '#f8fafc', color: '#cbd5e1' };
        const pct = goodPct(cell, prev, metric);
        if (pct == null) return { background: '#f8fafc', color: '#475569' };
        const intensity = Math.min(Math.abs(pct) / THRESHOLD, 1);
        const [r, g, b] = pct >= 0 ? GRADIENT.good : GRADIENT.bad;
        const alpha = 0.05 + intensity * 0.33;   // much lighter overall
        return {
            background: `rgba(${r},${g},${b},${alpha})`,
            color: '#334155',
        };
    }, [metric]);

    const downloadCSV = () => {
        if (!rows.length) return;
        const head = ['Query', ...periodList.map(p => periodLabel(p, granularity))];
        const k = METRICS[metric].key;
        const lines = [head.join(',')];
        rows.forEach(q => {
            const vals = q.cells.map(c => (hasData(c) ? (c[k] ?? '') : ''));
            lines.push([`"${q.query.replace(/"/g, '""')}"`, ...vals].join(','));
        });
        const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `query_decay_${metric}.csv`; a.click();
    };

    const periodOpts = granularity === 'week' ? [8, 12, 16] : [8, 12, 16];
    const Pill = ({ active, onClick, children }) => (
        <button onClick={onClick}
            className={`px-3 py-1.5 text-[12px] font-bold rounded-lg transition-all ${active ? 'bg-slate-900 text-white shadow-sm' : 'text-slate-500 hover:bg-slate-100'}`}>
            {children}
        </button>
    );

    return (
        <div className="min-h-screen bg-[#f5f6f8]">
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 bg-white border-b border-slate-100 sticky top-0 z-20">
                <div className="flex items-center gap-3">
                    <button onClick={() => navigate('/seo-analytics')} className="flex items-center gap-1.5 text-[13px] font-semibold text-slate-500 hover:text-slate-800 transition-colors">
                        <ArrowLeftIcon className="w-4 h-4" /> Back to Dashboard
                    </button>
                    <span className="text-slate-300">|</span>
                    <div>
                        <h1 className="text-[17px] font-black text-slate-900 leading-tight flex items-center gap-2">
                            <FireIcon className="w-4 h-4 text-rose-500" /> Query Decay
                        </h1>
                        <p className="text-[11px] text-slate-400 font-medium">Spot keywords losing traffic over time — shaded by period-over-period trend</p>
                    </div>
                </div>
            </div>

            {!selectedProperty ? (
                <div className="p-16 text-center text-slate-400 text-[14px] font-medium">Select a property from the sidebar to begin.</div>
            ) : (
                <div className="p-6 max-w-[1400px] mx-auto space-y-5">
                    {/* Control deck */}
                    <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-5 space-y-4">
                        <div className="flex flex-wrap items-end gap-x-8 gap-y-4">
                            <div>
                                <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1.5">Metric</label>
                                <div className="flex bg-slate-50 border border-slate-200 rounded-xl p-0.5">
                                    {Object.entries(METRICS).map(([id, m]) => <Pill key={id} active={metric === id} onClick={() => setMetric(id)}>{m.label}</Pill>)}
                                </div>
                            </div>
                            <div>
                                <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1.5">Bucket</label>
                                <div className="flex bg-slate-50 border border-slate-200 rounded-xl p-0.5">
                                    <Pill active={granularity === 'month'} onClick={() => setGranularity('month')}>Month</Pill>
                                    <Pill active={granularity === 'week'} onClick={() => setGranularity('week')}>Week</Pill>
                                </div>
                            </div>
                            <div>
                                <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1.5">Range</label>
                                <select value={periods} onChange={e => setPeriods(+e.target.value)}
                                    className="h-9 px-3 text-[13px] font-bold text-slate-700 bg-slate-50 border border-slate-200 rounded-xl outline-none">
                                    {periodOpts.map(n => <option key={n} value={n}>Last {n} {granularity === 'week' ? 'weeks' : 'months'}</option>)}
                                </select>
                            </div>
                            <button onClick={run} disabled={loading}
                                className="ml-auto flex items-center gap-2 px-5 h-10 text-[13px] font-bold text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 rounded-xl shadow-sm self-end">
                                <PlayIcon className="w-4 h-4" /> {loading ? 'Loading…' : ran ? 'Refresh' : 'Run Analysis'}
                            </button>
                        </div>

                        <div className="flex flex-wrap items-center gap-3 pt-3 border-t border-slate-100">
                            <div className="flex bg-slate-50 border border-slate-200 rounded-lg p-0.5">
                                {[['all', 'All'], ['branded', 'Branded'], ['nonbranded', 'Non-Branded']].map(([id, l]) =>
                                    <button key={id} onClick={() => setBrandFilter(id)}
                                        className={`px-3 py-1 text-[12px] font-bold rounded-md ${brandFilter === id ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500'}`}>{l}</button>)}
                            </div>
                            <div className="flex items-center gap-2 h-9 px-3 rounded-xl bg-slate-50/80 border border-slate-200/70 shadow-sm transition-all focus-within:bg-white focus-within:border-emerald-300 focus-within:ring-2 focus-within:ring-emerald-100">
                                <span className="text-[11px] font-bold uppercase tracking-wide text-slate-400">Brand</span>
                                <input value={brandText} onChange={e => setBrandText(e.target.value)} placeholder="brand terms…"
                                    className="bg-transparent border-0 p-0 outline-none focus:ring-0 text-[12px] font-semibold text-slate-700 w-28 placeholder:text-slate-400 placeholder:font-medium" />
                            </div>
                            <div className="flex items-center gap-2 h-9 px-3 rounded-xl bg-slate-50/80 border border-slate-200/70 shadow-sm transition-all focus-within:bg-white focus-within:border-emerald-300 focus-within:ring-2 focus-within:ring-emerald-100">
                                <MagnifyingGlassIcon className="w-4 h-4 text-slate-400" />
                                <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search queries…"
                                    className="bg-transparent border-0 p-0 outline-none focus:ring-0 text-[12px] font-semibold text-slate-700 w-40 placeholder:text-slate-400 placeholder:font-medium" />
                            </div>
                            <div className="flex bg-slate-50 border border-slate-200 rounded-lg p-0.5">
                                {[['clicks', 'Top clicks'], ['decay', 'Biggest drop']].map(([id, l]) =>
                                    <button key={id} onClick={() => setSort(id)}
                                        className={`px-3 py-1 text-[12px] font-bold rounded-md ${sort === id ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500'}`}>{l}</button>)}
                            </div>
                            <button onClick={downloadCSV} disabled={!rows.length} title="Download CSV"
                                className="ml-auto p-2 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100 disabled:opacity-40">
                                <ArrowDownTrayIcon className="w-4 h-4" />
                            </button>
                        </div>
                    </div>

                    {/* Heatmap */}
                    <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
                        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-100">
                            <p className="text-[13px] font-bold text-slate-700">
                                {METRICS[metric].label} by {granularity === 'week' ? 'week' : 'month'}
                                {ran && !loading && <span className="text-slate-400 font-medium"> · {rows.length} {rows.length === 1 ? 'query' : 'queries'}</span>}
                            </p>
                            <div className="flex items-center gap-2 text-[11px] font-semibold text-slate-400">
                                <span>Declining</span>
                                <span className="w-16 h-3 rounded-full" style={{ background: `linear-gradient(90deg, rgba(${GRADIENT.bad},.8), #f1f5f9, rgba(${GRADIENT.good},.8))` }} />
                                <span>Rising</span>
                            </div>
                        </div>

                        {!ran ? (
                            <div className="py-20 text-center">
                                <FireIcon className="w-10 h-10 text-slate-300 mx-auto mb-3" />
                                <p className="text-[14px] font-semibold text-slate-500">Configure the controls above, then run the analysis.</p>
                                <p className="text-[12px] text-slate-400 mt-1">Each cell is shaded by how the metric moved vs the previous {granularity === 'week' ? 'week' : 'month'}.</p>
                            </div>
                        ) : loading ? (
                            <div className="py-20 text-center text-slate-400 text-[13px]">Loading query decay…</div>
                        ) : rows.length === 0 ? (
                            <div className="py-16 text-center text-slate-400 text-[14px] font-medium">No queries match the current filters.</div>
                        ) : (
                            <div className="overflow-hidden">
                                <table className="w-full border-collapse table-fixed">
                                    <thead>
                                        {/* Year band */}
                                        <tr className="bg-slate-50">
                                            <th rowSpan={2} className="w-[190px] align-bottom text-left py-2 px-4 text-[11px] font-bold uppercase tracking-wider text-slate-400 border-b border-slate-100">Query</th>
                                            {yearGroups.map((g, gi) => (
                                                <th key={g.year} colSpan={g.count} className={`py-1.5 text-[11px] font-bold text-slate-500 text-center ${gi > 0 ? 'border-l border-slate-200' : ''}`}>{g.year}</th>
                                            ))}
                                            <th rowSpan={2} className="w-[80px] align-bottom text-right py-2 px-3 text-[11px] font-bold uppercase tracking-wider text-slate-400 border-b border-l border-slate-200">Totals</th>
                                        </tr>
                                        {/* Month / week labels */}
                                        <tr className="bg-slate-50 border-b border-slate-100">
                                            {periodList.map((p, i) => {
                                                const newYear = i > 0 && yearOf(p) !== yearOf(periodList[i - 1]);
                                                return <th key={p} className={`py-2 px-1 text-[10px] font-bold text-slate-400 text-center ${newYear ? 'border-l border-slate-200' : ''}`}>{shortLabel(p, granularity)}</th>;
                                            })}
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {/* TOTALS summary row */}
                                        <tr className="bg-white border-b-2 border-slate-200">
                                            <td className="py-2 px-4 text-[11px] font-black uppercase tracking-wide text-slate-500 truncate">Totals ({num(rows.length)} queries)</td>
                                            {colTotals.map((c, i) => {
                                                const newYear = i > 0 && yearOf(periodList[i]) !== yearOf(periodList[i - 1]);
                                                return <td key={i} className={`py-2 px-1 text-center text-[11px] font-bold text-slate-700 tabular-nums ${newYear ? 'border-l border-slate-100' : ''}`}>{METRICS[metric].fmt(aggVal(c))}</td>;
                                            })}
                                            <td className="py-2 px-3 text-right text-[12px] font-black text-slate-800 tabular-nums border-l border-slate-200">{METRICS[metric].fmt(aggVal(grandTotal))}</td>
                                        </tr>
                                        {pageRows.map((q) => (
                                            <tr key={q.query} className="border-b border-slate-50 hover:bg-slate-50/40 group">
                                                <td className="py-1.5 px-4 text-[12px] font-semibold text-slate-700 truncate group-hover:bg-slate-50" title={q.query}>
                                                    {q.query}
                                                </td>
                                                {q.cells.map((cell, i) => {
                                                    const prev = i > 0 ? q.cells[i - 1] : null;
                                                    const val = hasData(cell) ? METRICS[metric].fmt(cell[METRICS[metric].key]) : '·';
                                                    const newYear = i > 0 && yearOf(cell.period) !== yearOf(q.cells[i - 1].period);
                                                    return (
                                                        <td key={cell.period} className={`p-0.5 text-center ${newYear ? 'border-l border-slate-100' : ''}`}>
                                                            <div className="rounded-md py-1.5 text-[11px] font-bold tabular-nums" style={cellStyle(cell, prev)}
                                                                title={`${q.query}\n${periodLabel(cell.period, granularity)}\nClicks ${compact(cell.clicks)} · Impr ${compact(cell.impressions)} · CTR ${(cell.ctr ?? 0).toFixed(1)}% · Pos ${cell.position ?? '—'}`}>
                                                                {val}
                                                            </div>
                                                        </td>
                                                    );
                                                })}
                                                <td className="py-1.5 px-3 text-right text-[12px] font-bold text-slate-800 tabular-nums border-l border-slate-100">{METRICS[metric].fmt(rowTotal(q))}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}

                        {/* Pagination */}
                        {ran && !loading && rows.length > 0 && (
                            <div className="flex items-center justify-between px-5 py-3 border-t border-slate-100">
                                <p className="text-[12px] font-semibold text-slate-400">
                                    Showing {(safePage - 1) * PER_PAGE + 1}–{Math.min(safePage * PER_PAGE, rows.length)} of {rows.length}
                                </p>
                                <div className="flex items-center gap-1.5">
                                    <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={safePage <= 1}
                                        className="px-3 h-8 text-[12px] font-bold text-slate-600 bg-slate-50 border border-slate-200 rounded-lg hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed">
                                        Prev
                                    </button>
                                    <span className="px-2 text-[12px] font-bold text-slate-500 tabular-nums">Page {safePage} / {totalPages}</span>
                                    <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={safePage >= totalPages}
                                        className="px-3 h-8 text-[12px] font-bold text-slate-600 bg-slate-50 border border-slate-200 rounded-lg hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed">
                                        Next
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}

import { useState, useEffect, useMemo, Fragment } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
    ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid,
} from 'recharts';
import {
    ArrowLeftIcon, ClockIcon, ChevronDownIcon, ChevronRightIcon, PlusIcon,
    TrashIcon, PencilSquareIcon, Square3Stack3DIcon, MagnifyingGlassIcon, ArrowDownTrayIcon,
} from '@heroicons/react/24/outline';
import api from '../api/axios';
import toast from 'react-hot-toast';

/* ── helpers ──────────────────────────────────────────────── */
const PRESETS = ['Last 7 days', 'Last 14 days', 'Last 28 days', 'Last 3 months', 'Last 6 months'];
const presetToDays = (p) => ({ 'Last 7 days': 7, 'Last 14 days': 14, 'Last 28 days': 28, 'Last 3 months': 90, 'Last 6 months': 180 }[p] ?? 28);
const num = (v) => (v ?? 0).toLocaleString();
const trunc = (s, n = 16) => (s && s.length > n ? s.slice(0, n) + '…' : s);
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const monthLabel = (ym) => { const [y, m] = ym.split('-'); return `${MON[+m - 1]} ${y.slice(2)}`; };
const pctChange = (cur, prev) => (prev ? Math.round(((cur - prev) / prev) * 100) : null);

const matchQuery = (query, rules) => {
    const q = (query || '').toLowerCase();
    return rules.some(raw => {
        const rule = raw.trim();
        if (!rule) return false;
        if (rule.length > 2 && rule.startsWith('/') && rule.endsWith('/')) {
            try { return new RegExp(rule.slice(1, -1), 'i').test(query); } catch { return false; }
        }
        return q.includes(rule.toLowerCase());
    });
};

const storeKey = (prop) => `topic_clusters_def_${prop}`;
const loadClusters = (prop) => { try { return JSON.parse(localStorage.getItem(storeKey(prop)) || '[]'); } catch { return []; } };
const saveClusters = (prop, c) => localStorage.setItem(storeKey(prop), JSON.stringify(c));

/* up/down delta badge. invert=true means "lower is better" (e.g. position) */
const Delta = ({ value, suffix = '%', invert = false }) => {
    if (value == null || value === 0) return <span className="text-slate-300 text-[11px]">—</span>;
    const good = invert ? value < 0 : value > 0;
    return (
        <span className={`inline-flex items-center gap-0.5 text-[11px] font-bold ${good ? 'text-emerald-500' : 'text-rose-500'}`}>
            {value > 0 ? '▲' : '▼'}{Math.abs(value)}{suffix}
        </span>
    );
};

const QUICK = [
    { id: 'all', label: 'All' },
    { id: 'opportunity', label: 'Opportunity' },
    { id: 'rising', label: 'Rising' },
    { id: 'declining', label: 'Declining' },
];

export default function TopicClustersPage() {
    const navigate = useNavigate();
    const [selectedProperty, setSelectedProperty] = useState(localStorage.getItem('gsc_selected_property') || '');
    const [data, setData] = useState({ queries: [], months: [] });
    const [loading, setLoading] = useState(true);
    const [preset, setPreset] = useState('Last 28 days');
    const [days, setDays] = useState(28);
    const [isPresetOpen, setIsPresetOpen] = useState(false);

    const [clusters, setClusters] = useState([]);
    const [name, setName] = useState('');
    const [kwText, setKwText] = useState('');
    const [editingId, setEditingId] = useState(null);
    const [expanded, setExpanded] = useState(() => new Set());
    const [search, setSearch] = useState('');
    const [quick, setQuick] = useState('all');
    const [chartCluster, setChartCluster] = useState(null);
    const [chartMetric, setChartMetric] = useState('clicks');
    const [tableMetric, setTableMetric] = useState('clicks');

    useEffect(() => {
        const onChange = () => {
            const p = localStorage.getItem('gsc_selected_property') || '';
            setSelectedProperty(p); setClusters(loadClusters(p)); setLoading(true);
        };
        window.addEventListener('gsc_property_changed', onChange);
        return () => window.removeEventListener('gsc_property_changed', onChange);
    }, []);
    useEffect(() => { setClusters(loadClusters(selectedProperty)); }, [selectedProperty]);

    useEffect(() => {
        if (!selectedProperty) { setLoading(false); return; }
        setLoading(true);
        api.get(`/auth/gsc/query-insights/${encodeURIComponent(selectedProperty)}`, { params: { days } })
            .then(res => setData(res.data || { queries: [], months: [] }))
            .catch(err => toast.error(err.response?.data?.detail || 'Failed to load query data'))
            .finally(() => setLoading(false));
    }, [selectedProperty, days]);

    const months = data.months || [];

    const analysed = useMemo(() => {
        return clusters.map(c => {
            const matched = (data.queries || []).filter(q => matchQuery(q.query, c.rules));
            const clicks = matched.reduce((a, q) => a + (q.clicks || 0), 0);
            const impressions = matched.reduce((a, q) => a + (q.impressions || 0), 0);
            const prevClicks = matched.reduce((a, q) => a + (q.prev_clicks || 0), 0);
            const prevImpr = matched.reduce((a, q) => a + (q.prev_impressions || 0), 0);
            const totImp = matched.reduce((a, q) => a + Math.max(q.impressions || 0, 1), 0);
            const position = matched.length ? Math.round((matched.reduce((a, q) => a + (q.position || 0) * Math.max(q.impressions || 0, 1), 0) / totImp) * 10) / 10 : null;
            const monthly = months.map(ym => {
                let mc = 0, mi = 0, mpw = 0;
                matched.forEach(q => {
                    const cell = q.monthly?.find(x => x.month === ym);
                    if (cell) { mc += cell.clicks; mi += cell.impressions; mpw += (cell.position || 0) * Math.max(cell.impressions, 1); }
                });
                return { month: ym, label: monthLabel(ym), clicks: mc, impressions: mi, ctr: mi ? Math.round(mc / mi * 1000) / 10 : 0, position: mi ? Math.round(mpw / mi * 10) / 10 : null };
            });
            matched.sort((a, b) => (b.clicks || 0) - (a.clicks || 0));
            return {
                ...c, matched, monthly,
                query_count: matched.length, clicks, impressions,
                ctr: impressions ? Math.round(clicks / impressions * 1000) / 10 : 0,
                position, clicksDelta: pctChange(clicks, prevClicks), imprDelta: pctChange(impressions, prevImpr),
            };
        });
    }, [clusters, data, months]);

    const filtered = useMemo(() => {
        let list = analysed.filter(c => !search.trim() || c.name.toLowerCase().includes(search.toLowerCase()));
        if (quick === 'opportunity') list = list.filter(c => c.position != null && c.position >= 4 && c.position <= 20);
        else if (quick === 'rising') list = list.filter(c => c.clicksDelta != null && c.clicksDelta > 10);
        else if (quick === 'declining') list = list.filter(c => c.clicksDelta != null && c.clicksDelta < -10);
        return list.sort((a, b) => b.clicks - a.clicks);
    }, [analysed, search, quick]);

    useEffect(() => {
        if (!chartCluster || !filtered.find(c => c.id === chartCluster)) setChartCluster(filtered[0]?.id || null);
    }, [filtered]); // eslint-disable-line

    const chartData = useMemo(() => (filtered.find(c => c.id === chartCluster)?.monthly) || [], [filtered, chartCluster]);

    /* ── CRUD ── */
    const resetForm = () => { setName(''); setKwText(''); setEditingId(null); };
    const submit = () => {
        const rules = kwText.split(',').map(s => s.trim()).filter(Boolean);
        if (!name.trim()) return toast.error('Give the cluster a name');
        if (!rules.length) return toast.error('Add at least one keyword');
        const next = editingId
            ? clusters.map(c => c.id === editingId ? { ...c, name: name.trim(), rules } : c)
            : [...clusters, { id: Date.now().toString(), name: name.trim(), rules }];
        setClusters(next); saveClusters(selectedProperty, next); resetForm();
        toast.success(editingId ? 'Cluster updated' : 'Cluster created');
    };
    const editCluster = (c) => { setEditingId(c.id); setName(c.name); setKwText(c.rules.join(', ')); window.scrollTo({ top: 99999, behavior: 'smooth' }); };
    const deleteCluster = (id) => { const next = clusters.filter(c => c.id !== id); setClusters(next); saveClusters(selectedProperty, next); if (editingId === id) resetForm(); toast.success('Cluster deleted'); };
    const toggle = (id) => setExpanded(p => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });

    const downloadCSV = () => {
        if (!filtered.length) return;
        const rows = [['Cluster', 'Keywords', 'Clicks', 'Impressions', 'CTR%', 'AvgPosition'].join(',')];
        filtered.forEach(c => rows.push([`"${c.name}"`, `"${c.rules.join('; ')}"`, c.clicks, c.impressions, c.ctr, c.position ?? ''].join(',')));
        const blob = new Blob([rows.join('\n')], { type: 'text/csv' });
        const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'topic_clusters.csv'; a.click();
    };

    const Th = ({ children, right }) => <th className={`py-3 px-4 text-[11px] font-bold uppercase tracking-wider text-slate-400 ${right ? 'text-right' : ''}`}>{children}</th>;

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
                        <h1 className="text-[17px] font-black text-slate-900 leading-tight">Topic Clusters</h1>
                        <p className="text-[11px] text-slate-400 font-medium">Track how your keyword clusters perform across queries</p>
                    </div>
                </div>
                <div className="relative">
                    <button onClick={() => setIsPresetOpen(o => !o)} className="flex items-center gap-1.5 px-3 py-1.5 border border-slate-200 rounded-lg text-[13px] font-semibold text-slate-600 bg-white shadow-sm hover:bg-slate-50">
                        <ClockIcon className="w-4 h-4 text-slate-400" /> {preset} <ChevronDownIcon className="w-3.5 h-3.5 text-slate-400" />
                    </button>
                    {isPresetOpen && (<>
                        <div className="fixed inset-0 z-40" onClick={() => setIsPresetOpen(false)} />
                        <div className="absolute right-0 top-full mt-2 bg-white border border-slate-200 rounded-xl shadow-xl z-50 py-1.5 w-44">
                            {PRESETS.map(p => <button key={p} onClick={() => { setPreset(p); setDays(presetToDays(p)); setIsPresetOpen(false); }} className={`w-full text-left px-4 py-2 text-[13px] font-semibold ${preset === p ? 'text-emerald-700 bg-emerald-50' : 'text-slate-700 hover:bg-slate-50'}`}>{p}</button>)}
                        </div>
                    </>)}
                </div>
            </div>

            {!selectedProperty ? (
                <div className="p-16 text-center text-slate-400 text-[14px] font-medium">Select a property from the sidebar to begin.</div>
            ) : (
                <div className="p-6 max-w-6xl mx-auto space-y-6">
                    {/* Filter bar */}
                    <div className="flex items-center justify-between gap-3 flex-wrap bg-white border border-slate-200 rounded-xl shadow-sm px-4 py-3">
                        <div className="flex items-center gap-1.5">
                            <span className="text-[11px] font-bold text-slate-400 mr-1">Quick filter:</span>
                            {QUICK.map(f => (
                                <button key={f.id} onClick={() => setQuick(f.id)}
                                    className={`px-3 py-1 rounded-full text-[12px] font-bold transition-all ${quick === f.id ? 'bg-emerald-600 text-white shadow-sm' : 'text-slate-500 hover:bg-slate-100'}`}>
                                    {f.label}
                                </button>
                            ))}
                        </div>
                        <div className="flex items-center gap-2 px-3 h-9 bg-slate-50 border border-slate-200 rounded-lg">
                            <MagnifyingGlassIcon className="w-3.5 h-3.5 text-slate-400" />
                            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search clusters…" className="bg-transparent border-none outline-none text-[13px] font-semibold text-slate-700 w-36 placeholder:text-slate-400" />
                        </div>
                    </div>

                    {/* Cluster table */}
                    <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
                        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-100">
                            <p className="text-[13px] font-bold text-slate-700">{filtered.length} topic cluster{filtered.length !== 1 ? 's' : ''}</p>
                            <button onClick={downloadCSV} title="Download CSV" className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100"><ArrowDownTrayIcon className="w-4 h-4" /></button>
                        </div>
                        {loading ? (
                            <div className="py-16 text-center text-slate-400 text-[13px]">Loading query data…</div>
                        ) : analysed.length === 0 ? (
                            <div className="py-12 text-center">
                                <Square3Stack3DIcon className="w-10 h-10 text-slate-300 mx-auto mb-2" />
                                <p className="text-[14px] font-semibold text-slate-500">No topic clusters yet. Create your first one below.</p>
                            </div>
                        ) : (
                            <div className="overflow-x-auto">
                                <table className="w-full text-left">
                                    <thead className="bg-slate-50 border-b border-slate-100"><tr>
                                        <Th>Cluster</Th><Th right>Clicks</Th><Th right>Impressions</Th><Th right>CTR</Th><Th right>Avg Pos</Th><Th right>Keywords</Th>
                                    </tr></thead>
                                    <tbody className="divide-y divide-slate-50">
                                        {filtered.map(c => {
                                            const open = expanded.has(c.id);
                                            return (
                                                <Fragment key={c.id}>
                                                    <tr className="hover:bg-slate-50/60 cursor-pointer" onClick={() => toggle(c.id)}>
                                                        <td className="py-3.5 px-4">
                                                            <div className="flex items-center gap-2">
                                                                {open ? <ChevronDownIcon className="w-4 h-4 text-slate-400" /> : <ChevronRightIcon className="w-4 h-4 text-slate-400" />}
                                                                <div className="min-w-0">
                                                                    <p className="text-[14px] font-black text-slate-800 truncate">{c.name}</p>
                                                                    <p className="text-[11px] text-slate-400 truncate max-w-[280px]">{c.rules.join(' · ')}</p>
                                                                </div>
                                                            </div>
                                                        </td>
                                                        <td className="py-3.5 px-4 text-right"><span className="text-[14px] font-bold text-slate-800">{num(c.clicks)}</span> <Delta value={c.clicksDelta} /></td>
                                                        <td className="py-3.5 px-4 text-right"><span className="text-[14px] font-bold text-slate-700">{num(c.impressions)}</span> <Delta value={c.imprDelta} /></td>
                                                        <td className="py-3.5 px-4 text-right text-[13px] font-bold text-slate-600">{c.ctr}%</td>
                                                        <td className="py-3.5 px-4 text-right"><span className="inline-flex items-center justify-center min-w-[34px] px-2 py-0.5 rounded-full bg-amber-50 text-[12px] font-bold text-amber-700">{c.position ?? '—'}</span></td>
                                                        <td className="py-3.5 px-4 text-right"><span className="inline-flex items-center justify-center min-w-[28px] px-2 py-0.5 rounded-full bg-indigo-50 text-[12px] font-bold text-indigo-600">{c.query_count}</span></td>
                                                    </tr>
                                                    {open && (
                                                        <tr className="bg-slate-50/40"><td colSpan={6} className="px-4 py-2">
                                                            <div className="flex items-center justify-end gap-1 pb-2">
                                                                <button onClick={() => editCluster(c)} className="flex items-center gap-1 text-[12px] font-bold text-slate-500 hover:text-slate-800 px-2 py-1 rounded hover:bg-white"><PencilSquareIcon className="w-3.5 h-3.5" /> Edit</button>
                                                                <button onClick={() => deleteCluster(c.id)} className="flex items-center gap-1 text-[12px] font-bold text-rose-400 hover:text-rose-600 px-2 py-1 rounded hover:bg-white"><TrashIcon className="w-3.5 h-3.5" /> Delete</button>
                                                            </div>
                                                            {c.matched.length === 0 ? <p className="px-2 py-3 text-[13px] text-slate-400">No queries matched in this period.</p> : (
                                                                <table className="w-full text-left bg-white rounded-lg border border-slate-100">
                                                                    <thead className="text-[10px] uppercase tracking-wider text-slate-400 font-bold border-b border-slate-100"><tr>
                                                                        <th className="px-4 py-2">Query</th><th className="px-3 py-2 text-right">Position</th><th className="px-3 py-2 text-right">Clicks</th><th className="px-3 py-2 text-right">Impr.</th><th className="px-3 py-2 text-right">CTR</th>
                                                                    </tr></thead>
                                                                    <tbody className="divide-y divide-slate-50">
                                                                        {c.matched.slice(0, 100).map((q, i) => {
                                                                            const posD = q.prev_position ? Math.round((q.position - q.prev_position) * 10) / 10 : null;
                                                                            const clkD = pctChange(q.clicks, q.prev_clicks);
                                                                            return (
                                                                                <tr key={i}>
                                                                                    <td className="px-4 py-2 text-[13px] text-slate-700 truncate max-w-[360px]">{q.query}</td>
                                                                                    <td className="px-3 py-2 text-right text-[13px] font-bold text-slate-700">{q.position?.toFixed(1)} <Delta value={posD} suffix="" invert /></td>
                                                                                    <td className="px-3 py-2 text-right text-[13px] font-bold text-slate-800">{num(q.clicks)} <Delta value={clkD} /></td>
                                                                                    <td className="px-3 py-2 text-right text-[13px] text-slate-600">{num(q.impressions)}</td>
                                                                                    <td className="px-3 py-2 text-right text-[13px] text-slate-600">{q.ctr}%</td>
                                                                                </tr>
                                                                            );
                                                                        })}
                                                                    </tbody>
                                                                </table>
                                                            )}
                                                        </td></tr>
                                                    )}
                                                </Fragment>
                                            );
                                        })}
                                        {filtered.length === 0 && <tr><td colSpan={6} className="py-10 text-center text-slate-400 text-[13px]">No clusters match this filter.</td></tr>}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </div>

                    {/* Performance over time */}
                    {filtered.length > 0 && months.length > 1 && (
                        <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-5">
                            <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
                                <p className="text-[13px] font-bold text-slate-700">Cluster performance over time</p>
                                <div className="flex items-center gap-2">
                                    <div className="flex bg-slate-100 rounded-lg p-0.5">
                                        {['clicks', 'impressions'].map(m => (
                                            <button key={m} onClick={() => setChartMetric(m)} className={`px-2.5 py-1 text-[12px] font-bold rounded-md capitalize ${chartMetric === m ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500'}`}>{m}</button>
                                        ))}
                                    </div>
                                    <select value={chartCluster || ''} onChange={e => setChartCluster(e.target.value)} className="text-[12px] font-bold text-slate-700 border border-slate-200 rounded-lg px-2 py-1.5 outline-none bg-white">
                                        {filtered.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                                    </select>
                                </div>
                            </div>
                            <div style={{ width: '100%', height: 260 }}>
                                <ResponsiveContainer>
                                    <LineChart data={chartData} margin={{ top: 8, right: 16, left: -8, bottom: 4 }}>
                                        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                                        <XAxis dataKey="label" tick={{ fontSize: 12, fill: '#64748b' }} axisLine={false} tickLine={false} />
                                        <YAxis tick={{ fontSize: 12, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                                        <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e2e8f0' }} />
                                        <Line type="monotone" dataKey={chartMetric} stroke="#6366f1" strokeWidth={2.5} dot={{ r: 3 }} />
                                    </LineChart>
                                </ResponsiveContainer>
                            </div>
                        </div>
                    )}

                    {/* Monthly breakdown */}
                    {filtered.length > 0 && months.length > 1 && (
                        <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
                            <div className="flex items-center justify-between px-5 py-3 border-b border-slate-100">
                                <p className="text-[13px] font-bold text-slate-700">Monthly breakdown</p>
                                <div className="flex bg-slate-100 rounded-lg p-0.5">
                                    {['clicks', 'impressions', 'ctr', 'position'].map(m => (
                                        <button key={m} onClick={() => setTableMetric(m)} className={`px-2.5 py-1 text-[12px] font-bold rounded-md capitalize ${tableMetric === m ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500'}`}>{m === 'position' ? 'Avg Pos' : m}</button>
                                    ))}
                                </div>
                            </div>
                            <div className="overflow-x-auto">
                                <table className="w-full text-left">
                                    <thead className="bg-slate-50 border-b border-slate-100"><tr>
                                        <Th>Cluster</Th>{months.map(ym => <Th key={ym} right>{monthLabel(ym)}</Th>)}
                                    </tr></thead>
                                    <tbody className="divide-y divide-slate-50">
                                        {filtered.map(c => (
                                            <tr key={c.id} className="hover:bg-slate-50/60">
                                                <td className="py-3 px-4 text-[13px] font-bold text-slate-800 truncate max-w-[200px]">{c.name}</td>
                                                {c.monthly.map(mm => (
                                                    <td key={mm.month} className="py-3 px-4 text-right text-[13px] font-semibold text-slate-700">
                                                        {tableMetric === 'ctr' ? `${mm.ctr}%` : tableMetric === 'position' ? (mm.position ?? '—') : num(mm[tableMetric])}
                                                    </td>
                                                ))}
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    )}

                    {/* Create / edit form */}
                    <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-5">
                        <p className="text-[15px] font-black text-slate-800 mb-4">{editingId ? 'Edit cluster' : 'Create a new cluster'}</p>
                        <div className="space-y-3">
                            <input value={name} onChange={e => setName(e.target.value)} placeholder="Cluster name (e.g. 'Cleaning Robots')" className="w-full px-4 py-2.5 text-[14px] border border-slate-200 rounded-lg outline-none focus:border-emerald-400" />
                            <input value={kwText} onChange={e => setKwText(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') submit(); }} placeholder="Keywords, comma-separated (e.g. robot, หุ่นยนต์, /^clean.*bot$/)" className="w-full px-4 py-2.5 text-[14px] border border-slate-200 rounded-lg outline-none focus:border-emerald-400" />
                            <p className="text-[12px] text-slate-400">A query matches if it <span className="font-semibold">contains</span> any keyword. Wrap in <code className="bg-slate-100 px-1 rounded">/…/</code> for regex.</p>
                            <div className="flex items-center gap-2">
                                <button onClick={submit} className="flex items-center gap-1.5 px-4 py-2 text-[13px] font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg shadow-sm"><PlusIcon className="w-4 h-4" /> {editingId ? 'Update Cluster' : 'Create Cluster'}</button>
                                {editingId && <button onClick={resetForm} className="px-4 py-2 text-[13px] font-bold text-slate-500 hover:bg-slate-100 rounded-lg">Cancel</button>}
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

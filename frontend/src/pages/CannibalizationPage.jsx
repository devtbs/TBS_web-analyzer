import { useState, useEffect, useMemo, useRef, Fragment, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
    ArrowLeftIcon, ChevronDownIcon, ChevronRightIcon, ArrowPathIcon,
    ArrowDownTrayIcon, MagnifyingGlassIcon, ArrowTopRightOnSquareIcon,
    DocumentArrowUpIcon, TagIcon, AdjustmentsHorizontalIcon, CalendarDaysIcon,
    Square3Stack3DIcon, ClipboardDocumentIcon, XMarkIcon,
} from '@heroicons/react/24/outline';
import api from '../api/axios';
import toast from 'react-hot-toast';

/* ── helpers ─────────────────────────────────────────────── */
const num = (v) => (v ?? 0).toLocaleString();
const pct = (v) => `${(v ?? 0).toFixed(2)}%`;
const pos = (v) => (v == null ? '—' : Number(v).toFixed(1));

const PERIODS = [{ d: 7, l: '7 Days' }, { d: 14, l: '14 Days' }, { d: 31, l: '31 Days' }];
const THRESHOLDS = [5, 10, 15, 20, 25];

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
    try { sessionStorage.setItem(key, JSON.stringify({ ts: Date.now(), data })); } catch { }
};

const PosBadge = ({ value }) => {
    const v = Number(value);
    const tone = v <= 3 ? 'bg-emerald-100 text-emerald-700'
        : v <= 10 ? 'bg-amber-100 text-amber-700'
            : 'bg-slate-100 text-slate-500';
    return <span className={`inline-flex items-center justify-center min-w-[34px] px-2 py-0.5 rounded-full text-[12px] font-bold ${tone}`}>{pos(value)}</span>;
};

/* CSV: URL, datePublished, dateModified */
const parseDateFile = (text) => {
    const out = {};
    text.split(/\r?\n/).forEach((line, i) => {
        if (!line.trim()) return;
        const cells = line.split(',').map(c => c.trim().replace(/^"|"$/g, ''));
        const url = cells[0];
        if (!url || /^url$/i.test(url)) return; // skip header
        out[url.replace(/\/$/, '')] = { published: cells[1] || '', modified: cells[2] || '' };
    });
    return out;
};

const downloadCSV = (urls, filename) => {
    if (!urls?.length) return;
    const headers = ['competing_url', 'clicks', 'impressions', 'avg_ctr', 'avg_position', 'competing_keyword', 'kw_clicks', 'kw_impressions', 'kw_ctr', 'kw_position', 'is_top'];
    const lines = [headers.join(',')];
    urls.forEach(u => (u.keywords || []).forEach(k => {
        lines.push([
            `"${u.url}"`, u.clicks, u.impressions, u.ctr, u.position,
            `"${(k.query || '').replace(/"/g, '""')}"`, k.clicks, k.impressions, k.ctr, k.position, k.is_top,
        ].join(','));
    }));
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    document.body.appendChild(link); link.click(); document.body.removeChild(link);
};

/* ── page ────────────────────────────────────────────────── */
export default function CannibalizationPage() {
    const navigate = useNavigate();
    const [property, setProperty] = useState(localStorage.getItem('gsc_selected_property') || '');

    // filters
    const [days, setDays] = useState(14);
    const [brandInput, setBrandInput] = useState('');
    const [brands, setBrands] = useState([]);
    const [threshold, setThreshold] = useState(20);
    const [topic, setTopic] = useState(null);           // selected cluster term
    const [clusters, setClusters] = useState([]);       // topic options
    const [dateMap, setDateMap] = useState(null);       // { url: {published, modified} }
    const [dateFileName, setDateFileName] = useState('');
    const [onlyDated, setOnlyDated] = useState(false);

    // data / ui
    const [urls, setUrls] = useState([]);
    const [loading, setLoading] = useState(false);
    const [lastRun, setLastRun] = useState(null);
    const [search, setSearch] = useState('');
    const [expanded, setExpanded] = useState(() => new Set());
    const fileRef = useRef(null);

    useEffect(() => {
        const onChange = () => { setProperty(localStorage.getItem('gsc_selected_property') || ''); setUrls([]); setLastRun(null); };
        window.addEventListener('gsc_property_changed', onChange);
        return () => window.removeEventListener('gsc_property_changed', onChange);
    }, []);

    const buildUrl = useCallback(() => {
        const p = new URLSearchParams({ days: String(days), min_impressions_pct: String(threshold) });
        if (brands.length) p.set('brand', brands.join(','));
        if (topic) p.set('topic', topic);
        return `/auth/gsc/cannibalization/${encodeURIComponent(property)}?${p.toString()}`;
    }, [property, days, threshold, brands, topic]);

    const fetchData = useCallback((force = false) => {
        if (!property) return;
        const url = buildUrl();
        const cacheKey = `cannibal_url_${url}`;
        if (!force) {
            const cached = ssGet(cacheKey);
            if (cached) { setUrls(cached.urls || []); setLastRun(cached.ts || Date.now()); return; }
        }
        setLoading(true);
        api.get(url)
            .then(res => {
                const ts = Date.now();
                ssSet(cacheKey, { urls: res.data.urls, ts });
                setUrls(res.data.urls || []);
                setLastRun(ts);
                setExpanded(new Set());
            })
            .catch(err => toast.error(err.response?.data?.detail || 'Failed to load cannibalization'))
            .finally(() => setLoading(false));
    }, [property, buildUrl]);

    // initial + when property/days change, auto-run
    useEffect(() => { fetchData(false); }, [property, days]); // eslint-disable-line

    // topic clusters for the picker
    useEffect(() => {
        if (!property) return;
        const ck = `clusters_${property}_${days}`;
        const cached = ssGet(ck);
        if (cached) { setClusters(cached); return; }
        api.get(`/auth/gsc/topic-clusters/${encodeURIComponent(property)}?days=${days}`)
            .then(res => { const c = res.data.clusters || []; ssSet(ck, c); setClusters(c); })
            .catch(() => { });
    }, [property, days]);

    const addBrand = () => {
        const parts = brandInput.split(',').map(s => s.trim()).filter(Boolean);
        if (!parts.length) return;
        setBrands(prev => [...new Set([...prev, ...parts])]);
        setBrandInput('');
    };

    const onFile = (e) => {
        const f = e.target.files?.[0];
        if (!f) return;
        const reader = new FileReader();
        reader.onload = (ev) => {
            const map = parseDateFile(String(ev.target.result || ''));
            setDateMap(map);
            setDateFileName(f.name);
            toast.success(`Loaded dates for ${Object.keys(map).length} URLs`);
        };
        reader.readAsText(f);
    };

    const filtered = useMemo(() => {
        let list = urls;
        if (search.trim()) {
            const s = search.toLowerCase();
            list = list.filter(u =>
                u.url.toLowerCase().includes(s) ||
                (u.keywords || []).some(k => k.query.toLowerCase().includes(s)));
        }
        if (onlyDated && dateMap) {
            list = list.filter(u => dateMap[u.url.replace(/\/$/, '')]);
        }
        return list;
    }, [urls, search, onlyDated, dateMap]);

    const toggle = (i) => setExpanded(prev => {
        const n = new Set(prev); n.has(i) ? n.delete(i) : n.add(i); return n;
    });

    const copyUrl = (u) => { navigator.clipboard?.writeText(u); toast.success('URL copied'); };
    const dateFor = (u) => dateMap?.[u.replace(/\/$/, '')] || null;

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
                        <h1 className="text-[17px] font-black text-slate-900 leading-tight">URL Cannibalization</h1>
                        <p className="text-[11px] text-slate-400 font-medium">Identifies URLs competing against each other for the same keywords in search results.</p>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    <div className="flex items-center gap-2 px-4 h-10 bg-white border border-slate-200 rounded-lg shadow-sm hover:border-slate-300 transition-colors group">
                        <MagnifyingGlassIcon className="w-3.5 h-3.5 text-slate-400 group-hover:text-emerald-500 transition-colors" />
                        <input type="text" placeholder="Filter URL or keyword…" value={search} onChange={e => setSearch(e.target.value)}
                            className="bg-transparent border-none focus:ring-0 p-0 outline-none w-44 text-slate-800 font-bold text-[13px] placeholder:text-slate-300" />
                    </div>
                </div>
            </div>

            {!property ? (
                <div className="p-16 text-center text-slate-400 text-[14px] font-medium">
                    Select a property from the sidebar to view this report.
                </div>
            ) : (
                <div className="p-6 space-y-5">
                    {/* ── Filters card ── */}
                    <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-6 space-y-6">
                        {/* Period */}
                        <div>
                            <Label icon={CalendarDaysIcon}>Analysis Period</Label>
                            <SegTabs options={PERIODS.map(p => ({ value: p.d, label: p.l }))} value={days} onChange={setDays} />
                        </div>

                        {/* Brand keywords */}
                        <div>
                            <Label icon={TagIcon} optional>Brand Keywords</Label>
                            <p className="text-[12px] text-slate-400 mb-2">Exclude queries containing these brand terms. Multiple rankings for branded queries are often expected.</p>
                            <div className="flex items-center gap-2">
                                <input value={brandInput} onChange={e => setBrandInput(e.target.value)}
                                    onKeyDown={e => e.key === 'Enter' && addBrand()}
                                    placeholder="e.g., Nike, Adidas"
                                    className="flex-1 px-3 py-2 border border-slate-200 rounded-lg text-[13px] text-slate-800 focus:ring-1 focus:ring-emerald-400 focus:border-emerald-400 outline-none" />
                                <button onClick={addBrand}
                                    className="px-4 py-2 text-[13px] font-semibold text-slate-600 bg-slate-100 rounded-lg hover:bg-slate-200 transition-colors">+ Add</button>
                            </div>
                            {brands.length > 0 && (
                                <div className="flex flex-wrap gap-1.5 mt-2">
                                    {brands.map(b => (
                                        <span key={b} className="inline-flex items-center gap-1 pl-2.5 pr-1.5 py-1 bg-emerald-50 text-emerald-700 rounded-full text-[12px] font-semibold">
                                            {b}
                                            <button onClick={() => setBrands(brands.filter(x => x !== b))} className="hover:text-emerald-900">
                                                <XMarkIcon className="w-3.5 h-3.5" />
                                            </button>
                                        </span>
                                    ))}
                                </div>
                            )}
                        </div>

                        {/* Threshold */}
                        <div>
                            <Label icon={AdjustmentsHorizontalIcon}>Min Impression Threshold</Label>
                            <p className="text-[12px] text-slate-400 mb-2">Only show URLs as cannibalizing if they have at least this percentage of impressions compared to the top URL</p>
                            <SegTabs options={THRESHOLDS.map(t => ({ value: t, label: `${t}%` }))} value={threshold} onChange={setThreshold} />
                        </div>

                        {/* Topic cluster */}
                        <div>
                            <Label icon={Square3Stack3DIcon} optional>Topic Cluster</Label>
                            <p className="text-[12px] text-slate-400 mb-2">Only show cannibalization for queries matching a specific topic cluster</p>
                            <div className="flex flex-wrap gap-2">
                                <ClusterChip active={!topic} onClick={() => setTopic(null)} label="All Queries" />
                                {clusters.slice(0, 14).map(c => (
                                    <ClusterChip key={c.topic} active={topic === c.topic} onClick={() => setTopic(c.topic)}
                                        label={c.topic} count={c.query_count} />
                                ))}
                            </div>
                        </div>

                        {/* Date file */}
                        <div>
                            <Label icon={DocumentArrowUpIcon} optional>Upload Date File</Label>
                            <p className="text-[12px] text-slate-400 mb-2">Upload a comma separated CSV / TXT with URL dates (URL, datePublished, dateModified) to display and filter in results</p>
                            <div className="flex items-center gap-3">
                                <input ref={fileRef} type="file" accept=".csv,.txt" onChange={onFile} className="hidden" />
                                <button onClick={() => fileRef.current?.click()}
                                    className="inline-flex items-center gap-1.5 px-3 py-2 text-[13px] font-semibold text-slate-600 bg-slate-100 rounded-lg hover:bg-slate-200 transition-colors">
                                    <DocumentArrowUpIcon className="w-4 h-4" /> Choose File
                                </button>
                                {dateFileName && (
                                    <span className="text-[12px] text-slate-500 font-medium">{dateFileName}</span>
                                )}
                                {dateMap && (
                                    <label className="inline-flex items-center gap-1.5 text-[12px] text-slate-500 font-medium cursor-pointer">
                                        <input type="checkbox" checked={onlyDated} onChange={e => setOnlyDated(e.target.checked)}
                                            className="rounded border-slate-300 text-emerald-500 focus:ring-emerald-400" />
                                        Only URLs in file
                                    </label>
                                )}
                            </div>
                        </div>
                    </div>

                    {/* ── Results card ── */}
                    <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
                        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-100">
                            <div className="flex items-center gap-2 text-[13px]">
                                <span className="font-bold text-slate-800">
                                    {loading ? 'Analyzing…' : `${filtered.length} URLs with competing keywords`}
                                </span>
                                {lastRun && !loading && (
                                    <span className="text-[12px] text-slate-400">Last run: {new Date(lastRun).toLocaleString()}</span>
                                )}
                            </div>
                            <div className="flex items-center gap-2">
                                <button onClick={() => fetchData(true)} disabled={loading}
                                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-semibold text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors disabled:opacity-60">
                                    <ArrowPathIcon className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} /> Re-run
                                </button>
                                <button onClick={() => downloadCSV(filtered, 'url-cannibalization.csv')} disabled={!filtered.length}
                                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-semibold text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors disabled:opacity-60">
                                    <ArrowDownTrayIcon className="w-3.5 h-3.5" /> Export CSV
                                </button>
                            </div>
                        </div>

                        <div className="overflow-x-auto">
                            <table className="w-full text-left whitespace-nowrap">
                                <thead className="bg-slate-50 border-b border-slate-100 text-[11px] font-bold uppercase tracking-wider text-slate-400">
                                    <tr>
                                        <th className="py-3 px-2 w-8" />
                                        <th className="py-3 px-4">Competing URL</th>
                                        <th className="py-3 px-4 text-right">Clicks</th>
                                        <th className="py-3 px-4 text-right">Impressions</th>
                                        <th className="py-3 px-4 text-right">Avg CTR</th>
                                        <th className="py-3 px-4 text-center">Avg Position</th>
                                        <th className="py-3 px-4 text-right">Competing</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-50">
                                    {loading ? (
                                        Array.from({ length: 10 }).map((_, i) => (
                                            <tr key={i}>
                                                {Array.from({ length: 7 }).map((_, j) => (
                                                    <td key={j} className="py-3.5 px-4">
                                                        <div className="h-3 bg-slate-100 rounded animate-pulse" style={{ width: j === 1 ? '60%' : '40px' }} />
                                                    </td>
                                                ))}
                                            </tr>
                                        ))
                                    ) : filtered.length === 0 ? (
                                        <tr><td colSpan={7} className="py-16 text-center text-slate-400 text-[14px]">
                                            No cannibalization found for these settings — each keyword is handled by a single page. 👍
                                        </td></tr>
                                    ) : filtered.map((u, idx) => {
                                        const isOpen = expanded.has(idx);
                                        const d = dateFor(u.url);
                                        return (
                                            <Fragment key={u.url}>
                                                <motion.tr
                                                    initial={{ opacity: 0, y: 3 }} animate={{ opacity: 1, y: 0 }}
                                                    transition={{ duration: 0.1, delay: Math.min(idx * 0.012, 0.3) }}
                                                    className="hover:bg-slate-50/60 transition-colors cursor-pointer"
                                                    onClick={() => toggle(idx)}>
                                                    <td className="py-3.5 px-2 text-slate-400">
                                                        {isOpen ? <ChevronDownIcon className="w-4 h-4" /> : <ChevronRightIcon className="w-4 h-4" />}
                                                    </td>
                                                    <td className="py-3.5 px-4">
                                                        <div className="flex items-center gap-1.5">
                                                            <a href={u.url} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()}
                                                                className="text-slate-400 hover:text-emerald-600 flex-shrink-0">
                                                                <ArrowTopRightOnSquareIcon className="w-3.5 h-3.5" />
                                                            </a>
                                                            <span className="text-[13px] font-semibold text-slate-700 truncate max-w-[420px]" title={u.url}>{u.url}</span>
                                                            <button onClick={e => { e.stopPropagation(); copyUrl(u.url); }}
                                                                className="text-slate-300 hover:text-slate-500 flex-shrink-0">
                                                                <ClipboardDocumentIcon className="w-3.5 h-3.5" />
                                                            </button>
                                                            {d && (
                                                                <span className="ml-1 text-[10px] text-slate-400 font-medium flex-shrink-0">
                                                                    {d.modified || d.published ? `upd ${d.modified || d.published}` : ''}
                                                                </span>
                                                            )}
                                                        </div>
                                                    </td>
                                                    <td className="py-3.5 px-4 text-right text-[13px] font-bold text-slate-800">{num(u.clicks)}</td>
                                                    <td className="py-3.5 px-4 text-right text-[13px] font-bold text-slate-700">{num(u.impressions)}</td>
                                                    <td className="py-3.5 px-4 text-right text-[13px] font-semibold text-slate-600">{pct(u.ctr)}</td>
                                                    <td className="py-3.5 px-4 text-center"><PosBadge value={u.position} /></td>
                                                    <td className="py-3.5 px-4 text-right">
                                                        <span className="inline-flex items-center px-2.5 py-1 rounded-full bg-amber-50 text-amber-700 text-[12px] font-bold">
                                                            {u.competing_count} keyword{u.competing_count > 1 ? 's' : ''}
                                                        </span>
                                                    </td>
                                                </motion.tr>
                                                {isOpen && (
                                                    <tr className="bg-slate-50/40">
                                                        <td colSpan={7} className="px-10 py-3">
                                                            <table className="w-full text-left">
                                                                <thead className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                                                                    <tr>
                                                                        <th className="py-1.5 pr-4">Competing Keyword</th>
                                                                        <th className="py-1.5 px-3 text-right">Clicks</th>
                                                                        <th className="py-1.5 px-3 text-right">Impr</th>
                                                                        <th className="py-1.5 px-3 text-right">CTR</th>
                                                                        <th className="py-1.5 px-3 text-center">Position</th>
                                                                        <th className="py-1.5 px-3 text-center">Pages</th>
                                                                    </tr>
                                                                </thead>
                                                                <tbody>
                                                                    {u.keywords.map((k, ki) => (
                                                                        <tr key={ki} className="border-t border-slate-100">
                                                                            <td className="py-1.5 pr-4 text-[12px] text-slate-600">
                                                                                {k.query}
                                                                                {k.is_top && <span className="ml-2 text-[10px] font-bold text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded">top</span>}
                                                                            </td>
                                                                            <td className="py-1.5 px-3 text-right text-[12px] font-semibold text-slate-700">{num(k.clicks)}</td>
                                                                            <td className="py-1.5 px-3 text-right text-[12px] text-slate-500">{num(k.impressions)}</td>
                                                                            <td className="py-1.5 px-3 text-right text-[12px] text-slate-500">{pct(k.ctr)}</td>
                                                                            <td className="py-1.5 px-3 text-center"><PosBadge value={k.position} /></td>
                                                                            <td className="py-1.5 px-3 text-center text-[12px] font-bold text-rose-600">{k.competing_urls}</td>
                                                                        </tr>
                                                                    ))}
                                                                </tbody>
                                                            </table>
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
        </div>
    );
}

/* ── small UI bits ──────────────────────────────────────── */
function Label({ icon: Icon, children, optional }) {
    return (
        <div className="flex items-center gap-1.5 mb-1">
            {Icon && <Icon className="w-4 h-4 text-slate-500" />}
            <span className="text-[13px] font-bold text-slate-800">{children}</span>
            {optional && <span className="text-[12px] text-slate-400 font-medium">(Optional)</span>}
        </div>
    );
}

function SegTabs({ options, value, onChange }) {
    return (
        <div className="flex bg-slate-100 rounded-lg p-1">
            {options.map(o => (
                <button key={o.value} onClick={() => onChange(o.value)}
                    className={`flex-1 px-4 py-2 text-[13px] font-semibold rounded-md transition-all ${value === o.value ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
                    {o.label}
                </button>
            ))}
        </div>
    );
}

function ClusterChip({ active, onClick, label, count }) {
    return (
        <button onClick={onClick}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-semibold transition-colors ${active ? 'bg-emerald-700 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
            {!active && count != null && <Square3Stack3DIcon className="w-3.5 h-3.5 text-slate-400" />}
            {label}
            {count != null && (
                <span className={`text-[11px] font-bold ${active ? 'text-emerald-200' : 'text-slate-400'}`}>{count}</span>
            )}
        </button>
    );
}

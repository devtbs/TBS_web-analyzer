import { useState, useEffect, useCallback, Fragment } from 'react';
import { useSearchParams } from 'react-router-dom';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { ArrowTrendingUpIcon, ArrowPathIcon, PlusIcon, TrashIcon, GlobeAltIcon, ChevronDownIcon, ChevronUpIcon } from '@heroicons/react/24/outline';
import toast from 'react-hot-toast';
import api from '../api/axios';
import Favicon from '../components/ui/Favicon';

/* Self-hosted keyword rank tracker — daily Google positions from our own SerpAPI (replaces SE Ranking). */

const COUNTRIES = [
    { label: 'Thailand', gl: 'th', locId: 2764 }, { label: 'United States', gl: 'us', locId: 2840 },
    { label: 'United Kingdom', gl: 'uk', locId: 2826 }, { label: 'Australia', gl: 'au', locId: 2036 },
    { label: 'Singapore', gl: 'sg', locId: 2702 }, { label: 'Malaysia', gl: 'my', locId: 2458 },
    { label: 'Japan', gl: 'jp', locId: 2392 }, { label: 'India', gl: 'in', locId: 2356 },
];
const bareDomain = (u) => (u || '').replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '');
const posColor = (p) => p == null ? 'text-slate-300' : p <= 3 ? 'text-emerald-600' : p <= 10 ? 'text-teal-600' : p <= 20 ? 'text-amber-600' : 'text-slate-500';

// Tiny inline sparkline (positions; lower = better, so we invert the Y axis).
const Spark = ({ data }) => {
    const pts = (data || []).map((v, i) => ({ i, v: v == null ? null : v }));
    if (pts.filter(p => p.v != null).length < 2) return <span className="text-slate-300 text-[11px]">—</span>;
    return (
        <ResponsiveContainer width={90} height={28}>
            <LineChart data={pts}>
                <YAxis hide domain={[1, 'dataMax']} reversed />
                <Line type="monotone" dataKey="v" stroke="#0d9488" strokeWidth={1.5} dot={false} isAnimationActive={false} connectNulls />
            </LineChart>
        </ResponsiveContainer>
    );
};

export default function RankTracker() {
    const [params] = useSearchParams();
    const clientId = params.get('client');

    const [rows, setRows] = useState([]);
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState(false);
    const [countryGl, setCountryGl] = useState('th');
    const [domain, setDomain] = useState('');
    const [kwText, setKwText] = useState('');
    const [openId, setOpenId] = useState(null);
    const [historyData, setHistoryData] = useState(null);

    const country = COUNTRIES.find(c => c.gl === countryGl) || COUNTRIES[0];

    const load = useCallback(async () => {
        try {
            const res = await api.get('/api/ranktracker/keywords', { params: clientId ? { client_id: clientId } : {} });
            setRows(res.data.keywords || []);
        } catch { toast.error('Could not load tracked keywords'); }
        finally { setLoading(false); }
    }, [clientId]);

    useEffect(() => { load(); }, [load]);
    // Prefill the domain box from whatever is already tracked (so "add" targets the same site).
    useEffect(() => { if (!domain && rows.length) setDomain(rows[0].domain); }, [rows]);   // eslint-disable-line

    const addKeywords = async () => {
        const keywords = kwText.split('\n').map(s => s.trim()).filter(Boolean);
        const d = bareDomain(domain.trim());
        if (!d) { toast.error('Enter the site domain to track'); return; }
        if (!keywords.length) { toast.error('Enter at least one keyword'); return; }
        setBusy(true);
        try {
            const res = await api.post('/api/ranktracker/keywords', {
                keywords, domain: d, client_id: clientId, gl: country.gl, location_id: country.locId,
            });
            const { added = 0, skipped = [], warnings = [], duplicates = 0 } = res.data;
            if (added) toast.success(`Added ${added} keyword${added !== 1 ? 's' : ''}`);
            if (duplicates) toast(`${duplicates} already tracked`);
            // Say WHY anything was rejected — a silent count taught users nothing, which is how
            // operators and fragments ended up costing a SerpAPI credit a day.
            skipped.forEach(k => toast.error(`Skipped "${k.keyword}" — ${k.reason}`, { duration: 6000 }));
            warnings.forEach(k => toast(`Added "${k.keyword}" — ${k.reason}`, { icon: '⚠️', duration: 6000 }));
            if (!added && !skipped.length && !duplicates) toast('Nothing added');
            setKwText('');
            await load();
        } catch (e) { toast.error(e.response?.data?.detail || 'Could not add keywords'); }
        finally { setBusy(false); }
    };

    // Review the EXISTING list: validation only guards new additions, so anything added before it
    // existed (or that has simply never ranked) still burns a SerpAPI credit every day.
    const [auditData, setAuditData] = useState(null);
    const [auditing, setAuditing] = useState(false);
    const runAudit = async () => {
        setAuditing(true);
        try {
            const { data } = await api.get('/api/ranktracker/audit', {
                params: clientId ? { client_id: clientId } : {},
            });
            setAuditData(data);
            if (!data.invalid.length && !data.stale.length) toast.success('Nothing to prune — the list is clean');
        } catch { toast.error('Could not review keywords'); }
        finally { setAuditing(false); }
    };
    const pruneIds = async (ids) => {
        if (!ids.length) return;
        setBusy(true);
        try {
            const { data } = await api.post('/api/ranktracker/keywords/bulk-delete', { ids });
            toast.success(`Removed ${data.deleted} keyword${data.deleted !== 1 ? 's' : ''}`);
            setAuditData(null);
            await load();
        } catch { toast.error('Could not remove keywords'); }
        finally { setBusy(false); }
    };

    const refresh = async () => {
        setBusy(true);
        try {
            const res = await api.post('/api/ranktracker/refresh', null, { params: clientId ? { client_id: clientId } : {} });
            toast.success(`Checked ${res.data.checked} keyword${res.data.checked !== 1 ? 's' : ''}`);
            await load();
        } catch { toast.error('Refresh failed'); } finally { setBusy(false); }
    };

    const remove = async (id) => {
        try { await api.delete(`/api/ranktracker/keywords/${id}`); setRows(rows.filter(r => r.id !== id)); if (openId === id) setOpenId(null); }
        catch { toast.error('Delete failed'); }
    };

    const openHistory = async (id) => {
        if (openId === id) { setOpenId(null); return; }
        setOpenId(id); setHistoryData(null);
        try { setHistoryData((await api.get(`/api/ranktracker/keywords/${id}/history`, { params: { days: 90 } })).data); }
        catch { toast.error('Could not load history'); }
    };

    const Delta = ({ d }) => {
        if (d == null || d === 0) return <span className="text-slate-300">—</span>;
        const up = d > 0;
        return <span className={up ? 'text-emerald-600' : 'text-red-500'}>{up ? '▲' : '▼'} {Math.abs(d)}</span>;
    };

    return (
        <div className="max-w-[1100px] mx-auto px-4 sm:px-6 py-8">
            <div className="flex items-center justify-between gap-3 mb-6 flex-wrap">
                <div className="flex items-center gap-2">
                    <ArrowTrendingUpIcon className="w-6 h-6 text-teal-600" />
                    <h1 className="text-[22px] font-black text-slate-800">Rank Tracker</h1>
                </div>
                <div className="flex items-center gap-2">
                    <button onClick={runAudit} disabled={auditing || !rows.length}
                        className="px-4 py-2 border border-slate-300 text-slate-600 rounded-lg font-bold text-[14px] disabled:opacity-50 hover:bg-slate-50">
                        {auditing ? 'Reviewing…' : 'Review list'}
                    </button>
                    <button onClick={refresh} disabled={busy || !rows.length}
                        className="flex items-center gap-2 px-4 py-2 bg-[#26397A] text-white rounded-lg font-bold text-[14px] disabled:opacity-50">
                        <ArrowPathIcon className={`w-4 h-4 ${busy ? 'animate-spin' : ''}`} /> Check now
                    </button>
                </div>
            </div>

            {/* Prune panel — only appears once a review has found something */}
            {auditData && (auditData.invalid.length > 0 || auditData.stale.length > 0) && (
                <div className="bg-amber-50 border border-amber-200 rounded-2xl p-5 mb-6">
                    <div className="flex items-start justify-between gap-3 flex-wrap">
                        <div>
                            <p className="text-[14px] font-bold text-amber-900">
                                {auditData.invalid.length + auditData.stale.length} of {auditData.total} keywords are dead weight
                            </p>
                            <p className="text-[12px] text-amber-700 mt-0.5">
                                Costing {auditData.wasted_searches_per_day} SerpAPI search{auditData.wasted_searches_per_day !== 1 ? 'es' : ''} a day
                                {' '}(~{auditData.wasted_searches_per_month}/month) and skewing your ranking stats.
                            </p>
                        </div>
                        <div className="flex gap-2">
                            <button onClick={() => setAuditData(null)}
                                className="px-3 py-2 text-[13px] font-semibold text-amber-800 hover:underline">Dismiss</button>
                            <button onClick={() => pruneIds([...auditData.invalid, ...auditData.stale].map(k => k.id))}
                                disabled={busy}
                                className="px-4 py-2 bg-amber-600 text-white rounded-lg font-bold text-[13px] disabled:opacity-50">
                                Remove all
                            </button>
                        </div>
                    </div>
                    <div className="mt-3 space-y-1.5 max-h-56 overflow-y-auto">
                        {[...auditData.invalid, ...auditData.stale].map(k => (
                            <div key={k.id} className="flex items-center justify-between gap-3 bg-white/70 rounded-lg px-3 py-1.5">
                                <span className="text-[13px] font-semibold text-slate-800 truncate">{k.keyword}</span>
                                <span className="text-[11px] text-slate-500 truncate flex-1 text-right">{k.reason}</span>
                                <button onClick={() => pruneIds([k.id])} disabled={busy}
                                    className="text-[11px] font-bold text-red-600 hover:underline shrink-0">Remove</button>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Add keywords */}
            <div className="bg-white border border-slate-200 rounded-2xl p-5 mb-6">
                <p className="text-[14px] font-bold text-slate-700 mb-3">Track keywords</p>
                <div className="flex flex-col sm:flex-row gap-3">
                    <div className="flex-1">
                        <textarea value={kwText} onChange={e => setKwText(e.target.value)} rows={4}
                            placeholder="One keyword per line&#10;wine tasting bangkok&#10;wset course"
                            className="w-full border border-slate-300 rounded-lg px-3 py-2 text-[14px] outline-none focus:ring-2 focus:ring-emerald-500/30" />
                    </div>
                    <div className="sm:w-[280px] flex flex-col gap-2">
                        <div className="relative">
                            <GlobeAltIcon className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                            <input value={domain} onChange={e => setDomain(e.target.value)} placeholder="site domain (e.g. wsa-bangkok.com)"
                                className="w-full pl-9 pr-3 py-2 border border-slate-300 rounded-lg text-[14px] outline-none focus:ring-2 focus:ring-emerald-500/30" />
                        </div>
                        <select value={countryGl} onChange={e => setCountryGl(e.target.value)}
                            className="border border-slate-300 rounded-lg px-2 py-2 text-[14px] font-semibold text-slate-700 outline-none">
                            {COUNTRIES.map(c => <option key={c.gl} value={c.gl}>{c.label}</option>)}
                        </select>
                        <button onClick={addKeywords} disabled={busy}
                            className="flex items-center justify-center gap-2 px-4 py-2 bg-emerald-600 text-white rounded-lg font-bold text-[14px] disabled:opacity-60">
                            <PlusIcon className="w-4 h-4" /> Add & track
                        </button>
                    </div>
                </div>
                <p className="text-[12px] text-slate-400 mt-2">Each keyword costs 1 SerpAPI search per check. Positions update daily (06:00) and on “Check now”.</p>
            </div>

            {/* Table */}
            {loading ? (
                <div className="text-center py-16 text-slate-400">Loading…</div>
            ) : rows.length === 0 ? (
                <div className="text-center py-16 text-slate-400 bg-white border border-slate-200 rounded-2xl text-[14px]">
                    No keywords tracked yet — add some above to start monitoring positions.
                </div>
            ) : (
                <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
                    <table className="w-full text-[13px]">
                        <thead className="bg-slate-50"><tr className="text-[11px] uppercase text-slate-400">
                            <th className="text-left py-2.5 px-4 font-bold">Keyword</th>
                            <th className="text-right py-2.5 px-2 font-bold">Position</th>
                            <th className="text-right py-2.5 px-2 font-bold">Change</th>
                            <th className="text-right py-2.5 px-2 font-bold">Best</th>
                            <th className="text-center py-2.5 px-2 font-bold">Trend</th>
                            <th className="py-2.5 px-2"></th>
                        </tr></thead>
                        <tbody>
                            {rows.map(r => (
                                <Fragment key={r.id}>
                                <tr className="border-t border-slate-100 hover:bg-slate-50">
                                    <td className="py-2.5 px-4">
                                        <button onClick={() => openHistory(r.id)} className="flex items-center gap-2 text-left">
                                            <Favicon url={`https://${r.domain}/`} size={16} className="rounded" />
                                            <span className="font-semibold text-slate-800">{r.keyword}</span>
                                            {openId === r.id ? <ChevronUpIcon className="w-3.5 h-3.5 text-slate-400" /> : <ChevronDownIcon className="w-3.5 h-3.5 text-slate-400" />}
                                        </button>
                                        {r.url && <a href={r.url} target="_blank" rel="noreferrer" className="block text-[11px] text-slate-400 truncate max-w-[380px] ml-6 hover:underline">{r.url}</a>}
                                    </td>
                                    <td className={`py-2.5 px-2 text-right font-black tabular-nums ${posColor(r.position)}`}>{r.position == null ? '>100' : r.position}</td>
                                    <td className="py-2.5 px-2 text-right font-bold tabular-nums"><Delta d={r.delta} /></td>
                                    <td className="py-2.5 px-2 text-right text-slate-500 tabular-nums">{r.best ?? '—'}</td>
                                    <td className="py-2.5 px-2"><div className="flex justify-center"><Spark data={r.sparkline} /></div></td>
                                    <td className="py-2.5 px-2 text-right"><button onClick={() => remove(r.id)} className="text-slate-300 hover:text-red-500"><TrashIcon className="w-4 h-4" /></button></td>
                                </tr>
                                {openId === r.id && (
                                    <tr className="bg-slate-50/60">
                                        <td colSpan={6} className="px-6 py-4">
                                            {!historyData ? <div className="text-slate-400 text-[13px]">Loading history…</div> : (
                                                <div style={{ height: 200 }}>
                                                    <ResponsiveContainer width="100%" height="100%">
                                                        <LineChart data={(historyData.series || []).map(s => ({ date: s.date.slice(5), position: s.position }))}>
                                                            <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                                                            <YAxis reversed domain={[1, 'dataMax']} tick={{ fontSize: 11 }} allowDecimals={false} />
                                                            <Tooltip formatter={(v) => v == null ? '>100' : `#${v}`} />
                                                            <Line type="monotone" dataKey="position" stroke="#0d9488" strokeWidth={2} dot={{ r: 2 }} connectNulls />
                                                        </LineChart>
                                                    </ResponsiveContainer>
                                                </div>
                                            )}
                                        </td>
                                    </tr>
                                )}
                                </Fragment>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
}

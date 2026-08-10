import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { AreaChart, Area, ResponsiveContainer } from 'recharts';
import { MagnifyingGlassIcon, ArrowPathIcon, ExclamationTriangleIcon,
         ChartPieIcon, MegaphoneIcon } from '@heroicons/react/24/outline';
import toast from 'react-hot-toast';
import api from '../api/axios';
import Favicon from '../components/ui/Favicon';
import { propertyMeta } from '../utils/propertyMeta';
import { sseStream } from '../utils/sseFetch';
import { Delta, fmt, needsAttention, EditDrawer } from '../components/clients/clientUI';

function ClientCard({ c, onOpen, onEdit }) {
    const spark = (c.sparkline || []).map((v, i) => ({ i, v }));
    const flag = needsAttention(c);
    const meta = propertyMeta(c.gsc_property);
    return (
        <div className={`bg-white rounded-2xl border shadow-sm flex flex-col relative transition-shadow hover:shadow-md ${
            flag ? 'border-red-300' : 'border-slate-200/80'}`}>
            <button onClick={() => onEdit(c)} title="Edit client"
                className="absolute top-3 right-3 z-10 w-7 h-7 rounded-lg flex items-center justify-center text-slate-400 hover:bg-slate-100 hover:text-slate-600">⋯</button>
            <button onClick={() => onOpen(c)} className="text-left flex flex-col flex-1 outline-none">
                <div className="px-5 pt-5 pb-4 flex items-center gap-3 min-w-0 border-b border-slate-100/60">
                    <Favicon url={c.gsc_property} label={c.domain || c.name} size={32} className="rounded-lg shrink-0" />
                    <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5 min-w-0">
                            <p className="font-bold text-slate-800 text-[15px] truncate">{c.name}</p>
                            {meta.tag && (
                                <span className={`shrink-0 px-1.5 py-0.5 rounded-md text-[9px] font-bold uppercase tracking-wide ${meta.tagCls}`}
                                      title={c.gsc_property}>{meta.tag}</span>
                            )}
                        </div>
                        <div className="flex items-center gap-2 mt-0.5">
                            {c.ga4_property_id && <ChartPieIcon className="w-3.5 h-3.5 text-slate-400" title="GA4 linked" />}
                            {c.ads_customer_id && <MegaphoneIcon className="w-3.5 h-3.5 text-slate-400" title="Google Ads linked" />}
                            <span className="text-[12px] text-slate-400 truncate">{meta.text || c.domain}</span>
                        </div>
                    </div>
                    {flag && <ExclamationTriangleIcon className="w-5 h-5 text-red-500 shrink-0" title="Needs attention" />}
                </div>

                {c.error ? (
                    <div className="px-5 py-8 text-center text-[13px] text-red-500">{c.error}</div>
                ) : (
                    <>
                        <div className="px-5 pt-4 pb-2 space-y-2.5">
                            <div className="flex items-center justify-between">
                                <span className="text-[13px] text-slate-500">Clicks</span>
                                <span className="flex items-center gap-2">
                                    <span className="text-[14px] font-bold text-slate-800">{fmt(c.totals?.clicks)}</span>
                                    <Delta value={c.deltas?.clicks} />
                                </span>
                            </div>
                            <div className="flex items-center justify-between">
                                <span className="text-[13px] text-slate-500">Impressions</span>
                                <span className="flex items-center gap-2">
                                    <span className="text-[14px] font-bold text-slate-800">{fmt(c.totals?.impressions)}</span>
                                    <Delta value={c.deltas?.impressions} />
                                </span>
                            </div>
                        </div>
                        <div className="h-[64px] px-2 pb-3">
                            {spark.length > 1 ? (
                                <ResponsiveContainer width="100%" height="100%">
                                    <AreaChart data={spark} margin={{ top: 6, right: 4, bottom: 0, left: 4 }}>
                                        <defs>
                                            <linearGradient id={`g-${c.client_id}`} x1="0" y1="0" x2="0" y2="1">
                                                <stop offset="0%" stopColor="#10b981" stopOpacity={0.3} />
                                                <stop offset="100%" stopColor="#10b981" stopOpacity={0} />
                                            </linearGradient>
                                        </defs>
                                        <Area type="monotone" dataKey="v" stroke="#10b981" strokeWidth={2}
                                              fill={`url(#g-${c.client_id})`} />
                                    </AreaChart>
                                </ResponsiveContainer>
                            ) : <div className="h-full" />}
                        </div>
                    </>
                )}
            </button>
        </div>
    );
}

export default function Clients() {
    const navigate = useNavigate();
    const [clients, setClients] = useState([]);
    const [loading, setLoading] = useState(true);
    const [total, setTotal] = useState(0);          // expected card count (for the skeleton grid)
    const [search, setSearch] = useState('');
    const [editing, setEditing] = useState(null);
    const [refreshing, setRefreshing] = useState(false);

    // Stream the portfolio so cards paint as each client resolves instead of blocking on the slowest.
    const load = async () => {
        setLoading(true);
        setClients([]);
        setTotal(0);
        let seeded = false;
        const runStream = async () => {
            await sseStream('/api/clients/overview/stream', async (type, data) => {
                if (type === 'start') {
                    setTotal(data.total || 0);
                    // First-ever load: no clients yet → seed from GSC, then re-open the stream.
                    if (!data.total && !seeded) {
                        seeded = true;
                        await api.post('/api/clients/autoseed');
                        await runStream();
                    }
                } else if (type === 'client') {
                    setClients(cs => [...cs, data]);
                } else if (type === 'done') {
                    setLoading(false);
                }
            });
        };
        try { await runStream(); }
        catch { toast.error('Could not load clients'); setLoading(false); }
    };
    useEffect(() => { load(); }, []);

    const refresh = async () => {
        setRefreshing(true);
        try { await api.post('/api/clients/autoseed'); await load(); }
        finally { setRefreshing(false); }
    };

    // Card → the client detail hub (which then links out to each deep-dive).
    const open = (c) => { navigate(`/clients/${c.client_id}`); };
    const onSaved = (updated, archivedId) => {
        setEditing(null);
        if (archivedId) setClients(cs => cs.filter(c => c.client_id !== archivedId));
        else if (updated) setClients(cs => cs.map(c => c.client_id === updated.id ? { ...c, ...updated, client_id: updated.id } : c));
    };

    const filtered = useMemo(() => {
        const list = clients;
        const q = search.trim().toLowerCase();
        const rows = q ? list.filter(c => (c.name + ' ' + (c.domain || '')).toLowerCase().includes(q)) : list;
        // Attention first, then by clicks desc so the active book surfaces above the long tail.
        return [...rows].sort((a, b) =>
            (needsAttention(b) - needsAttention(a)) || ((b.totals?.clicks || 0) - (a.totals?.clicks || 0)));
    }, [clients, search]);

    return (
        <div className="max-w-[1400px] mx-auto px-6 py-8">
            <div className="flex items-center gap-4 mb-6 flex-wrap">
                <h1 className="text-2xl font-bold text-slate-800">Clients</h1>
                <span className="text-sm text-slate-400">
                    {loading && total ? `${clients.length} / ${total}` : `${clients.length} total`}
                </span>
                <div className="relative ml-auto">
                    <MagnifyingGlassIcon className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search clients…"
                        className="pl-9 pr-3 py-2 border border-slate-300 rounded-lg text-[14px] w-56 outline-none focus:ring-2 focus:ring-emerald-500/30" />
                </div>
                <button onClick={refresh} disabled={refreshing}
                    className="flex items-center gap-2 px-3 py-2 border border-slate-300 rounded-lg text-[14px] font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-60">
                    <ArrowPathIcon className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} /> Sync
                </button>
            </div>

            {loading && clients.length === 0 ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
                    {Array.from({ length: Math.min(total || 6, 12) }).map((_, i) => (
                        <div key={i} className="bg-white rounded-2xl border border-slate-200/80 h-[240px] animate-pulse" style={{ animationDelay: `${i * 60}ms` }} />
                    ))}
                </div>
            ) : !loading && filtered.length === 0 ? (
                <div className="text-center py-20 text-slate-400">
                    {search ? `No clients match "${search}"` : 'No clients yet — click Sync to import from Search Console.'}
                </div>
            ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
                    {filtered.map(c => <ClientCard key={c.client_id} c={c} onOpen={open} onEdit={setEditing} />)}
                    {/* Trailing skeletons for clients still streaming in. */}
                    {loading && !search && Array.from({ length: Math.max(0, Math.min((total || 0) - clients.length, 6)) }).map((_, i) => (
                        <div key={`sk-${i}`} className="bg-white rounded-2xl border border-slate-200/80 h-[240px] animate-pulse" style={{ animationDelay: `${i * 60}ms` }} />
                    ))}
                </div>
            )}

            {editing && <EditDrawer client={{ ...editing, id: editing.client_id }} onClose={() => setEditing(null)} onSaved={onSaved} />}
        </div>
    );
}

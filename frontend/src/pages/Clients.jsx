import { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { AreaChart, Area, ResponsiveContainer } from 'recharts';
import { MagnifyingGlassIcon, ArrowPathIcon, ExclamationTriangleIcon,
         ChartPieIcon, MegaphoneIcon, ArrowUpRightIcon, Squares2X2Icon } from '@heroicons/react/24/outline';
import toast from 'react-hot-toast';
import api from '../api/axios';
import Favicon from '../components/ui/Favicon';
import { propertyMeta } from '../utils/propertyMeta';
import { sseStream } from '../utils/sseFetch';
import { Delta, fmt, needsAttention, EditDrawer } from '../components/clients/clientUI';

function ClientCard({ c, onEdit }) {
    const spark = (c.sparkline || []).map((v, i) => ({ i, v }));
    const flag = needsAttention(c);
    const meta = propertyMeta(c.gsc_property);
    return (
        <div className={`bg-white rounded-2xl border shadow-sm flex flex-col relative transition-shadow hover:shadow-md ${
            flag ? 'border-amber-200' : 'border-slate-200/80'}`}>
            <button onClick={() => onEdit(c)} title="Edit client" aria-label={`Edit ${c.name}`}
                className="absolute top-4 right-4 z-10 w-8 h-8 rounded-lg flex items-center justify-center text-slate-400 hover:bg-slate-100 hover:text-slate-600">⋯</button>
            <div className="text-left flex flex-col flex-1">
                <div className="pl-5 pr-14 pt-5 pb-4 flex items-center gap-3 min-w-0 border-b border-slate-100/60">
                    <Favicon url={c.gsc_property} label={c.domain || c.name} size={32} className="rounded-lg shrink-0" />
                    <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5 min-w-0">
                            <Link to={`/clients/${c.client_id}`} className="font-semibold text-slate-900 text-base truncate hover:text-emerald-700">{c.name}</Link>
                            {meta.tag && (
                                <span className={`shrink-0 px-1.5 py-0.5 rounded-md text-[9px] font-bold uppercase tracking-wide ${meta.tagCls}`}
                                      title={c.gsc_property}>{meta.tag}</span>
                            )}
                        </div>
                        <div className="flex items-center gap-2 mt-0.5">
                            {c.ga4_property_id && <ChartPieIcon className="w-3.5 h-3.5 text-slate-400" title="GA4 linked" />}
                            {c.ads_customer_id && <MegaphoneIcon className="w-3.5 h-3.5 text-slate-400" title="Google Ads linked" />}
                            <span className="text-[12px] text-slate-500 truncate">{meta.text || c.domain}</span>
                        </div>
                    </div>
                    {flag && <ExclamationTriangleIcon className="w-5 h-5 text-amber-600 shrink-0" title="Needs attention" />}
                </div>

                {c.error ? (
                    /* error_kind decides the action. A 403 means the account simply has no rights on
                       this property, so sending the user to reconnect (as this card used to) is a
                       dead end — they need to re-link the client or grant access in Search Console. */
                    <div className="px-5 py-6 text-center">
                        <p className="text-[13px] text-red-500 leading-snug">{c.error}</p>
                        {(c.error_kind === 'no_access' || c.error_kind === 'not_found') && (
                            <Link to={`/clients/${c.client_id}`}
                                  className="inline-block mt-2.5 text-[12px] font-semibold text-indigo-600 hover:underline">
                                Re-link this client →
                            </Link>
                        )}
                        {c.error_kind === 'auth_expired' && (
                            <Link to="/connections"
                                  className="inline-block mt-2.5 text-[12px] font-semibold text-indigo-600 hover:underline">
                                Reconnect account →
                            </Link>
                        )}
                    </div>
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
                            ) : <div className="h-full flex items-center justify-center text-xs text-slate-400">Trend data unavailable</div>}
                        </div>
                    </>
                )}
                <div className="mt-auto px-5 py-3 border-t border-slate-100 flex items-center justify-between gap-3">
                    <span className={`text-xs font-medium ${flag ? 'text-amber-700' : 'text-slate-500'}`}>
                        {flag ? 'Needs attention' : 'Search performance'}
                    </span>
                    <Link to={`/clients/${c.client_id}`} aria-label={`View ${c.name}`} className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700 hover:text-emerald-900 py-1">
                        View client <ArrowUpRightIcon className="w-3.5 h-3.5" />
                    </Link>
                </div>
            </div>
        </div>
    );
}

export default function Clients() {
    const [clients, setClients] = useState([]);
    const [loading, setLoading] = useState(true);
    const [total, setTotal] = useState(0);          // expected card count (for the skeleton grid)
    const [search, setSearch] = useState('');
    const [attentionOnly, setAttentionOnly] = useState(false);
    const attentionCount = clients.filter(needsAttention).length;
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
        catch { toast.error('Could not sync clients'); }
        finally { setRefreshing(false); }
    };

    // Card → the client detail hub (which then links out to each deep-dive).
    const onSaved = (updated, archivedId) => {
        setEditing(null);
        if (archivedId) setClients(cs => cs.filter(c => c.client_id !== archivedId));
        else if (updated) setClients(cs => cs.map(c => c.client_id === updated.id ? { ...c, ...updated, client_id: updated.id } : c));
    };

    const filtered = useMemo(() => {
        const list = attentionOnly ? clients.filter(needsAttention) : clients;
        const q = search.trim().toLowerCase();
        const rows = q ? list.filter(c => (c.name + ' ' + (c.domain || '')).toLowerCase().includes(q)) : list;
        // Attention first, then by clicks desc so the active book surfaces above the long tail.
        return [...rows].sort((a, b) =>
            (needsAttention(b) - needsAttention(a)) || ((b.totals?.clicks || 0) - (a.totals?.clicks || 0)));
    }, [clients, search, attentionOnly]);

    return (
        <div className="max-w-[1400px] mx-auto px-4 sm:px-8 lg:px-10 py-6 sm:py-10">
            <div className="flex items-start justify-between gap-4 mb-8">
                <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.16em] text-emerald-700 mb-2">Workspace overview</p>
                    <h1 className="text-3xl font-semibold tracking-tight text-slate-900">Your clients</h1>
                    <p className="text-sm text-slate-500 mt-2 max-w-lg">A clear view of your portfolio. Spot changes and find where to focus next.</p>
                </div>
                <button onClick={refresh} disabled={refreshing || loading}
                    className="shrink-0 inline-flex items-center gap-2 px-4 py-2.5 bg-white border border-slate-200 shadow-sm rounded-xl text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed">
                    <ArrowPathIcon className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} /> {refreshing ? 'Syncing…' : 'Sync clients'}
                </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-5 mb-8" aria-live="polite">
                {[
                    { label: 'Clients loaded', value: loading ? `${clients.length} / ${total || '…'}` : clients.length, detail: 'Across your connected accounts' },
                    { label: 'Needs attention', value: attentionCount, detail: 'Access issues or clicks down 25%+', attention: true },
                    { label: 'Analytics linked', value: clients.filter(c => c.ga4_property_id).length, detail: 'Clients with a GA4 property' },
                ].map(stat => (
                    <div key={stat.label} className="rounded-2xl border border-slate-200/80 bg-white px-5 py-5">
                        <p className="text-sm font-medium text-slate-500">{stat.label}</p>
                        <p className={`text-3xl font-semibold tracking-tight tabular-nums mt-2 ${stat.attention && attentionCount ? 'text-amber-700' : 'text-slate-900'}`}>{stat.value}</p>
                        <p className="text-xs text-slate-500 mt-2">{stat.detail}{loading ? ' · Loading' : ''}</p>
                    </div>
                ))}
            </div>

            <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-4 mb-5">
                <div className="inline-flex self-start rounded-xl bg-slate-200/60 p-1 gap-1">
                    {[{ label: 'All clients', active: false }, { label: 'Needs attention', active: true }].map(tab => (
                        <button key={tab.label} onClick={() => setAttentionOnly(tab.active)} aria-pressed={attentionOnly === tab.active}
                            className={`px-3 sm:px-4 py-2 text-sm rounded-lg font-medium transition-colors ${attentionOnly === tab.active ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'}`}>
                            {tab.label}
                        </button>
                    ))}
                </div>
                <div className="relative w-full xl:w-72">
                    <MagnifyingGlassIcon className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                    <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search by client or domain…" aria-label="Search clients"
                        className="w-full pl-10 pr-3 py-2.5 bg-white border border-slate-200 rounded-xl text-sm focus:border-emerald-500 focus:ring-emerald-500/20" />
                </div>
            </div>
            <p className="text-xs text-slate-500 mb-4" role="status">{filtered.length} {filtered.length === 1 ? 'client' : 'clients'} shown · Attention first, then highest clicks</p>

            {loading && clients.length === 0 ? (
                <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-5">
                    {Array.from({ length: Math.min(total || 6, 12) }).map((_, i) => (
                        <div key={i} className="bg-white rounded-2xl border border-slate-200/80 h-[268px] animate-pulse" style={{ animationDelay: `${i * 60}ms` }} />
                    ))}
                </div>
            ) : !loading && filtered.length === 0 ? (
                <div className="text-center py-16 px-6 rounded-2xl border border-dashed border-slate-300 bg-white">
                    <Squares2X2Icon className="w-8 h-8 text-slate-400 mx-auto mb-4" />
                    <h2 className="font-semibold text-slate-800">{search ? 'No matching clients' : attentionOnly ? 'All clear' : 'Your portfolio starts here'}</h2>
                    <p className="text-sm text-slate-500 mt-2">{search ? `No clients match “${search}”. Try another name or domain.` : attentionOnly ? 'No loaded clients need attention.' : 'Sync clients to import your Search Console properties.'}</p>
                    {(search || attentionOnly) && <button onClick={() => { setSearch(''); setAttentionOnly(false); }} className="mt-5 text-sm font-semibold text-emerald-700 hover:underline">Show all clients</button>}
                </div>
            ) : (
                <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-5">
                    {filtered.map(c => <ClientCard key={c.client_id} c={c} onEdit={setEditing} />)}
                    {/* Trailing skeletons for clients still streaming in. */}
                    {loading && !search && !attentionOnly && Array.from({ length: Math.max(0, Math.min((total || 0) - clients.length, 6)) }).map((_, i) => (
                        <div key={`sk-${i}`} className="bg-white rounded-2xl border border-slate-200/80 h-[268px] animate-pulse" style={{ animationDelay: `${i * 60}ms` }} />
                    ))}
                </div>
            )}

            {editing && <EditDrawer client={{ ...editing, id: editing.client_id }} onClose={() => setEditing(null)} onSaved={onSaved} />}
        </div>
    );
}

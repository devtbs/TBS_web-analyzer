import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { AreaChart, Area, ResponsiveContainer } from 'recharts';
import { MagnifyingGlassIcon, ArrowPathIcon, ExclamationTriangleIcon,
         ChartPieIcon, MegaphoneIcon, XMarkIcon } from '@heroicons/react/24/outline';
import toast from 'react-hot-toast';
import api from '../api/axios';
import Favicon from '../components/ui/Favicon';
import { selectClient } from '../utils/clientSelection';
import { propertyMeta } from '../utils/propertyMeta';

/* Real period-over-period delta badge. Negative clicks/impressions = bad; caller sets direction. */
const Delta = ({ value, positiveGood = true }) => {
    if (value === null || value === undefined) return <span className="text-[12px] font-bold text-slate-400">—</span>;
    if (Math.abs(value) < 0.5) return <span className="text-[12px] font-bold text-slate-500">~0%</span>;
    const good = positiveGood ? value >= 0 : value <= 0;
    return (
        <span className={`text-[12px] font-bold inline-flex items-center gap-0.5 ${good ? 'text-[#16a34a]' : 'text-[#dc2626]'}`}>
            <span className="text-[9px]">{value >= 0 ? '▲' : '▼'}</span>{Math.abs(value).toFixed(0)}%
        </span>
    );
};

const fmt = (n) => (n == null ? '—' : n.toLocaleString());
// A client is "attention" when GSC data failed OR clicks fell hard — the portfolio red flag.
const needsAttention = (c) => !!c.error || (c.deltas && c.deltas.clicks != null && c.deltas.clicks <= -25);

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

function EditDrawer({ client, onClose, onSaved }) {
    const [form, setForm] = useState({
        name: client.name || '', ga4_property_id: client.ga4_property_id || '',
        ads_customer_id: client.ads_customer_id || '', brand_terms: client.brand_terms || '',
    });
    const [saving, setSaving] = useState(false);
    const save = async () => {
        setSaving(true);
        try {
            const res = await api.put(`/api/clients/${client.id}`, form);
            toast.success('Client updated');
            onSaved(res.data);
        } catch { toast.error('Could not save'); } finally { setSaving(false); }
    };
    const archive = async () => {
        if (!confirm(`Archive "${client.name}"? It will be removed from your clients.`)) return;
        try { await api.delete(`/api/clients/${client.id}`); toast.success('Client archived'); onSaved(null, client.id); }
        catch { toast.error('Could not archive'); }
    };
    const field = (k, label, ph) => (
        <label className="block mb-4">
            <span className="block text-[13px] font-semibold text-slate-700 mb-1">{label}</span>
            <input value={form[k]} onChange={e => setForm(f => ({ ...f, [k]: e.target.value }))}
                placeholder={ph} className="w-full border border-slate-300 rounded-lg px-3 py-2 text-[14px] outline-none focus:ring-2 focus:ring-emerald-500/30" />
        </label>
    );
    return (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/30" onClick={onClose}>
            <div className="w-full max-w-md bg-white h-full shadow-2xl p-6 overflow-y-auto" onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-between mb-5">
                    <h2 className="text-lg font-bold text-slate-800">Edit client</h2>
                    <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-100"><XMarkIcon className="w-5 h-5 text-slate-500" /></button>
                </div>
                {field('name', 'Name')}
                {field('ga4_property_id', 'GA4 property ID', 'e.g. 123456789')}
                {field('ads_customer_id', 'Google Ads customer ID', 'digits only')}
                {field('brand_terms', 'Branded queries to exclude', 'brand, nicknames, comma separated')}
                <div className="flex items-center gap-3 mt-6">
                    <button onClick={save} disabled={saving}
                        className="flex-1 bg-[#26397A] text-white rounded-lg py-2.5 font-bold text-[14px] disabled:opacity-60">
                        {saving ? 'Saving…' : 'Save'}
                    </button>
                    <button onClick={archive} className="px-4 py-2.5 rounded-lg text-red-600 font-semibold text-[14px] hover:bg-red-50">Archive</button>
                </div>
            </div>
        </div>
    );
}

export default function Clients() {
    const navigate = useNavigate();
    const [clients, setClients] = useState(null);   // null = loading
    const [search, setSearch] = useState('');
    const [editing, setEditing] = useState(null);
    const [refreshing, setRefreshing] = useState(false);

    const load = async () => {
        try {
            let res = await api.get('/api/clients/overview');
            // First-ever load: no clients yet → seed from GSC, then re-fetch.
            if (!res.data.clients?.length) {
                await api.post('/api/clients/autoseed');
                res = await api.get('/api/clients/overview');
            }
            setClients(res.data.clients || []);
        } catch {
            toast.error('Could not load clients');
            setClients([]);
        }
    };
    useEffect(() => { load(); }, []);

    const refresh = async () => {
        setRefreshing(true);
        try { await api.post('/api/clients/autoseed'); await load(); }
        finally { setRefreshing(false); }
    };

    const open = (c) => { selectClient(c); navigate('/seo-analytics'); };
    const onSaved = (updated, archivedId) => {
        setEditing(null);
        if (archivedId) setClients(cs => cs.filter(c => c.client_id !== archivedId));
        else if (updated) setClients(cs => cs.map(c => c.client_id === updated.id ? { ...c, ...updated, client_id: updated.id } : c));
    };

    const filtered = useMemo(() => {
        const list = clients || [];
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
                {clients && <span className="text-sm text-slate-400">{clients.length} total</span>}
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

            {clients === null ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
                    {Array.from({ length: 6 }).map((_, i) => (
                        <div key={i} className="bg-white rounded-2xl border border-slate-200/80 h-[240px] animate-pulse" style={{ animationDelay: `${i * 60}ms` }} />
                    ))}
                </div>
            ) : filtered.length === 0 ? (
                <div className="text-center py-20 text-slate-400">
                    {search ? `No clients match "${search}"` : 'No clients yet — click Sync to import from Search Console.'}
                </div>
            ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
                    {filtered.map(c => <ClientCard key={c.client_id} c={c} onOpen={open} onEdit={setEditing} />)}
                </div>
            )}

            {editing && <EditDrawer client={{ ...editing, id: editing.client_id }} onClose={() => setEditing(null)} onSaved={onSaved} />}
        </div>
    );
}

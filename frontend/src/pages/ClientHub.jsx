import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { AreaChart, Area, ResponsiveContainer } from 'recharts';
import {
    ArrowLeftIcon, PencilSquareIcon, SparklesIcon, DocumentTextIcon,
    MagnifyingGlassIcon, ChartPieIcon, MegaphoneIcon,
    CheckCircleIcon, ExclamationCircleIcon, ArrowTrendingUpIcon,
} from '@heroicons/react/24/outline';
import toast from 'react-hot-toast';
import api from '../api/axios';
import Favicon from '../components/ui/Favicon';
import { propertyMeta } from '../utils/propertyMeta';
import { selectClient } from '../utils/clientSelection';
import { sseStream } from '../utils/sseFetch';
import { Delta, fmt, EditDrawer } from '../components/clients/clientUI';

const HEALTH = {
    ok:   { label: 'Account connected', cls: 'text-emerald-600 bg-emerald-50 border-emerald-200', Icon: CheckCircleIcon },
    dead: { label: 'Needs reconnect',   cls: 'text-red-600 bg-red-50 border-red-200',            Icon: ExclamationCircleIcon },
    error:{ label: 'Connection issue',  cls: 'text-amber-600 bg-amber-50 border-amber-200',      Icon: ExclamationCircleIcon },
};

/* One channel metric card. `data`: null = not linked, {error} = failed, else {totals, deltas, sparkline}. */
function ChannelCard({ title, Icon, data, rows, onOpen, matching }) {
    const linked = data && !data.error;
    const spark = ((data && data.sparkline) || []).map((v, i) => ({ i, v }));
    return (
        <button
            onClick={linked ? onOpen : undefined}
            className={`text-left bg-white rounded-2xl border border-slate-200/80 shadow-sm flex flex-col overflow-hidden transition-shadow ${linked ? 'hover:shadow-md cursor-pointer' : 'cursor-default'}`}
        >
            <div className="px-5 pt-4 pb-3 flex items-center gap-2 border-b border-slate-100/60">
                <Icon className="w-4 h-4 text-slate-500" />
                <span className="font-bold text-slate-700 text-[14px]">{title}</span>
            </div>
            {!data ? (
                <div className="px-5 py-8 text-center text-[13px] text-slate-400">
                    {matching ? 'Checking for a match…' : 'Not linked — add it in Edit.'}
                </div>
            ) : data.error ? (
                <div className="px-5 py-8 text-center text-[13px] text-red-500">{data.error}</div>
            ) : (
                <>
                    <div className="px-5 pt-4 pb-2 space-y-2.5">
                        {rows.map(r => (
                            <div key={r.key} className="flex items-center justify-between">
                                <span className="text-[13px] text-slate-500">{r.label}</span>
                                <span className="flex items-center gap-2">
                                    <span className="text-[14px] font-bold text-slate-800">
                                        {r.prefix || ''}{fmt(data.totals?.[r.key])}
                                    </span>
                                    <Delta value={data.deltas?.[r.key]} positiveGood={r.positiveGood !== false} />
                                </span>
                            </div>
                        ))}
                    </div>
                    <div className="h-[56px] px-2 pb-3">
                        {spark.length > 1 ? (
                            <ResponsiveContainer width="100%" height="100%">
                                <AreaChart data={spark} margin={{ top: 6, right: 4, bottom: 0, left: 4 }}>
                                    <defs>
                                        <linearGradient id={`hub-${title}`} x1="0" y1="0" x2="0" y2="1">
                                            <stop offset="0%" stopColor="#10b981" stopOpacity={0.3} />
                                            <stop offset="100%" stopColor="#10b981" stopOpacity={0} />
                                        </linearGradient>
                                    </defs>
                                    <Area type="monotone" dataKey="v" stroke="#10b981" strokeWidth={2} fill={`url(#hub-${title})`} />
                                </AreaChart>
                            </ResponsiveContainer>
                        ) : <div className="h-full" />}
                    </div>
                </>
            )}
        </button>
    );
}

const DECK_STATUS = {
    generating: { label: 'Generating…', cls: 'bg-amber-50 text-amber-700 border-amber-200' },
    error:      { label: 'Failed',       cls: 'bg-red-50 text-red-700 border-red-200' },
};

export default function ClientHub() {
    const { id } = useParams();
    const navigate = useNavigate();
    const [data, setData] = useState(null);       // {client, gsc, ga4, ads}
    const [loading, setLoading] = useState(true);
    const [health, setHealth] = useState(null);   // 'ok' | 'dead' | 'error' | null
    const [decks, setDecks] = useState([]);
    const [editing, setEditing] = useState(false);
    const [genMsg, setGenMsg] = useState(null);   // inline generate progress; null = idle
    const [research, setResearch] = useState([]); // saved keyword-research runs for this client
    const [rankKws, setRankKws] = useState([]);   // tracked rank-tracker keywords for this client
    const [matching, setMatching] = useState(false);  // auto-linking GA4/Ads in the background
    const matchedRef = useRef(null);                  // client id we've already auto-matched this mount

    const client = data?.client;

    const loadHub = useCallback(async () => {
        try {
            const res = await api.get(`/api/clients/${id}/hub`);
            setData(res.data);
            // Selecting the client wires the account + property keys so the deep-dive links and the
            // scoped deck generation all target the right Google account.
            if (res.data.client) selectClient(res.data.client);
            return res.data.client;
        } catch {
            toast.error('Could not load client');
        } finally { setLoading(false); }
    }, [id]);

    // Auto-link GA4/Ads (using the client's own account) for anything not linked yet — once per open.
    const tryAutoMatch = useCallback(async (c) => {
        if (!c || matchedRef.current === id) return;
        if (c.ga4_property_id && c.ads_customer_id) return;   // nothing left to match
        matchedRef.current = id;
        setMatching(true);
        try {
            const res = await api.post(`/api/clients/${id}/automatch`);
            if (Object.keys(res.data.changed || {}).length) {
                const added = Object.keys(res.data.changed)
                    .map(k => (k === 'ga4_property_id' ? 'GA4' : 'Ads')).join(' + ');
                toast.success(`Auto-linked ${added}`);
                await loadHub();   // refetch so the newly-linked channel's metrics render
            }
        } catch { /* best-effort */ } finally { setMatching(false); }
    }, [id, loadHub]);

    const loadDecks = useCallback(async () => {
        try { setDecks((await api.get(`/api/documents?client_id=${id}`)).data || []); }
        catch { /* non-fatal */ }
    }, [id]);

    const loadResearch = useCallback(async () => {
        try { setResearch((await api.get('/api/research/runs', { params: { client_id: id } })).data.runs || []); }
        catch { /* non-fatal */ }
    }, [id]);

    const loadRankKws = useCallback(async () => {
        try { setRankKws((await api.get('/api/ranktracker/keywords', { params: { client_id: id } })).data.keywords || []); }
        catch { /* non-fatal */ }
    }, [id]);

    useEffect(() => { loadHub().then(tryAutoMatch); loadDecks(); loadResearch(); loadRankKws(); }, [loadHub, loadDecks, loadResearch, loadRankKws, tryAutoMatch]);

    // Health pill for the account backing this client.
    useEffect(() => {
        if (!client) return;
        api.get('/auth/connections').then(r => {
            const rows = r.data.connections || [];
            const row = rows.find(c => c.provider === 'google' && c.account_id === client.google_account_id);
            setHealth(row?.status || null);
        }).catch(() => {});
    }, [client]);

    // While a deck is generating, poll so its chip flips to done/failed.
    useEffect(() => {
        if (!decks.some(d => d.status === 'generating')) return;
        const t = setInterval(loadDecks, 4000);
        return () => clearInterval(t);
    }, [decks, loadDecks]);

    const brandTerms = (client?.brand_terms || '').split(',').map(s => s.trim()).filter(Boolean);

    const generate = async () => {
        if (!client) return;
        if (!(client.gsc_property || client.ga4_property_id || client.ads_customer_id)) {
            toast.error('Link at least one platform (GSC / GA4 / Ads) first.'); return;
        }
        const qs = new URLSearchParams({ days: 28, provider: 'deepseek', images: true });
        if (client.gsc_property) qs.set('property', client.gsc_property);
        if (client.ga4_property_id) qs.set('ga4_property_id', client.ga4_property_id);
        if (client.ads_customer_id) { qs.set('ads_customer_id', client.ads_customer_id); qs.set('ads_label', client.name || ''); }
        setGenMsg('Starting…');
        try {
            await sseStream(`/api/presentation/ai-deck-combined?${qs.toString()}`, (type, d) => {
                if (type === 'progress') setGenMsg(d.message || 'Working…');
                else if (type === 'result') { setGenMsg(null); toast.success('Deck ready'); loadDecks(); }
                else if (type === 'error') { setGenMsg(null); toast.error(d.detail || 'Generation failed'); }
            }, { method: 'POST', body: { client_id: id, brand_terms: client.brand_terms || '', provider: 'deepseek' } });
        } catch { setGenMsg(null); toast.error('Generation failed'); }
    };

    const onSaved = (updated) => {
        setEditing(false);
        if (updated) { setData(d => ({ ...d, client: { ...d.client, ...updated } })); loadHub(); }
        else navigate('/clients');   // archived
    };

    if (loading) {
        return <div className="max-w-[1100px] mx-auto px-6 py-8">
            <div className="h-8 w-56 bg-slate-100 rounded animate-pulse mb-6" />
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
                {[0, 1, 2].map(i => <div key={i} className="h-[220px] bg-slate-100 rounded-2xl animate-pulse" />)}
            </div>
        </div>;
    }
    if (!client) {
        return <div className="max-w-[1100px] mx-auto px-6 py-16 text-center text-slate-400">Client not found.</div>;
    }

    const meta = propertyMeta(client.gsc_property);
    const H = health && HEALTH[health];

    return (
        <div className="max-w-[1100px] mx-auto px-6 py-8">
            <button onClick={() => navigate('/clients')} className="flex items-center gap-1.5 text-[13px] font-semibold text-slate-500 hover:text-slate-700 mb-4">
                <ArrowLeftIcon className="w-4 h-4" /> Clients
            </button>

            {/* Header */}
            <div className="flex items-center gap-3 mb-6 flex-wrap">
                <Favicon url={client.gsc_property} label={client.domain || client.name} size={40} className="rounded-xl shrink-0" />
                <div className="min-w-0">
                    <div className="flex items-center gap-2">
                        <h1 className="text-2xl font-bold text-slate-800 truncate">{client.name}</h1>
                        {meta.tag && <span className={`px-1.5 py-0.5 rounded-md text-[9px] font-bold uppercase tracking-wide ${meta.tagCls}`}>{meta.tag}</span>}
                    </div>
                    <p className="text-[13px] text-slate-400">{client.domain}</p>
                </div>
                <div className="flex items-center gap-2 ml-auto">
                    {H && (
                        <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-[12px] font-semibold ${H.cls}`}>
                            <H.Icon className="w-4 h-4" /> {H.label}
                        </span>
                    )}
                    <button onClick={() => setEditing(true)}
                        className="flex items-center gap-1.5 px-3 py-2 border border-slate-300 rounded-lg text-[13px] font-semibold text-slate-600 hover:bg-slate-50">
                        <PencilSquareIcon className="w-4 h-4" /> Edit
                    </button>
                </div>
            </div>

            {/* Channel cards */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-5 mb-6">
                <ChannelCard title="Search Console" Icon={MagnifyingGlassIcon} data={data.gsc}
                    onOpen={() => navigate('/seo-analytics')}
                    rows={[{ key: 'clicks', label: 'Clicks' }, { key: 'impressions', label: 'Impressions' }]} />
                <ChannelCard title="Analytics (GA4)" Icon={ChartPieIcon} data={data.ga4} matching={matching}
                    onOpen={() => navigate('/ga4-analytics')}
                    rows={[{ key: 'users', label: 'Users' }, { key: 'sessions', label: 'Sessions' },
                           ...(data.ga4 && !data.ga4.error && data.ga4.totals?.revenue ? [{ key: 'revenue', label: 'Revenue' }] : [{ key: 'conversions', label: 'Conversions' }])]} />
                <ChannelCard title="Google Ads" Icon={MegaphoneIcon} data={data.ads} matching={matching}
                    onOpen={() => navigate('/google-ads')}
                    rows={[{ key: 'cost', label: 'Spend', prefix: (data.ads?.currency ? data.ads.currency + ' ' : '') },
                           { key: 'conversions', label: 'Conversions' },
                           { key: 'conversions_value', label: 'Conv. value' }]} />
            </div>

            {/* Generate deck */}
            <div className="bg-white rounded-2xl border border-slate-200/80 shadow-sm p-5 mb-6 flex items-center gap-4 flex-wrap">
                <div className="min-w-0 flex-1">
                    <p className="font-bold text-slate-800 text-[15px]">Generate a report deck</p>
                    <p className="text-[13px] text-slate-500">One combined deck from this client's linked channels{brandTerms.length ? ', excluding branded queries' : ''}.</p>
                </div>
                {genMsg != null ? (
                    <span className="inline-flex items-center gap-2 text-[13px] font-semibold text-slate-600">
                        <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" /> {genMsg}
                    </span>
                ) : (
                    <div className="flex items-center gap-3">
                        <button onClick={generate}
                            className="flex items-center gap-2 bg-[#26397A] text-white rounded-lg px-4 py-2.5 font-bold text-[14px] hover:bg-[#1d2c5e]">
                            <SparklesIcon className="w-4 h-4" /> Generate deck
                        </button>
                        <button onClick={() => { selectClient(client); navigate('/presentation'); }}
                            className="text-[13px] font-semibold text-slate-500 hover:text-slate-700">More options</button>
                    </div>
                )}
            </div>

            {/* Keyword research */}
            <div className="bg-white rounded-2xl border border-slate-200/80 shadow-sm p-5 mb-6">
                <div className="flex items-center gap-4 flex-wrap mb-1">
                    <div className="min-w-0 flex-1">
                        <p className="font-bold text-slate-800 text-[15px]">Keyword research &amp; topical maps</p>
                        <p className="text-[13px] text-slate-500">Saved research sessions for this client — reopen to continue or rebuild the map.</p>
                    </div>
                    <button onClick={() => navigate(`/new-analysis?client=${id}`)}
                        className="flex items-center gap-2 border border-slate-300 text-slate-700 rounded-lg px-4 py-2.5 font-bold text-[14px] hover:bg-slate-50">
                        <SparklesIcon className="w-4 h-4" /> New research
                    </button>
                </div>
                {research.length > 0 && (
                    <div className="mt-3 border border-slate-200 rounded-xl divide-y divide-slate-100">
                        {research.map(r => (
                            <div key={r.id} className="flex items-center gap-3 px-4 py-3 hover:bg-slate-50">
                                <div className="min-w-0 flex-1">
                                    <p className="text-[14px] font-semibold text-slate-800 truncate">{r.name}</p>
                                    <p className="text-[12px] text-slate-400">{r.keyword_count} keywords · {r.cluster_count} clusters · step {r.step}{r.analysis_id ? ' · map built' : ''}</p>
                                </div>
                                {r.analysis_id && (
                                    <button onClick={() => navigate(`/results/${r.analysis_id}`)}
                                        className="text-[13px] font-semibold text-emerald-700 hover:underline shrink-0">View map</button>
                                )}
                                <button onClick={() => navigate(`/new-analysis?client=${id}`)}
                                    className="text-[13px] font-semibold text-slate-500 hover:text-slate-700 shrink-0">Open</button>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* Rank tracking */}
            <div className="bg-white rounded-2xl border border-slate-200/80 shadow-sm p-5 mb-6">
                <div className="flex items-center gap-4 flex-wrap mb-1">
                    <div className="min-w-0 flex-1">
                        <p className="font-bold text-slate-800 text-[15px]">Keyword rankings</p>
                        <p className="text-[13px] text-slate-500">
                            {rankKws.length ? `Tracking ${rankKws.length} keyword${rankKws.length !== 1 ? 's' : ''} — daily Google positions.` : 'Track this client’s keyword positions over time.'}
                        </p>
                    </div>
                    <button onClick={() => navigate(`/rank-tracker?client=${id}`)}
                        className="flex items-center gap-2 border border-slate-300 text-slate-700 rounded-lg px-4 py-2.5 font-bold text-[14px] hover:bg-slate-50">
                        <ArrowTrendingUpIcon className="w-4 h-4" /> Rank tracker
                    </button>
                </div>
                {rankKws.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-2">
                        {rankKws.slice(0, 8).map(k => (
                            <span key={k.id} className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-slate-100 text-[12px] font-medium text-slate-600">
                                {k.keyword}
                                <b className={k.position == null ? 'text-slate-400' : k.position <= 10 ? 'text-emerald-600' : 'text-slate-700'}>{k.position == null ? '>100' : `#${k.position}`}</b>
                            </span>
                        ))}
                        {rankKws.length > 8 && <span className="px-2 py-1 text-[12px] text-slate-400">+{rankKws.length - 8} more</span>}
                    </div>
                )}
            </div>

            {/* Brand terms */}
            {brandTerms.length > 0 && (
                <div className="mb-6">
                    <p className="text-[13px] font-semibold text-slate-600 mb-2">Branded queries (excluded from non-brand analysis)</p>
                    <div className="flex flex-wrap gap-2">
                        {brandTerms.map((t, i) => (
                            <span key={i} className="px-2.5 py-1 rounded-full bg-slate-100 text-slate-600 text-[12px] font-medium">{t}</span>
                        ))}
                    </div>
                </div>
            )}

            {/* Decks */}
            <div>
                <p className="text-[15px] font-bold text-slate-800 mb-3">Decks &amp; documents</p>
                {decks.length === 0 ? (
                    <div className="text-center py-12 text-slate-400 bg-white border border-slate-200/80 rounded-2xl text-[14px]">
                        No decks yet for this client — generate one above.
                    </div>
                ) : (
                    <div className="bg-white border border-slate-200/80 rounded-2xl divide-y divide-slate-100">
                        {decks.map(d => {
                            const s = DECK_STATUS[d.status];
                            return (
                                <button key={d.id} onClick={() => navigate(`/documents/${d.id}`)}
                                    className="w-full flex items-center gap-3 px-5 py-3.5 text-left hover:bg-slate-50">
                                    <DocumentTextIcon className="w-5 h-5 text-slate-400 shrink-0" />
                                    <span className="min-w-0 flex-1">
                                        <span className="block text-[14px] font-semibold text-slate-800 truncate">{d.title}</span>
                                        <span className="block text-[12px] text-slate-400">{d.content_type}</span>
                                    </span>
                                    {s && <span className={`shrink-0 px-2 py-0.5 rounded-full text-[11px] font-semibold border ${s.cls}`}>{s.label}</span>}
                                </button>
                            );
                        })}
                    </div>
                )}
            </div>

            {editing && <EditDrawer client={client} onClose={() => setEditing(false)} onSaved={onSaved} />}
        </div>
    );
}

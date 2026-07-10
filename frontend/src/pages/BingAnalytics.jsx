import { useState, useEffect, useCallback, useMemo } from 'react';
import {
    AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import {
    MagnifyingGlassIcon, CursorArrowRaysIcon, EyeIcon, PlusIcon,
    ArrowTopRightOnSquareIcon, ArrowPathIcon, TrashIcon, SparklesIcon,
} from '@heroicons/react/24/outline';
import api from '../api/axios';
import toast from 'react-hot-toast';

const ACCENT = '#008373'; // Bing Webmaster teal

const fmt = (v) => (v != null ? Number(v).toLocaleString() : '-');
const prettySite = (u) => (u || '').replace(/^https?:\/\//, '').replace(/\/$/, '');

const StatCard = ({ icon: Icon, label, value }) => (
    <div className="bg-white rounded-2xl border border-slate-200/70 p-5 flex items-center gap-4 shadow-sm">
        <div className="w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: `${ACCENT}14`, color: ACCENT }}>
            <Icon className="w-5 h-5" />
        </div>
        <div>
            <p className="text-[11px] font-bold text-slate-400 uppercase tracking-widest">{label}</p>
            <p className="text-2xl font-black text-slate-900 leading-tight">{value}</p>
        </div>
    </div>
);

const BingAnalytics = () => {
    const [status, setStatus] = useState(null);     // {configured, accounts}
    const [accounts, setAccounts] = useState([]);
    const [sites, setSites] = useState([]);
    const [loadingSites, setLoadingSites] = useState(false);
    const [search, setSearch] = useState('');
    const [selected, setSelected] = useState(null); // {url, account_id, account_label}
    const [perf, setPerf] = useState(null);
    const [loadingPerf, setLoadingPerf] = useState(false);
    const [connecting, setConnecting] = useState(false);

    const fetchStatus = useCallback(async () => {
        const res = await api.get('/auth/bing/status');
        setStatus(res.data);
        return res.data;
    }, []);

    const fetchAccounts = useCallback(async () => {
        const res = await api.get('/auth/bing/accounts');
        setAccounts(res.data.accounts || []);
    }, []);

    const fetchSites = useCallback(async () => {
        setLoadingSites(true);
        try {
            const res = await api.get('/api/bing/sites');
            setSites(res.data.sites || []);
            (res.data.errors || []).forEach(e => toast.error(`${e.label}: ${e.error}`));
        } catch {
            toast.error('Failed to load Bing sites');
        } finally {
            setLoadingSites(false);
        }
    }, []);

    useEffect(() => {
        fetchStatus().then((s) => {
            if (s?.configured && s.accounts > 0) { fetchAccounts(); fetchSites(); }
        });
    }, [fetchStatus, fetchAccounts, fetchSites]);

    // Listen for the OAuth popup completing.
    useEffect(() => {
        const onMessage = (e) => {
            if (e.origin !== window.location.origin) return;
            if (e.data?.type === 'bing-connected') {
                toast.success('Bing account connected');
                setConnecting(false);
                fetchStatus(); fetchAccounts(); fetchSites();
            } else if (e.data?.type === 'bing-connect-error') {
                toast.error(e.data.error || 'Connection failed');
                setConnecting(false);
            }
        };
        window.addEventListener('message', onMessage);
        return () => window.removeEventListener('message', onMessage);
    }, [fetchStatus, fetchAccounts, fetchSites]);

    const connect = async () => {
        try {
            setConnecting(true);
            const redirectUri = `${window.location.origin}/bing-callback`;
            const res = await api.get('/auth/bing/authorize-url', { params: { redirect_uri: redirectUri } });
            window.open(res.data.url, 'bing-oauth', 'width=560,height=680');
        } catch {
            setConnecting(false);
            toast.error('Could not start Bing sign-in');
        }
    };

    const disconnect = async (id) => {
        await api.delete(`/auth/bing/accounts/${id}`);
        toast.success('Disconnected');
        if (selected?.account_id === id) { setSelected(null); setPerf(null); }
        fetchStatus(); fetchAccounts(); fetchSites();
    };

    const selectSite = async (site) => {
        setSelected(site);
        setPerf(null);
        setLoadingPerf(true);
        try {
            const res = await api.get('/api/bing/performance', { params: { site: site.url, account_id: site.account_id } });
            setPerf(res.data);
        } catch (e) {
            toast.error(e.response?.data?.detail || 'Failed to load performance');
        } finally {
            setLoadingPerf(false);
        }
    };

    const filteredSites = useMemo(
        () => sites.filter(s => prettySite(s.url).toLowerCase().includes(search.toLowerCase())),
        [sites, search]
    );

    /* ── Not configured: setup instructions ── */
    if (status && !status.configured) {
        return (
            <div className="max-w-2xl mx-auto p-8">
                <div className="bg-white rounded-3xl border border-slate-200 p-8 shadow-sm">
                    <h1 className="text-xl font-black text-slate-900 mb-2">Bing Webmaster — not configured</h1>
                    <p className="text-sm text-slate-500 mb-5">
                        To enable Bing reporting, an admin must register a Bing OAuth client and set
                        <code className="mx-1 px-1.5 py-0.5 rounded bg-slate-100 text-slate-700 text-xs">BING_CLIENT_ID</code>/
                        <code className="mx-1 px-1.5 py-0.5 rounded bg-slate-100 text-slate-700 text-xs">BING_CLIENT_SECRET</code>
                        in the backend <code className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-700 text-xs">.env</code>.
                    </p>
                    <ol className="text-sm text-slate-600 space-y-1.5 list-decimal list-inside">
                        <li>Bing Webmaster Tools → Settings → API Access → OAuth Client</li>
                        <li>Add redirect URI <code className="px-1.5 py-0.5 rounded bg-slate-100 text-xs">{`${window.location.origin}/bing-callback`}</code></li>
                        <li>Copy the Client ID &amp; Secret into the backend <code className="px-1 rounded bg-slate-100 text-xs">.env</code> and restart.</li>
                    </ol>
                </div>
            </div>
        );
    }

    return (
        <div className="max-w-6xl mx-auto p-6 space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between gap-4 flex-wrap">
                <div>
                    <h1 className="text-2xl font-black text-slate-900 tracking-tight">Bing Search Performance</h1>
                    <p className="text-sm text-slate-500">Impressions, clicks, top queries &amp; pages from Bing Webmaster Tools.</p>
                </div>
                <button
                    onClick={connect}
                    disabled={connecting}
                    className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-white text-sm font-bold shadow-sm disabled:opacity-60"
                    style={{ background: ACCENT }}
                >
                    <PlusIcon className="w-4 h-4" />
                    {connecting ? 'Connecting…' : 'Connect Bing account'}
                </button>
            </div>

            {/* Connected accounts */}
            {accounts.length > 0 && (
                <div className="flex flex-wrap gap-2">
                    {accounts.map(a => (
                        <span key={a.id} className="inline-flex items-center gap-2 pl-3 pr-2 py-1.5 rounded-full bg-white border border-slate-200 text-xs font-semibold text-slate-600 shadow-sm">
                            {a.label}
                            <button onClick={() => disconnect(a.id)} title="Disconnect" className="p-0.5 rounded-full text-slate-300 hover:text-red-500 hover:bg-red-50">
                                <TrashIcon className="w-3.5 h-3.5" />
                            </button>
                        </span>
                    ))}
                </div>
            )}

            {/* No accounts yet */}
            {status?.configured && accounts.length === 0 && (
                <div className="bg-white rounded-3xl border border-slate-200 p-10 text-center shadow-sm">
                    <div className="w-14 h-14 rounded-2xl mx-auto mb-4 flex items-center justify-center" style={{ background: `${ACCENT}14`, color: ACCENT }}>
                        <MagnifyingGlassIcon className="w-7 h-7" />
                    </div>
                    <h2 className="text-lg font-bold text-slate-800 mb-1">Connect your Bing account</h2>
                    <p className="text-sm text-slate-500 mb-5 max-w-md mx-auto">Sign in with the Bing Webmaster account (Google logins work) to pull search performance for all its verified sites.</p>
                    <button onClick={connect} disabled={connecting} className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-white text-sm font-bold" style={{ background: ACCENT }}>
                        <PlusIcon className="w-4 h-4" />{connecting ? 'Connecting…' : 'Connect Bing account'}
                    </button>
                </div>
            )}

            {/* Sites + performance */}
            {accounts.length > 0 && (
                <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-6">
                    {/* Site list */}
                    <div className="bg-white rounded-2xl border border-slate-200/70 shadow-sm flex flex-col max-h-[70vh]">
                        <div className="p-3 border-b border-slate-100">
                            <div className="relative">
                                <MagnifyingGlassIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                                <input
                                    value={search}
                                    onChange={(e) => setSearch(e.target.value)}
                                    placeholder="Search sites…"
                                    className="w-full pl-9 pr-3 py-2 rounded-lg bg-slate-50 border border-slate-200 text-sm outline-none focus:border-slate-300"
                                />
                            </div>
                        </div>
                        <div className="flex items-center justify-between px-3 py-2 text-[11px] font-bold text-slate-400 uppercase tracking-widest">
                            <span>{filteredSites.length} sites</span>
                            <button onClick={fetchSites} className="p-1 rounded hover:bg-slate-100 text-slate-400 hover:text-slate-600" title="Refresh">
                                <ArrowPathIcon className={`w-3.5 h-3.5 ${loadingSites ? 'animate-spin' : ''}`} />
                            </button>
                        </div>
                        <div className="overflow-y-auto flex-1 p-1.5 space-y-0.5">
                            {loadingSites ? (
                                <p className="text-sm text-slate-400 text-center py-8">Loading…</p>
                            ) : filteredSites.length === 0 ? (
                                <p className="text-sm text-slate-400 text-center py-8">No verified sites</p>
                            ) : filteredSites.map(s => (
                                <button
                                    key={`${s.account_id}-${s.url}`}
                                    onClick={() => selectSite(s)}
                                    className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${
                                        selected?.url === s.url && selected?.account_id === s.account_id
                                            ? 'font-bold' : 'text-slate-600 hover:bg-slate-50'
                                    }`}
                                    style={selected?.url === s.url && selected?.account_id === s.account_id ? { background: `${ACCENT}12`, color: ACCENT } : {}}
                                >
                                    <span className="block truncate">{prettySite(s.url)}</span>
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Performance panel */}
                    <div className="space-y-5">
                        {!selected ? (
                            <div className="bg-white rounded-2xl border border-slate-200/70 p-12 text-center text-slate-400 shadow-sm">
                                Select a site to view its Bing search performance.
                            </div>
                        ) : loadingPerf ? (
                            <div className="bg-white rounded-2xl border border-slate-200/70 p-12 text-center text-slate-400 shadow-sm">Loading performance…</div>
                        ) : perf ? (
                            <>
                                <div className="flex items-center justify-between gap-3 flex-wrap">
                                    <h2 className="text-lg font-bold text-slate-800">{prettySite(selected.url)}</h2>
                                    <a
                                        href={`https://www.bing.com/webmasters/aiperformance?siteUrl=${encodeURIComponent(selected.url)}`}
                                        target="_blank" rel="noopener noreferrer"
                                        className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold border border-slate-200 text-slate-600 hover:border-slate-300 hover:bg-slate-50"
                                    >
                                        <SparklesIcon className="w-4 h-4" style={{ color: ACCENT }} />
                                        Open AI Performance in Bing
                                        <ArrowTopRightOnSquareIcon className="w-3.5 h-3.5" />
                                    </a>
                                </div>

                                <div className="grid grid-cols-2 gap-4">
                                    <StatCard icon={CursorArrowRaysIcon} label="Clicks" value={fmt(perf.totals?.clicks)} />
                                    <StatCard icon={EyeIcon} label="Impressions" value={fmt(perf.totals?.impressions)} />
                                </div>

                                {perf.traffic?.length > 0 && (
                                    <div className="bg-white rounded-2xl border border-slate-200/70 p-5 shadow-sm">
                                        <p className="text-sm font-bold text-slate-700 mb-4">Daily traffic</p>
                                        <ResponsiveContainer width="100%" height={240}>
                                            <AreaChart data={perf.traffic}>
                                                <defs>
                                                    <linearGradient id="bingClicks" x1="0" y1="0" x2="0" y2="1">
                                                        <stop offset="5%" stopColor={ACCENT} stopOpacity={0.3} />
                                                        <stop offset="95%" stopColor={ACCENT} stopOpacity={0} />
                                                    </linearGradient>
                                                </defs>
                                                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                                                <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#94a3b8' }} minTickGap={30} />
                                                <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} />
                                                <Tooltip />
                                                <Area type="monotone" dataKey="clicks" stroke={ACCENT} strokeWidth={2} fill="url(#bingClicks)" />
                                            </AreaChart>
                                        </ResponsiveContainer>
                                    </div>
                                )}

                                <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
                                    <TableCard title="Top queries" rows={perf.queries?.slice(0, 25)} cols={['query', 'clicks', 'impressions']} labelKey="query" />
                                    <TableCard title="Top pages" rows={perf.pages?.slice(0, 25)} cols={['page', 'clicks', 'impressions']} labelKey="page" transform={prettySite} />
                                </div>
                            </>
                        ) : null}
                    </div>
                </div>
            )}
        </div>
    );
};

const TableCard = ({ title, rows, cols, labelKey, transform }) => (
    <div className="bg-white rounded-2xl border border-slate-200/70 shadow-sm overflow-hidden">
        <p className="text-sm font-bold text-slate-700 px-5 py-3.5 border-b border-slate-100">{title}</p>
        {!rows || rows.length === 0 ? (
            <p className="text-sm text-slate-400 text-center py-8">No data</p>
        ) : (
            <div className="overflow-x-auto">
                <table className="w-full text-sm">
                    <thead>
                        <tr className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                            {cols.map(c => <th key={c} className={`px-5 py-2 ${c === labelKey ? 'text-left' : 'text-right'}`}>{c}</th>)}
                        </tr>
                    </thead>
                    <tbody>
                        {rows.map((r, i) => (
                            <tr key={i} className="border-t border-slate-50 hover:bg-slate-50/60">
                                {cols.map(c => (
                                    <td key={c} className={`px-5 py-2.5 ${c === labelKey ? 'text-left font-semibold text-slate-700 max-w-[240px] truncate' : 'text-right text-slate-600'}`} title={c === labelKey ? r[c] : undefined}>
                                        {c === labelKey ? (transform ? transform(r[c]) : r[c]) : fmt(r[c])}
                                    </td>
                                ))}
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        )}
    </div>
);

export default BingAnalytics;

import { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { SparklesIcon, ArrowPathIcon, CheckCircleIcon, XCircleIcon } from '@heroicons/react/24/outline';
import toast from 'react-hot-toast';
import api from '../api/axios';
import Favicon from '../components/ui/Favicon';

/* AI Results Tracker — are we cited in Google's AI Overview, who else is, and from which pages.
   Reads the SERP snapshots captured by the daily rank check, so it costs no extra SerpAPI spend. */

const TABS = [
    { key: 'rankings', label: 'Rankings' },
    { key: 'competitors', label: 'Competitors' },
    { key: 'sources', label: 'Sources' },
];

const Stat = ({ label, value, hint, tone = 'slate' }) => (
    <div className="bg-white border border-slate-200 rounded-xl px-4 py-3">
        <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">{label}</p>
        <p className={`text-2xl font-black text-${tone}-700 leading-tight`}>{value}</p>
        {hint && <p className="text-[11px] text-slate-400">{hint}</p>}
    </div>
);

export default function AIResultsTracker() {
    const [params] = useSearchParams();
    const clientId = params.get('client');
    const q = clientId ? `?client_id=${clientId}` : '';

    const [tab, setTab] = useState('rankings');
    const [loading, setLoading] = useState(true);
    const [data, setData] = useState({ rankings: null, competitors: null, sources: null, trend: null });

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const [r, c, s, t] = await Promise.all([
                api.get(`/api/ranktracker/ai/rankings${q}`),
                api.get(`/api/ranktracker/ai/competitors${q}`),
                api.get(`/api/ranktracker/ai/sources${q}`),
                api.get(`/api/ranktracker/ai/trend${q}`),
            ]);
            setData({ rankings: r.data, competitors: c.data, sources: s.data, trend: t.data });
        } catch (e) {
            toast.error('Could not load AI results');
        } finally {
            setLoading(false);
        }
    }, [q]);

    useEffect(() => { load(); }, [load]);

    const summary = data.rankings?.summary;
    const points = data.trend?.points || [];

    return (
        <div className="p-6 max-w-7xl mx-auto">
            <div className="flex items-center gap-3 mb-5">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-600 to-fuchsia-600 flex items-center justify-center">
                    <SparklesIcon className="w-5 h-5 text-white" />
                </div>
                <div className="flex-1">
                    <h1 className="text-xl font-black text-slate-800">AI Results Tracker</h1>
                    <p className="text-xs text-slate-500">Google AI Overview citations across your tracked keywords</p>
                </div>
                <button onClick={load} disabled={loading}
                    className="flex items-center gap-2 px-3 py-2 bg-white border border-slate-300 rounded-lg text-sm font-bold text-slate-600 hover:bg-slate-50 disabled:opacity-50">
                    <ArrowPathIcon className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Refresh
                </button>
            </div>

            {summary && (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
                    <Stat label="Tracked" value={summary.tracked} hint="keywords" />
                    <Stat label="With AI Overview" value={summary.with_ai_overview} hint="of tracked keywords" />
                    <Stat label="You're cited" value={summary.cited} tone="emerald" hint="AI Overviews mentioning you" />
                    <Stat label="Citation rate" value={`${summary.citation_rate}%`} tone="violet" hint="of AI Overviews seen" />
                </div>
            )}

            {points.length > 1 && (
                <div className="bg-white border border-slate-200 rounded-xl p-4 mb-5">
                    <p className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-2">Citation rate over time</p>
                    <ResponsiveContainer width="100%" height={140}>
                        <LineChart data={points}>
                            <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                            <YAxis tick={{ fontSize: 10 }} unit="%" />
                            <Tooltip />
                            <Line type="monotone" dataKey="citation_rate" stroke="#7c3aed" strokeWidth={2} dot={false} />
                        </LineChart>
                    </ResponsiveContainer>
                </div>
            )}

            <div className="flex gap-1 mb-3">
                {TABS.map(t => (
                    <button key={t.key} onClick={() => setTab(t.key)}
                        className={`px-4 py-2 rounded-lg text-sm font-bold transition-colors ${
                            tab === t.key ? 'bg-violet-600 text-white' : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'}`}>
                        {t.label}
                    </button>
                ))}
            </div>

            <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                {loading && <p className="p-6 text-sm text-slate-400">Loading…</p>}

                {!loading && tab === 'rankings' && (
                    <table className="w-full text-sm">
                        <thead className="bg-slate-50 text-[11px] uppercase tracking-wider text-slate-500">
                            <tr>
                                <th className="px-4 py-2.5 text-left">Keyword</th>
                                <th className="px-4 py-2.5 text-center">AI Overview</th>
                                <th className="px-4 py-2.5 text-center">You cited</th>
                                <th className="px-4 py-2.5 text-center">Sources</th>
                                <th className="px-4 py-2.5 text-right">Checked</th>
                            </tr>
                        </thead>
                        <tbody>
                            {(data.rankings?.keywords || []).map(k => (
                                <tr key={k.id} className="border-t border-slate-100">
                                    <td className="px-4 py-2.5 font-medium text-slate-700">{k.keyword}</td>
                                    <td className="px-4 py-2.5 text-center">
                                        {k.ai_overview
                                            ? <span className="text-violet-600 font-bold text-xs">YES</span>
                                            : <span className="text-slate-300 text-xs">—</span>}
                                    </td>
                                    <td className="px-4 py-2.5 text-center">
                                        {k.cited
                                            ? <CheckCircleIcon className="w-5 h-5 text-emerald-500 inline" />
                                            : k.ai_overview ? <XCircleIcon className="w-5 h-5 text-slate-300 inline" /> : '—'}
                                    </td>
                                    <td className="px-4 py-2.5 text-center text-slate-500">{k.source_count || '—'}</td>
                                    <td className="px-4 py-2.5 text-right text-xs text-slate-400">{k.checked_on || 'not yet'}</td>
                                </tr>
                            ))}
                            {!data.rankings?.keywords?.length && (
                                <tr><td colSpan={5} className="px-4 py-8 text-center text-sm text-slate-400">
                                    No tracked keywords yet — add some in the Rank Tracker, and AI results appear after the next daily check.
                                </td></tr>
                            )}
                        </tbody>
                    </table>
                )}

                {!loading && tab === 'competitors' && (
                    <table className="w-full text-sm">
                        <thead className="bg-slate-50 text-[11px] uppercase tracking-wider text-slate-500">
                            <tr>
                                <th className="px-4 py-2.5 text-left">Domain</th>
                                <th className="px-4 py-2.5 text-center">Citations</th>
                                <th className="px-4 py-2.5 text-center">Keywords</th>
                                <th className="px-4 py-2.5 text-left">Example keywords</th>
                            </tr>
                        </thead>
                        <tbody>
                            {(data.competitors?.competitors || []).map(c => (
                                <tr key={c.domain} className={`border-t border-slate-100 ${c.is_you ? 'bg-emerald-50/50' : ''}`}>
                                    <td className="px-4 py-2.5 font-medium text-slate-700">
                                        <span className="inline-flex items-center gap-2">
                                            <Favicon url={`https://${c.domain}`} size={14} />
                                            {c.domain}
                                            {c.is_you && <span className="text-[10px] font-black text-emerald-600">YOU</span>}
                                        </span>
                                    </td>
                                    <td className="px-4 py-2.5 text-center font-bold text-slate-700">{c.citations}</td>
                                    <td className="px-4 py-2.5 text-center text-slate-500">{c.keywords}</td>
                                    <td className="px-4 py-2.5 text-xs text-slate-500">{(c.example_keywords || []).join(', ')}</td>
                                </tr>
                            ))}
                            {!data.competitors?.competitors?.length && (
                                <tr><td colSpan={4} className="px-4 py-8 text-center text-sm text-slate-400">
                                    No AI Overview citations captured yet.
                                </td></tr>
                            )}
                        </tbody>
                    </table>
                )}

                {!loading && tab === 'sources' && (
                    <table className="w-full text-sm">
                        <thead className="bg-slate-50 text-[11px] uppercase tracking-wider text-slate-500">
                            <tr>
                                <th className="px-4 py-2.5 text-left">Page</th>
                                <th className="px-4 py-2.5 text-left">Domain</th>
                                <th className="px-4 py-2.5 text-left">Surfaced for</th>
                            </tr>
                        </thead>
                        <tbody>
                            {(data.sources?.sources || []).map(s => (
                                <tr key={s.url} className={`border-t border-slate-100 ${s.is_you ? 'bg-emerald-50/50' : ''}`}>
                                    <td className="px-4 py-2.5">
                                        <a href={s.url} target="_blank" rel="noreferrer"
                                           className="text-violet-600 hover:underline font-medium">{s.title || s.url}</a>
                                    </td>
                                    <td className="px-4 py-2.5 text-slate-500 text-xs">{s.domain}</td>
                                    <td className="px-4 py-2.5 text-slate-500 text-xs">{s.keyword}</td>
                                </tr>
                            ))}
                            {!data.sources?.sources?.length && (
                                <tr><td colSpan={3} className="px-4 py-8 text-center text-sm text-slate-400">
                                    No sources captured yet.
                                </td></tr>
                            )}
                        </tbody>
                    </table>
                )}
            </div>
        </div>
    );
}

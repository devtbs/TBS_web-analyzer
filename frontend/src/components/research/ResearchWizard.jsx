import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { MagnifyingGlassIcon, ArrowRightIcon, ArrowLeftIcon, SparklesIcon, PlusIcon } from '@heroicons/react/24/outline';
import toast from 'react-hot-toast';
import api from '../../api/axios';
import Favicon from '../ui/Favicon';

/* Guided keyword-research wizard: seed → live SERP → pick competitor domains → their keywords →
   cluster → build the full topical map from the curated selection. */

const bareDomain = (u) => (u || '').replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '');
const kdColor = (kd) => kd == null ? 'text-slate-400' : kd <= 30 ? 'text-emerald-600' : kd <= 50 ? 'text-amber-600' : 'text-red-500';

const Stepper = ({ step }) => (
    <div className="flex items-center gap-2 mb-6 flex-wrap">
        {['Search', 'Competitors', 'Keywords', 'Clusters'].map((label, i) => {
            const n = i + 1, active = n === step, done = n < step;
            return (
                <div key={label} className="flex items-center gap-2">
                    <span className={`w-6 h-6 rounded-full flex items-center justify-center text-[12px] font-bold ${
                        active ? 'bg-[#26397A] text-white' : done ? 'bg-emerald-500 text-white' : 'bg-slate-200 text-slate-500'}`}>{n}</span>
                    <span className={`text-[13px] font-semibold ${active ? 'text-slate-800' : 'text-slate-400'}`}>{label}</span>
                    {n < 4 && <span className="w-6 h-px bg-slate-200" />}
                </div>
            );
        })}
    </div>
);

export default function ResearchWizard() {
    const navigate = useNavigate();
    const [step, setStep] = useState(1);
    const [busy, setBusy] = useState(false);

    const [query, setQuery] = useState('');
    const [serp, setSerp] = useState(null);
    const [topQueries, setTopQueries] = useState([]);

    const [selectedDomains, setSelectedDomains] = useState(new Set());
    const [manualDomain, setManualDomain] = useState('');
    const [manualDomains, setManualDomains] = useState([]);

    const [keywords, setKeywords] = useState([]);
    const [selectedKw, setSelectedKw] = useState(new Set());
    const [excludeRanked, setExcludeRanked] = useState(false);

    const [clusters, setClusters] = useState([]);

    const targetSite = localStorage.getItem('gsc_selected_property') || '';
    const gscProperty = targetSite;

    const runSearch = async () => {
        if (!query.trim()) { toast.error('Enter a search query'); return; }
        setBusy(true);
        try {
            const res = await api.post('/api/research/serp', { query: query.trim(), domain: bareDomain(targetSite) });
            setSerp(res.data.serp);
            setTopQueries(res.data.top_queries || []);
            setStep(2);
        } catch { toast.error('Search failed'); } finally { setBusy(false); }
    };

    const toggle = (set, setter, val) => {
        const n = new Set(set); n.has(val) ? n.delete(val) : n.add(val); setter(n);
    };

    const addManual = () => {
        const d = bareDomain(manualDomain.trim());
        if (d && !manualDomains.includes(d)) { setManualDomains([...manualDomains, d]); }
        setManualDomain('');
    };

    const allDomains = () => [...new Set([...selectedDomains, ...manualDomains])];

    const fetchKeywords = async () => {
        const domains = allDomains();
        if (domains.length === 0) { toast.error('Pick or add at least one domain'); return; }
        setBusy(true);
        try {
            const res = await api.post('/api/research/keywords', {
                seed: query.trim(), domains, domain: bareDomain(targetSite),
                exclude_ranked: excludeRanked, gsc_property: gscProperty || undefined,
            });
            const kws = res.data.keywords || [];
            setKeywords(kws);
            setSelectedKw(new Set(kws.slice(0, 40).map(k => k.keyword)));  // default-check top 40
            setStep(3);
        } catch { toast.error('Could not fetch keywords'); } finally { setBusy(false); }
    };

    const runCluster = async () => {
        const chosen = keywords.filter(k => selectedKw.has(k.keyword));
        if (chosen.length < 2) { toast.error('Select at least 2 keywords'); return; }
        setBusy(true);
        try {
            const res = await api.post('/api/research/cluster', { keywords: chosen, domain: bareDomain(targetSite) });
            setClusters(res.data.clusters || []);
            setStep(4);
        } catch { toast.error('Clustering failed'); } finally { setBusy(false); }
    };

    const buildMap = async () => {
        const chosen = keywords.filter(k => selectedKw.has(k.keyword));
        const site = targetSite || (allDomains()[0] ? `https://${allDomains()[0]}/` : '');
        if (!site) { toast.error('No target site — select a client first'); return; }
        setBusy(true);
        try {
            const res = await api.post('/api/analyze', {
                urls: [site],
                research: { seed: query.trim(), domains: allDomains(), keywords: chosen, clusters },
            });
            navigate(`/results/${res.data.analysis_id}`);
        } catch (e) { toast.error(e.response?.data?.detail || 'Build failed'); setBusy(false); }
    };

    return (
        <div className="max-w-[900px] mx-auto">
            <Stepper step={step} />

            {/* Step 1 — Search */}
            {step === 1 && (
                <div>
                    <div className="flex gap-3">
                        <div className="relative flex-1">
                            <MagnifyingGlassIcon className="w-5 h-5 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                            <input value={query} onChange={e => setQuery(e.target.value)} onKeyDown={e => e.key === 'Enter' && runSearch()}
                                placeholder="Search query (e.g. sommelier course bangkok)"
                                className="w-full pl-11 pr-4 py-3 border border-slate-300 rounded-xl text-[15px] outline-none focus:ring-2 focus:ring-emerald-500/30" />
                        </div>
                        <button onClick={runSearch} disabled={busy}
                            className="px-6 bg-[#26397A] text-white rounded-xl font-bold text-[15px] disabled:opacity-60">
                            {busy ? 'Searching…' : 'Test Search'}
                        </button>
                    </div>
                    <p className="text-[13px] text-slate-400 mt-3">Type a topic to see who ranks and the top related queries — then pick competitors to mine.</p>
                </div>
            )}

            {/* Step 2 — SERP results + pick domains */}
            {step === 2 && serp && (
                <div>
                    {topQueries.length > 0 && (
                        <div className="mb-5">
                            <p className="text-[13px] font-bold text-slate-600 mb-2">Top related queries</p>
                            <div className="flex flex-wrap gap-2">
                                {topQueries.map((q, i) => (
                                    <span key={i} className="px-2.5 py-1 rounded-full bg-indigo-50 text-indigo-700 text-[12px] font-medium">
                                        {q.keyword}{q.volume ? ` · ${q.volume.toLocaleString()}` : ''}
                                    </span>
                                ))}
                            </div>
                        </div>
                    )}
                    <p className="text-[13px] font-bold text-slate-600 mb-2">Who ranks for "{serp.query}" — select competitors to analyze</p>
                    <div className="border border-slate-200 rounded-xl divide-y divide-slate-100 mb-4">
                        {serp.organic.map((r, i) => {
                            const checked = selectedDomains.has(r.domain);
                            return (
                                <label key={i} className="flex items-start gap-3 px-4 py-3 cursor-pointer hover:bg-slate-50">
                                    <input type="checkbox" checked={checked} onChange={() => toggle(selectedDomains, setSelectedDomains, r.domain)}
                                        className="mt-1 rounded border-slate-300 text-emerald-600" />
                                    <Favicon url={r.url} size={18} className="mt-0.5 rounded" />
                                    <div className="min-w-0 flex-1">
                                        <p className="text-[14px] font-semibold text-slate-800 truncate">{r.title}</p>
                                        <p className="text-[12px] text-emerald-700 truncate">{r.domain} · #{r.position}</p>
                                        {r.snippet && <p className="text-[12px] text-slate-500 line-clamp-2 mt-0.5">{r.snippet}</p>}
                                    </div>
                                </label>
                            );
                        })}
                    </div>
                    <div className="flex gap-2 mb-4">
                        <input value={manualDomain} onChange={e => setManualDomain(e.target.value)} onKeyDown={e => e.key === 'Enter' && addManual()}
                            placeholder="Add any domain (e.g. wsetglobal.com)"
                            className="flex-1 border border-slate-300 rounded-lg px-3 py-2 text-[14px] outline-none focus:ring-2 focus:ring-emerald-500/30" />
                        <button onClick={addManual} className="px-3 border border-slate-300 rounded-lg text-slate-600 hover:bg-slate-50"><PlusIcon className="w-4 h-4" /></button>
                    </div>
                    {manualDomains.length > 0 && (
                        <div className="flex flex-wrap gap-2 mb-4">
                            {manualDomains.map(d => <span key={d} className="px-2.5 py-1 rounded-full bg-slate-100 text-slate-600 text-[12px] font-medium">{d}</span>)}
                        </div>
                    )}
                    <div className="flex items-center justify-between">
                        <button onClick={() => setStep(1)} className="flex items-center gap-1 text-[13px] font-semibold text-slate-500"><ArrowLeftIcon className="w-4 h-4" /> Back</button>
                        <button onClick={fetchKeywords} disabled={busy}
                            className="flex items-center gap-2 px-5 py-2.5 bg-[#26397A] text-white rounded-lg font-bold text-[14px] disabled:opacity-60">
                            {busy ? 'Fetching…' : <>Get keywords ({allDomains().length}) <ArrowRightIcon className="w-4 h-4" /></>}
                        </button>
                    </div>
                </div>
            )}

            {/* Step 3 — Keyword table */}
            {step === 3 && (
                <div>
                    <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
                        <p className="text-[13px] font-bold text-slate-600">{keywords.length} keywords · {selectedKw.size} selected</p>
                        {gscProperty && (
                            <label className="flex items-center gap-2 text-[13px] text-slate-500">
                                <input type="checkbox" checked={excludeRanked} onChange={e => { setExcludeRanked(e.target.checked); }} className="rounded border-slate-300 text-emerald-600" />
                                Hide keywords I already rank for (re-fetch)
                            </label>
                        )}
                    </div>
                    <div className="border border-slate-200 rounded-xl overflow-hidden max-h-[440px] overflow-y-auto mb-4">
                        <table className="w-full text-[13px]">
                            <thead className="bg-slate-50 sticky top-0">
                                <tr className="text-[11px] uppercase text-slate-400">
                                    <th className="w-8 py-2"></th>
                                    <th className="text-left py-2 px-2 font-bold">Keyword</th>
                                    <th className="text-right py-2 px-2 font-bold">Vol</th>
                                    <th className="text-right py-2 px-2 font-bold">KD</th>
                                </tr>
                            </thead>
                            <tbody>
                                {keywords.map((k, i) => (
                                    <tr key={i} className="border-t border-slate-50 hover:bg-slate-50">
                                        <td className="text-center"><input type="checkbox" checked={selectedKw.has(k.keyword)} onChange={() => toggle(selectedKw, setSelectedKw, k.keyword)} className="rounded border-slate-300 text-emerald-600" /></td>
                                        <td className="py-1.5 px-2 text-slate-800 font-medium">{k.keyword}</td>
                                        <td className="py-1.5 px-2 text-right font-bold text-indigo-700 tabular-nums">{(k.volume || 0).toLocaleString()}</td>
                                        <td className={`py-1.5 px-2 text-right font-bold tabular-nums ${kdColor(k.kd)}`}>{k.kd == null ? '—' : k.kd}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                    <div className="flex items-center justify-between">
                        <button onClick={() => setStep(2)} className="flex items-center gap-1 text-[13px] font-semibold text-slate-500"><ArrowLeftIcon className="w-4 h-4" /> Back</button>
                        <div className="flex gap-2">
                            {excludeRanked && <button onClick={fetchKeywords} disabled={busy} className="px-4 py-2.5 border border-slate-300 rounded-lg text-[14px] font-semibold text-slate-600">Apply filter</button>}
                            <button onClick={runCluster} disabled={busy} className="flex items-center gap-2 px-5 py-2.5 bg-[#26397A] text-white rounded-lg font-bold text-[14px] disabled:opacity-60">
                                {busy ? 'Clustering…' : <>Cluster ({selectedKw.size}) <ArrowRightIcon className="w-4 h-4" /></>}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Step 4 — Clusters + build */}
            {step === 4 && (
                <div>
                    <p className="text-[13px] font-bold text-slate-600 mb-3">{clusters.length} content clusters — each = one page to create</p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-5">
                        {clusters.map((c, i) => (
                            <div key={i} className="rounded-xl border border-slate-200 p-3.5">
                                <div className="flex items-center justify-between mb-2">
                                    <span className="font-bold text-slate-800 text-[14px] truncate">{c.label}</span>
                                    <span className="text-[12px] font-bold text-teal-700">{(c.total_volume || 0).toLocaleString()}/mo</span>
                                </div>
                                <div className="flex flex-wrap gap-1.5">
                                    {(c.keywords || []).slice(0, 8).map((k, j) => (
                                        <span key={j} className="px-2 py-0.5 rounded-full bg-teal-50 text-teal-700 text-[11px] font-medium">{k.keyword}</span>
                                    ))}
                                </div>
                            </div>
                        ))}
                    </div>
                    <div className="flex items-center justify-between">
                        <button onClick={() => setStep(3)} className="flex items-center gap-1 text-[13px] font-semibold text-slate-500"><ArrowLeftIcon className="w-4 h-4" /> Back</button>
                        <button onClick={buildMap} disabled={busy}
                            className="flex items-center gap-2 px-6 py-3 bg-emerald-600 text-white rounded-xl font-bold text-[15px] disabled:opacity-60">
                            <SparklesIcon className="w-5 h-5" /> {busy ? 'Building…' : 'Build topical map'}
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}

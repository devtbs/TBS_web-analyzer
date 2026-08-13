import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRightIcon, ArrowLeftIcon, SparklesIcon, PlusIcon, GlobeAltIcon } from '@heroicons/react/24/outline';
import toast from 'react-hot-toast';
import api from '../../api/axios';
import Favicon from '../ui/Favicon';
import GSCPropertySelector from '../gsc/GSCPropertySelector';

/* Guided research v2: pick a site → AI suggests 10 queries from it → pick several → aggregated
   competitors → their keywords → cluster → build the full topical map from the curated selection. */

const bareDomain = (u) => (u || '').replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '');
const kdColor = (kd) => kd == null ? 'text-slate-400' : kd <= 30 ? 'text-emerald-600' : kd <= 50 ? 'text-amber-600' : 'text-red-500';
const STEPS = ['Site', 'Queries', 'Competitors', 'Keywords', 'Clusters'];

const Stepper = ({ step }) => (
    <div className="flex items-center gap-2 mb-6 flex-wrap">
        {STEPS.map((label, i) => {
            const n = i + 1, active = n === step, done = n < step;
            return (
                <div key={label} className="flex items-center gap-2">
                    <span className={`w-6 h-6 rounded-full flex items-center justify-center text-[12px] font-bold ${
                        active ? 'bg-[#26397A] text-white' : done ? 'bg-emerald-500 text-white' : 'bg-slate-200 text-slate-500'}`}>{n}</span>
                    <span className={`text-[13px] font-semibold ${active ? 'text-slate-800' : 'text-slate-400'}`}>{label}</span>
                    {n < STEPS.length && <span className="w-5 h-px bg-slate-200" />}
                </div>
            );
        })}
    </div>
);

const toggle = (set, setter, val) => { const n = new Set(set); n.has(val) ? n.delete(val) : n.add(val); setter(n); };

export default function ResearchWizard() {
    const navigate = useNavigate();
    const [step, setStep] = useState(1);
    const [busy, setBusy] = useState(false);

    // Step 1 — site
    const [siteProps, setSiteProps] = useState([]);
    const [manualUrl, setManualUrl] = useState('');
    const site = (manualUrl.trim() || siteProps[0]?.url || '');
    const siteDomain = bareDomain(site);
    const gscProperty = siteProps[0]?.url || '';

    // Step 2 — AI queries
    const [aiQueries, setAiQueries] = useState([]);
    const [selectedQueries, setSelectedQueries] = useState(new Set());

    // Step 3 — competitors
    const [competitors, setCompetitors] = useState([]);
    const [selectedDomains, setSelectedDomains] = useState(new Set());
    const [manualDomain, setManualDomain] = useState('');
    const [manualDomains, setManualDomains] = useState([]);

    // Step 4 — keywords
    const [keywords, setKeywords] = useState([]);
    const [selectedKw, setSelectedKw] = useState(new Set());
    const [excludeRanked, setExcludeRanked] = useState(true);   // default: surface NEW opportunities

    // Step 5 — clusters
    const [clusters, setClusters] = useState([]);

    const allDomains = () => [...new Set([...selectedDomains, ...manualDomains])];

    const analyzeSite = async () => {
        if (!site) { toast.error('Select a site or enter a URL'); return; }
        setBusy(true);
        try {
            const res = await api.post('/api/research/suggest-queries', { url: site });
            const qs = res.data.queries || [];
            if (!qs.length) { toast.error('Could not read that site — try another URL'); return; }
            setAiQueries(qs);
            setSelectedQueries(new Set(qs.slice(0, 5)));   // default-check the first 5
            setStep(2);
        } catch { toast.error('Site analysis failed'); } finally { setBusy(false); }
    };

    const findCompetitors = async () => {
        const queries = [...selectedQueries];
        if (queries.length === 0) { toast.error('Pick at least one query'); return; }
        setBusy(true);
        try {
            const res = await api.post('/api/research/serp', { queries, domain: siteDomain });
            setCompetitors((res.data.competitors || []).filter(c => bareDomain(c.domain) !== siteDomain));
            setStep(3);
        } catch { toast.error('Competitor search failed'); } finally { setBusy(false); }
    };

    const addManual = () => {
        const d = bareDomain(manualDomain.trim());
        if (d && !manualDomains.includes(d)) setManualDomains([...manualDomains, d]);
        setManualDomain('');
    };

    const fetchKeywords = async () => {
        const domains = allDomains();
        if (domains.length === 0) { toast.error('Pick or add at least one domain'); return; }
        setBusy(true);
        try {
            const res = await api.post('/api/research/keywords', {
                seeds: [...selectedQueries], domains, domain: siteDomain,
                exclude_ranked: excludeRanked, gsc_property: gscProperty || undefined,
            });
            const kws = res.data.keywords || [];
            setKeywords(kws);
            setSelectedKw(new Set(kws.slice(0, 40).map(k => k.keyword)));
            setStep(4);
        } catch { toast.error('Could not fetch keywords'); } finally { setBusy(false); }
    };

    const runCluster = async () => {
        const chosen = keywords.filter(k => selectedKw.has(k.keyword));
        if (chosen.length < 2) { toast.error('Select at least 2 keywords'); return; }
        setBusy(true);
        try {
            const res = await api.post('/api/research/cluster', { keywords: chosen, domain: siteDomain });
            setClusters(res.data.clusters || []);
            setStep(5);
        } catch { toast.error('Clustering failed'); } finally { setBusy(false); }
    };

    const buildMap = async () => {
        const chosen = keywords.filter(k => selectedKw.has(k.keyword));
        if (!site) { toast.error('No target site'); return; }
        setBusy(true);
        try {
            const res = await api.post('/api/analyze', {
                urls: [site.startsWith('http') ? site : `https://${site}`],
                research: { seeds: [...selectedQueries], domains: allDomains(), keywords: chosen, clusters },
            });
            navigate(`/results/${res.data.analysis_id}`);
        } catch (e) { toast.error(e.response?.data?.detail || 'Build failed'); setBusy(false); }
    };

    const BackBtn = ({ to }) => (
        <button onClick={() => setStep(to)} className="flex items-center gap-1 text-[13px] font-semibold text-slate-500"><ArrowLeftIcon className="w-4 h-4" /> Back</button>
    );

    return (
        <div className="max-w-[900px] mx-auto">
            <Stepper step={step} />

            {/* Step 1 — Select site */}
            {step === 1 && (
                <div>
                    <p className="text-[13px] font-bold text-slate-600 mb-2">Select the site to research</p>
                    <GSCPropertySelector onPropertySelect={setSiteProps} selectedProperties={siteProps} />
                    <div className="flex items-center gap-2 my-4">
                        <span className="h-px bg-slate-200 flex-1" /><span className="text-[12px] text-slate-400">or enter a URL</span><span className="h-px bg-slate-200 flex-1" />
                    </div>
                    <div className="flex gap-2">
                        <div className="relative flex-1">
                            <GlobeAltIcon className="w-5 h-5 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                            <input value={manualUrl} onChange={e => setManualUrl(e.target.value)}
                                placeholder="https://example.com"
                                className="w-full pl-11 pr-4 py-3 border border-slate-300 rounded-xl text-[15px] outline-none focus:ring-2 focus:ring-emerald-500/30" />
                        </div>
                        <button onClick={analyzeSite} disabled={busy || !site}
                            className="px-6 bg-[#26397A] text-white rounded-xl font-bold text-[15px] disabled:opacity-50">
                            {busy ? 'Analyzing…' : 'Analyze site'}
                        </button>
                    </div>
                    {site && <p className="text-[12px] text-slate-400 mt-2">Target: {site}</p>}
                </div>
            )}

            {/* Step 2 — AI queries (multi-select) */}
            {step === 2 && (
                <div>
                    <p className="text-[13px] font-bold text-slate-600 mb-1">The AI read {siteDomain} and suggests these queries</p>
                    <p className="text-[12px] text-slate-400 mb-3">Pick the ones to research — competitors & keywords will combine across them.</p>
                    <div className="flex flex-wrap gap-2 mb-5">
                        {aiQueries.map((q, i) => {
                            const on = selectedQueries.has(q);
                            return (
                                <button key={i} onClick={() => toggle(selectedQueries, setSelectedQueries, q)}
                                    className={`px-3 py-2 rounded-full text-[13px] font-semibold border transition-colors ${
                                        on ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-white text-slate-600 border-slate-300 hover:border-emerald-400'}`}>
                                    {q}
                                </button>
                            );
                        })}
                    </div>
                    <div className="flex items-center justify-between">
                        <BackBtn to={1} />
                        <button onClick={findCompetitors} disabled={busy}
                            className="flex items-center gap-2 px-5 py-2.5 bg-[#26397A] text-white rounded-lg font-bold text-[14px] disabled:opacity-60">
                            {busy ? 'Searching…' : <>Find competitors ({selectedQueries.size}) <ArrowRightIcon className="w-4 h-4" /></>}
                        </button>
                    </div>
                </div>
            )}

            {/* Step 3 — Competitors (aggregated across selected queries) */}
            {step === 3 && (
                <div>
                    <p className="text-[13px] font-bold text-slate-600 mb-2">Sites ranking across your queries — select competitors to analyze</p>
                    <div className="border border-slate-200 rounded-xl divide-y divide-slate-100 mb-4 max-h-[360px] overflow-y-auto">
                        {competitors.map((c, i) => {
                            const checked = selectedDomains.has(c.domain);
                            return (
                                <label key={i} className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-slate-50">
                                    <input type="checkbox" checked={checked} onChange={() => toggle(selectedDomains, setSelectedDomains, c.domain)} className="rounded border-slate-300 text-emerald-600" />
                                    <Favicon url={c.url || `https://${c.domain}/`} size={18} className="rounded" />
                                    <div className="min-w-0 flex-1">
                                        <p className="text-[14px] font-semibold text-slate-800 truncate">{c.domain}</p>
                                        {c.title && <p className="text-[12px] text-slate-500 truncate">{c.title}</p>}
                                    </div>
                                    {c.position != null && <span className="text-[12px] text-emerald-700 font-bold">#{c.position}</span>}
                                </label>
                            );
                        })}
                        {competitors.length === 0 && <div className="px-4 py-6 text-center text-slate-400 text-[13px]">No competitors found — add domains manually below.</div>}
                    </div>
                    <div className="flex gap-2 mb-4">
                        <input value={manualDomain} onChange={e => setManualDomain(e.target.value)} onKeyDown={e => e.key === 'Enter' && addManual()}
                            placeholder="Add any domain (e.g. wsetglobal.com)"
                            className="flex-1 border border-slate-300 rounded-lg px-3 py-2 text-[14px] outline-none focus:ring-2 focus:ring-emerald-500/30" />
                        <button onClick={addManual} className="px-3 border border-slate-300 rounded-lg text-slate-600 hover:bg-slate-50"><PlusIcon className="w-4 h-4" /></button>
                    </div>
                    {manualDomains.length > 0 && (
                        <div className="flex flex-wrap gap-2 mb-4">{manualDomains.map(d => <span key={d} className="px-2.5 py-1 rounded-full bg-slate-100 text-slate-600 text-[12px] font-medium">{d}</span>)}</div>
                    )}
                    <div className="flex items-center justify-between">
                        <BackBtn to={2} />
                        <button onClick={fetchKeywords} disabled={busy} className="flex items-center gap-2 px-5 py-2.5 bg-[#26397A] text-white rounded-lg font-bold text-[14px] disabled:opacity-60">
                            {busy ? 'Fetching…' : <>Get keywords ({allDomains().length}) <ArrowRightIcon className="w-4 h-4" /></>}
                        </button>
                    </div>
                </div>
            )}

            {/* Step 4 — Keywords */}
            {step === 4 && (
                <div>
                    <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
                        <p className="text-[13px] font-bold text-slate-600">{keywords.length} keywords · {selectedKw.size} selected</p>
                        {gscProperty && (
                            <label className="flex items-center gap-2 text-[13px] text-slate-500">
                                <input type="checkbox" checked={excludeRanked} onChange={e => setExcludeRanked(e.target.checked)} className="rounded border-slate-300 text-emerald-600" />
                                Hide keywords I already rank for
                            </label>
                        )}
                    </div>
                    <div className="border border-slate-200 rounded-xl overflow-hidden max-h-[420px] overflow-y-auto mb-4">
                        <table className="w-full text-[13px]">
                            <thead className="bg-slate-50 sticky top-0"><tr className="text-[11px] uppercase text-slate-400">
                                <th className="w-8 py-2"></th><th className="text-left py-2 px-2 font-bold">Keyword</th>
                                <th className="text-right py-2 px-2 font-bold">Vol</th><th className="text-right py-2 px-2 font-bold">KD</th>
                            </tr></thead>
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
                        <BackBtn to={3} />
                        <div className="flex gap-2">
                            {gscProperty && <button onClick={fetchKeywords} disabled={busy} className="px-4 py-2.5 border border-slate-300 rounded-lg text-[14px] font-semibold text-slate-600">Apply filter</button>}
                            <button onClick={runCluster} disabled={busy} className="flex items-center gap-2 px-5 py-2.5 bg-[#26397A] text-white rounded-lg font-bold text-[14px] disabled:opacity-60">
                                {busy ? 'Clustering…' : <>Cluster ({selectedKw.size}) <ArrowRightIcon className="w-4 h-4" /></>}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Step 5 — Clusters → build */}
            {step === 5 && (
                <div>
                    <p className="text-[13px] font-bold text-slate-600 mb-3">{clusters.length} content clusters — each = one page to create</p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-5 max-h-[420px] overflow-y-auto">
                        {clusters.map((c, i) => (
                            <div key={i} className="rounded-xl border border-slate-200 p-3.5">
                                <div className="flex items-center justify-between mb-2">
                                    <span className="font-bold text-slate-800 text-[14px] truncate">{c.label}</span>
                                    <span className="text-[12px] font-bold text-teal-700">{(c.total_volume || 0).toLocaleString()}/mo</span>
                                </div>
                                <div className="flex flex-wrap gap-1.5">
                                    {(c.keywords || []).slice(0, 8).map((k, j) => <span key={j} className="px-2 py-0.5 rounded-full bg-teal-50 text-teal-700 text-[11px] font-medium">{k.keyword}</span>)}
                                </div>
                            </div>
                        ))}
                    </div>
                    <div className="flex items-center justify-between">
                        <BackBtn to={4} />
                        <button onClick={buildMap} disabled={busy} className="flex items-center gap-2 px-6 py-3 bg-emerald-600 text-white rounded-xl font-bold text-[15px] disabled:opacity-60">
                            <SparklesIcon className="w-5 h-5" /> {busy ? 'Building…' : 'Build topical map'}
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}

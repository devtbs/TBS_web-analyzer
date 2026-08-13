import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRightIcon, ArrowLeftIcon, SparklesIcon, PlusIcon, GlobeAltIcon } from '@heroicons/react/24/outline';
import toast from 'react-hot-toast';
import api from '../../api/axios';
import Favicon from '../ui/Favicon';
import GSCPropertySelector from '../gsc/GSCPropertySelector';

/* Guided research v2: pick a site → AI suggests 10 queries from it → pick several → aggregated
   competitors → their keywords → cluster → build the full topical map from the curated selection. */

const bareDomain = (u) => (u || '').replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '');
// Country → SERP gl code + Mangools location_id.
const COUNTRIES = [
    { label: 'Thailand', gl: 'th', locId: 2764 }, { label: 'United States', gl: 'us', locId: 2840 },
    { label: 'United Kingdom', gl: 'uk', locId: 2826 }, { label: 'Australia', gl: 'au', locId: 2036 },
    { label: 'Singapore', gl: 'sg', locId: 2702 }, { label: 'Malaysia', gl: 'my', locId: 2458 },
    { label: 'Philippines', gl: 'ph', locId: 2608 }, { label: 'Vietnam', gl: 'vn', locId: 2704 },
    { label: 'India', gl: 'in', locId: 2356 }, { label: 'Japan', gl: 'jp', locId: 2392 },
    { label: 'Canada', gl: 'ca', locId: 2124 }, { label: 'Germany', gl: 'de', locId: 2276 },
    { label: 'France', gl: 'fr', locId: 2250 },
];
const guessCountry = (domain) => {
    const d = (domain || '').toLowerCase();
    if (d.endsWith('.co.uk')) return 'uk';
    if (d.endsWith('.com.au')) return 'au';
    const tld = d.split('.').pop();
    return (COUNTRIES.find(c => c.gl === tld) || {}).gl || 'th';
};
const kdColor = (kd) => kd == null ? 'text-slate-400' : kd <= 30 ? 'text-emerald-600' : kd <= 50 ? 'text-amber-600' : 'text-red-500';

// Near-duplicate collapse: keywords that reduce to the same word-set are rewordings of one topic
// (e.g. "wine pairing" / "pairing wine" / "paired wine") — keep the highest-volume representative.
const _STOP = new Set(['with', 'and', 'for', 'the', 'to', 'of', 'a', 'an', 'in', 'on', 'vs', 'your', 'my', 'is', 'are']);
const _stem = (w) => (w.length > 4 ? w.replace(/(ings|ing|ed|es|s)$/, '') : w);
const _sig = (kw) => (kw || '').toLowerCase().split(/\s+/).filter(w => w && !_STOP.has(w)).map(_stem).sort().join(' ');
const dedupeNear = (list) => {
    const by = new Map();
    for (const k of list) {
        const s = _sig(k.keyword);
        const cur = by.get(s);
        if (!cur || (k.volume || 0) > (cur.volume || 0)) by.set(s, k);
    }
    return [...by.values()].sort((a, b) => (b.volume || 0) - (a.volume || 0));
};
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

export default function ResearchWizard({ clientId = null }) {
    const navigate = useNavigate();
    const [step, setStep] = useState(1);
    const [busy, setBusy] = useState(false);

    // Save / resume
    const [runId, setRunId] = useState(null);
    const [savedRuns, setSavedRuns] = useState([]);
    const [saving, setSaving] = useState(false);
    const [lastSaved, setLastSaved] = useState(null);

    // Credit/quota visibility
    const [quota, setQuota] = useState(null);
    // Transparency: what the last keyword fetch filtered out
    const [kwMeta, setKwMeta] = useState(null);

    // Step 1 — site
    const [siteProps, setSiteProps] = useState([]);
    const [manualUrl, setManualUrl] = useState('');
    const site = (manualUrl.trim() || siteProps[0]?.url || '');
    const siteDomain = bareDomain(site);
    const gscProperty = siteProps[0]?.url || '';

    // Country/market for SERP + keyword volumes — defaults from the site's TLD, user can override.
    const [countryGl, setCountryGl] = useState('th');
    useEffect(() => { if (siteDomain) setCountryGl(guessCountry(siteDomain)); }, [siteDomain]);
    const country = COUNTRIES.find(c => c.gl === countryGl) || COUNTRIES[0];
    const loc = () => ({ gl: country.gl, location_id: country.locId });

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
    const [maxKd, setMaxKd] = useState(null);                   // 'worth working on' difficulty ceiling
    const [minVol, setMinVol] = useState(0);                    // hide low-volume long-tail noise
    const [groupSimilar, setGroupSimilar] = useState(true);     // collapse near-duplicate rewordings

    // Step 5 — clusters
    const [clusters, setClusters] = useState([]);

    // Load credit balance + any saved runs (for this client, if embedded in the hub) on mount.
    useEffect(() => {
        api.get('/api/research/quota').then(r => setQuota(r.data)).catch(() => {});
        loadRuns();
    }, []);   // eslint-disable-line react-hooks/exhaustive-deps

    const loadRuns = async () => {
        try {
            const r = await api.get('/api/research/runs', { params: clientId ? { client_id: clientId } : {} });
            setSavedRuns(r.data.runs || []);
        } catch { /* non-fatal */ }
    };

    // Snapshot the whole wizard so a run can be reopened and continued later.
    const snapshot = () => ({
        step, countryGl, manualUrl,
        aiQueries, selectedQueries: [...selectedQueries],
        competitors, selectedDomains: [...selectedDomains], manualDomains,
        keywords, selectedKw: [...selectedKw], excludeRanked, maxKd, minVol, groupSimilar,
        clusters,
    });

    const restore = (s) => {
        if (!s) return;
        setManualUrl(s.manualUrl || '');
        setCountryGl(s.countryGl || 'th');
        setAiQueries(s.aiQueries || []);
        setSelectedQueries(new Set(s.selectedQueries || []));
        setCompetitors(s.competitors || []);
        setSelectedDomains(new Set(s.selectedDomains || []));
        setManualDomains(s.manualDomains || []);
        setKeywords(s.keywords || []);
        setSelectedKw(new Set(s.selectedKw || []));
        setExcludeRanked(s.excludeRanked !== false);
        setMaxKd(s.maxKd ?? null);
        setMinVol(s.minVol ?? 0);
        setGroupSimilar(s.groupSimilar !== false);
        setClusters(s.clusters || []);
        setStep(s.step || 1);
    };

    const saveRun = async () => {
        if (!site) { toast.error('Nothing to save yet — select a site first'); return; }
        setSaving(true);
        try {
            const res = await api.post('/api/research/runs', {
                id: runId, name: siteDomain || 'Research', domain: siteDomain,
                site_url: site, client_id: clientId, gl: country.gl, location_id: country.locId,
                step, state: snapshot(),
            });
            setRunId(res.data.id);
            setLastSaved(new Date());
            loadRuns();
            toast.success('Research saved');
        } catch { toast.error('Save failed'); } finally { setSaving(false); }
    };

    const openRun = async (id) => {
        setBusy(true);
        try {
            const res = await api.get(`/api/research/runs/${id}`);
            setRunId(res.data.id);
            restore(res.data.state);
            toast.success('Loaded saved research');
        } catch { toast.error('Could not open that run'); } finally { setBusy(false); }
    };

    const deleteRun = async (id, e) => {
        e?.stopPropagation();
        try { await api.delete(`/api/research/runs/${id}`); if (id === runId) setRunId(null); loadRuns(); }
        catch { toast.error('Delete failed'); }
    };

    const allDomains = () => [...new Set([...selectedDomains, ...manualDomains])];
    // Collapse rewordings (optional), then KD filter (keeps easy + unknown, hides known-hard).
    const visibleKw = (groupSimilar ? dedupeNear(keywords) : keywords)
        .filter(k => maxKd == null || k.kd == null || k.kd <= maxKd)
        .filter(k => (k.volume || 0) >= minVol);

    const exportCsv = () => {
        const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
        const lines = [['Keyword', 'Volume', 'KD', 'CPC'].join(',')]
            .concat(visibleKw.map(k => [esc(k.keyword), k.volume || 0, k.kd ?? '', k.cpc ?? ''].join(',')));
        const blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = `keywords-${siteDomain || 'export'}.csv`; a.click();
        URL.revokeObjectURL(url);
    };

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
            const res = await api.post('/api/research/serp', { queries, domain: siteDomain, ...loc() });
            setCompetitors((res.data.competitors || []).filter(c => bareDomain(c.domain) !== siteDomain));
            setStep(3);
        } catch { toast.error('Competitor search failed'); } finally { setBusy(false); }
    };

    const addManual = () => {
        const d = bareDomain(manualDomain.trim());
        if (d && !manualDomains.includes(d)) setManualDomains([...manualDomains, d]);
        setManualDomain('');
    };

    const fetchKeywords = async (expand = false) => {
        const domains = allDomains();
        if (!expand && domains.length === 0) { toast.error('Pick or add at least one domain'); return; }
        setBusy(true);
        try {
            const res = await api.post('/api/research/keywords', {
                seeds: [...selectedQueries], domains, domain: siteDomain, ...loc(),
                exclude_ranked: excludeRanked, gsc_property: gscProperty || undefined, expand,
            });
            const kws = res.data.keywords || [];
            setKwMeta(res.data.meta || null);
            if (expand) {
                const seen = new Set(keywords.map(k => k.keyword.toLowerCase()));
                const added = kws.filter(k => !seen.has(k.keyword.toLowerCase()));
                setKeywords([...keywords, ...added]);
                setSelectedKw(s => { const n = new Set(s); added.slice(0, 30).forEach(k => n.add(k.keyword)); return n; });
                toast.success(added.length ? `Added ${added.length} more keywords` : 'No new keywords found');
            } else {
                setKeywords(kws);
                setSelectedKw(new Set(kws.slice(0, 40).map(k => k.keyword)));
                setStep(4);
            }
        } catch { toast.error('Could not fetch keywords'); } finally { setBusy(false); }
    };

    const runCluster = async () => {
        const chosen = keywords.filter(k => selectedKw.has(k.keyword));
        if (chosen.length < 2) { toast.error('Select at least 2 keywords'); return; }
        setBusy(true);
        try {
            const res = await api.post('/api/research/cluster', { keywords: chosen, domain: siteDomain, ...loc() });
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
            // Persist the run + link it to the analysis it produced, so the client hub can jump straight
            // back to the built map. Best-effort — never block navigation on the save.
            try {
                await api.post('/api/research/runs', {
                    id: runId, name: siteDomain || 'Research', domain: siteDomain, site_url: site,
                    client_id: clientId, gl: country.gl, location_id: country.locId, step,
                    state: snapshot(), analysis_id: res.data.analysis_id,
                });
            } catch { /* non-fatal */ }
            navigate(`/results/${res.data.analysis_id}`);
        } catch (e) { toast.error(e.response?.data?.detail || 'Build failed'); setBusy(false); }
    };

    // Per-run credit estimate — SERP charges per query (competitors + clustering); Mangools per
    // seed (+~4 adjacency) and per competitor domain. Rough, but stops silent quota burn.
    const serpEst = Math.max(selectedQueries.size, 0) + (clusters.length ? 0 : Math.min(selectedKw.size, 18));
    const mangoolsEst = selectedQueries.size + 4 + allDomains().length;

    const BackBtn = ({ to }) => (
        <button onClick={() => setStep(to)} className="flex items-center gap-1 text-[13px] font-semibold text-slate-500"><ArrowLeftIcon className="w-4 h-4" /> Back</button>
    );

    return (
        <div className="max-w-[900px] mx-auto">
            <div className="flex items-center justify-between gap-3 mb-2 flex-wrap">
                <div className="flex-1"><Stepper step={step} /></div>
                <div className="flex items-center gap-2 shrink-0">
                    <label className="flex items-center gap-2 text-[13px] text-slate-500">
                        <GlobeAltIcon className="w-4 h-4 text-slate-400" /> Market
                        <select value={countryGl} onChange={e => setCountryGl(e.target.value)}
                            className="border border-slate-300 rounded-lg px-2 py-1.5 text-[13px] font-semibold text-slate-700 outline-none focus:ring-2 focus:ring-emerald-500/30">
                            {COUNTRIES.map(c => <option key={c.gl} value={c.gl}>{c.label}</option>)}
                        </select>
                    </label>
                    <button onClick={saveRun} disabled={saving || !site}
                        className="px-3 py-1.5 rounded-lg border border-slate-300 text-[13px] font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50">
                        {saving ? 'Saving…' : runId ? 'Save' : 'Save research'}
                    </button>
                </div>
            </div>

            {/* Credit balance + this-run estimate — so a demo never silently burns paid API quota. */}
            <div className="flex items-center justify-between gap-3 mb-4 flex-wrap text-[12px] text-slate-400">
                <span>
                    {quota?.serpapi && !quota.serpapi.error && quota.serpapi.left != null
                        ? <>SerpAPI: <b className="text-slate-600">{quota.serpapi.left.toLocaleString()}</b> searches left</>
                        : quota?.serpapi?.error ? 'SerpAPI balance unavailable' : ' '}
                    {lastSaved && <span className="ml-3 text-emerald-600">✓ saved {lastSaved.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>}
                </span>
                <span title="Rough API cost of the next fetch">
                    Est. this run: ~{serpEst} SERP · ~{mangoolsEst} Mangools lookups
                </span>
            </div>

            {/* Saved research — resume a past run (also the client-hub entry point). */}
            {savedRuns.length > 0 && step === 1 && (
                <div className="mb-5 border border-slate-200 rounded-xl divide-y divide-slate-100">
                    <p className="px-4 py-2 text-[12px] font-bold text-slate-500 bg-slate-50 rounded-t-xl">Saved research ({savedRuns.length})</p>
                    <div className="max-h-[200px] overflow-y-auto">
                        {savedRuns.map(r => (
                            <div key={r.id} onClick={() => openRun(r.id)}
                                className="flex items-center gap-3 px-4 py-2.5 cursor-pointer hover:bg-slate-50">
                                <Favicon url={`https://${r.domain}/`} size={16} className="rounded" />
                                <div className="min-w-0 flex-1">
                                    <p className="text-[13px] font-semibold text-slate-800 truncate">{r.name}</p>
                                    <p className="text-[11px] text-slate-400">{r.keyword_count} keywords · {r.cluster_count} clusters · step {r.step}{r.analysis_id ? ' · map built' : ''}</p>
                                </div>
                                <span className="text-[11px] text-slate-400">{r.updated_at ? new Date(r.updated_at).toLocaleDateString() : ''}</span>
                                <button onClick={(e) => deleteRun(r.id, e)} className="text-slate-300 hover:text-red-500 text-[16px] leading-none px-1">×</button>
                            </div>
                        ))}
                    </div>
                </div>
            )}

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
                        <button onClick={() => fetchKeywords(false)} disabled={busy} className="flex items-center gap-2 px-5 py-2.5 bg-[#26397A] text-white rounded-lg font-bold text-[14px] disabled:opacity-60">
                            {busy ? 'Fetching…' : <>Get keywords ({allDomains().length}) <ArrowRightIcon className="w-4 h-4" /></>}
                        </button>
                    </div>
                </div>
            )}

            {/* Step 4 — Keywords */}
            {step === 4 && (
                <div>
                    <div className="flex items-center justify-between mb-1 flex-wrap gap-2">
                        <p className="text-[13px] font-bold text-slate-600">{visibleKw.length} shown · {selectedKw.size} selected</p>
                        <div className="flex items-center gap-3 flex-wrap">
                            {/* Min volume — hide the ultra-long-tail (vol ~10) noise */}
                            <div className="flex items-center gap-1 text-[12px]">
                                <span className="text-slate-400 mr-1">Min vol</span>
                                {[['All', 0], ['≥50', 50], ['≥100', 100], ['≥500', 500]].map(([lbl, v]) => (
                                    <button key={lbl} onClick={() => setMinVol(v)}
                                        className={`px-2 py-1 rounded-md font-semibold ${minVol === v ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-500 hover:text-slate-700'}`}>{lbl}</button>
                                ))}
                            </div>
                            {/* KD ceiling — 'worth working on' = easier to rank */}
                            <div className="flex items-center gap-1 text-[12px]">
                                <span className="text-slate-400 mr-1">Max KD</span>
                                {[['All', null], ['≤20', 20], ['≤30', 30], ['≤50', 50]].map(([lbl, v]) => (
                                    <button key={lbl} onClick={() => setMaxKd(v)}
                                        className={`px-2 py-1 rounded-md font-semibold ${maxKd === v ? 'bg-emerald-600 text-white' : 'bg-slate-100 text-slate-500 hover:text-slate-700'}`}>{lbl}</button>
                                ))}
                            </div>
                            <label className="flex items-center gap-2 text-[13px] text-slate-500">
                                <input type="checkbox" checked={groupSimilar} onChange={e => setGroupSimilar(e.target.checked)} className="rounded border-slate-300 text-emerald-600" />
                                Group similar
                            </label>
                            {gscProperty && (
                                <label className="flex items-center gap-2 text-[13px] text-slate-500">
                                    <input type="checkbox" checked={excludeRanked} onChange={e => setExcludeRanked(e.target.checked)} className="rounded border-slate-300 text-emerald-600" />
                                    Hide already-ranked
                                </label>
                            )}
                            <button onClick={exportCsv} className="text-[13px] font-semibold text-slate-500 hover:text-slate-700 underline">Export CSV</button>
                        </div>
                    </div>
                    {/* Why a keyword isn't here — makes the filter/dedupe explainable to a boss/client. */}
                    <p className="text-[12px] text-slate-400 mb-3">
                        {kwMeta && `${kwMeta.raw_count} found`}
                        {kwMeta?.filtered_off_topic > 0 && ` · ${kwMeta.filtered_off_topic} off-topic filtered`}
                        {kwMeta?.hidden_ranked > 0 && ` · ${kwMeta.hidden_ranked} already-ranked hidden`}
                        {groupSimilar && keywords.length - visibleKw.length > 0 && ` · ${keywords.length - visibleKw.length} similar grouped`}
                    </p>
                    <div className="border border-slate-200 rounded-xl overflow-hidden max-h-[420px] overflow-y-auto mb-4">
                        <table className="w-full text-[13px]">
                            <thead className="bg-slate-50 sticky top-0"><tr className="text-[11px] uppercase text-slate-400">
                                <th className="w-8 py-2"></th><th className="text-left py-2 px-2 font-bold">Keyword</th>
                                <th className="text-right py-2 px-2 font-bold">Vol</th><th className="text-right py-2 px-2 font-bold">KD</th>
                            </tr></thead>
                            <tbody>
                                {visibleKw.map((k, i) => (
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
                            {gscProperty && <button onClick={() => fetchKeywords(false)} disabled={busy} className="px-4 py-2.5 border border-slate-300 rounded-lg text-[14px] font-semibold text-slate-600">Apply filter</button>}
                            <button onClick={() => fetchKeywords(true)} disabled={busy}
                                className="flex items-center gap-2 px-4 py-2.5 border border-emerald-300 text-emerald-700 rounded-lg text-[14px] font-bold hover:bg-emerald-50 disabled:opacity-60">
                                <SparklesIcon className="w-4 h-4" /> {busy ? 'Finding…' : 'Find more'}
                            </button>
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

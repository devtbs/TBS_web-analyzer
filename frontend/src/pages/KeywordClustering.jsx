import { useState, useEffect, useRef, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { RectangleGroupIcon, ArrowPathIcon, ChevronDownIcon, ChevronUpIcon, GlobeAltIcon, TrashIcon } from '@heroicons/react/24/outline';
import toast from 'react-hot-toast';
import api from '../api/axios';
import GSCPropertySelector from '../components/gsc/GSCPropertySelector';

/* Keyword clustering — Keyword-Insights-style SERP-overlap clustering on our own SerpAPI.
   Paste/import keywords → live SERP fetch → cluster by shared ranking URLs → pillar + AI intent +
   AI page brief + GSC gap flag. Async job with progress; results persist. */

const COUNTRIES = [
    { label: 'Thailand', gl: 'th', locId: 2764 }, { label: 'United States', gl: 'us', locId: 2840 },
    { label: 'United Kingdom', gl: 'uk', locId: 2826 }, { label: 'Australia', gl: 'au', locId: 2036 },
    { label: 'Singapore', gl: 'sg', locId: 2702 }, { label: 'Malaysia', gl: 'my', locId: 2458 },
    { label: 'Japan', gl: 'jp', locId: 2392 }, { label: 'India', gl: 'in', locId: 2356 },
];
const INTENT_COLOR = {
    informational: 'bg-sky-100 text-sky-700', commercial: 'bg-amber-100 text-amber-700',
    transactional: 'bg-emerald-100 text-emerald-700', navigational: 'bg-violet-100 text-violet-700',
};
const GSC_BADGE = {
    ranking: { label: 'Already ranking', cls: 'bg-emerald-100 text-emerald-700' },
    weak: { label: 'Ranks (weak)', cls: 'bg-amber-100 text-amber-700' },
    gap: { label: 'Opportunity (gap)', cls: 'bg-indigo-100 text-indigo-700' },
};

export default function KeywordClustering() {
    const [params] = useSearchParams();
    const clientId = params.get('client');

    const [kwText, setKwText] = useState('');
    const [countryGl, setCountryGl] = useState('th');
    const [domain, setDomain] = useState('');
    const [minOverlap, setMinOverlap] = useState(3);
    const [mode, setMode] = useState('hard');
    const [topN, setTopN] = useState(10);
    const [discover, setDiscover] = useState(false);       // expand into new keywords before clustering
    const [excludeRanked, setExcludeRanked] = useState(true);

    const [quota, setQuota] = useState(null);
    const [estimate, setEstimate] = useState(null);
    const [runId, setRunId] = useState(null);
    const [run, setRun] = useState(null);          // live status+result
    const [runs, setRuns] = useState([]);          // saved runs
    const [openIdx, setOpenIdx] = useState(null);
    const [importing, setImporting] = useState(false);
    const [gscProps, setGscProps] = useState([]);
    const pollRef = useRef(null);

    const country = COUNTRIES.find(c => c.gl === countryGl) || COUNTRIES[0];
    const keywordList = kwText.split('\n').map(s => s.trim()).filter(Boolean);

    const loadRuns = useCallback(async () => {
        try { setRuns((await api.get('/api/clustering', { params: clientId ? { client_id: clientId } : {} })).data.runs || []); }
        catch { /* non-fatal */ }
    }, [clientId]);

    useEffect(() => {
        api.get('/api/research/quota').then(r => setQuota(r.data)).catch(() => {});
        loadRuns();
        return () => clearInterval(pollRef.current);
    }, [loadRuns]);

    // Poll a running job until it finishes.
    useEffect(() => {
        clearInterval(pollRef.current);
        if (!runId) return;
        const tick = async () => {
            try {
                const r = (await api.get(`/api/clustering/${runId}`)).data;
                setRun(r);
                if (r.status === 'done' || r.status === 'error') {
                    clearInterval(pollRef.current);
                    loadRuns();
                    if (r.status === 'error') toast.error('Clustering failed: ' + (r.error || ''));
                }
            } catch { clearInterval(pollRef.current); }
        };
        tick();
        pollRef.current = setInterval(tick, 2500);
        return () => clearInterval(pollRef.current);
    }, [runId, loadRuns]);

    // Live estimate as the list changes (debounced-ish via keyword count).
    useEffect(() => {
        if (keywordList.length < 2) { setEstimate(null); return; }
        const t = setTimeout(() => {
            api.post('/api/clustering/estimate', { keywords: keywordList })
                .then(r => setEstimate(r.data)).catch(() => {});
        }, 400);
        return () => clearTimeout(t);
    }, [kwText]);   // eslint-disable-line

    const importGsc = async () => {
        const prop = gscProps[0]?.url;
        if (!prop) { toast.error('Select a Search Console property first'); return; }
        setImporting(true);
        try {
            const res = await api.get(`/auth/gsc/query-insights/${encodeURIComponent(prop)}`, { params: { days: 90 } });
            const qs = [...new Set((res.data.queries || []).map(q => q.query).filter(Boolean))];
            if (!qs.length) { toast.error('No queries found for that property'); return; }
            setKwText(qs.join('\n'));
            if (!domain) setDomain((prop || '').replace(/^sc-domain:/, '').replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, ''));
            toast.success(`Imported ${qs.length} queries`);
        } catch { toast.error('GSC import failed'); } finally { setImporting(false); }
    };

    const onCsv = (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
            // Accept "keyword" or "keyword,volume" per line; skip a header row.
            const lines = String(reader.result).split(/\r?\n/).map(l => l.trim()).filter(Boolean);
            const kws = lines.map(l => l.split(',')[0].trim()).filter(k => k && k.toLowerCase() !== 'keyword');
            setKwText(kws.join('\n'));
            toast.success(`Loaded ${kws.length} keywords from CSV`);
        };
        reader.readAsText(file);
        e.target.value = '';
    };

    const start = async () => {
        if (keywordList.length < 2) { toast.error('Enter at least 2 keywords'); return; }
        try {
            const res = await api.post('/api/clustering', {
                keywords: keywordList, name: domain || undefined, domain, client_id: clientId,
                gl: country.gl, location_id: country.locId,
                min_overlap: minOverlap, top_n: topN, mode,
                discover, exclude_ranked: excludeRanked,
            });
            setRunId(res.data.id);
            setRun(res.data);
            setOpenIdx(null);
            toast.success('Clustering started');
        } catch (e) { toast.error(e.response?.data?.detail || 'Could not start'); }
    };

    const openRun = async (id) => { setRunId(id); setOpenIdx(null); };
    const deleteRun = async (id, e) => {
        e?.stopPropagation();
        try { await api.delete(`/api/clustering/${id}`); if (id === runId) { setRunId(null); setRun(null); } loadRuns(); }
        catch { toast.error('Delete failed'); }
    };

    const clusters = run?.clusters || [];
    const exportCsv = () => {
        const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
        const rows = [['Cluster (pillar)', 'Keyword', 'Volume', 'KD', 'Intent', 'Page type', 'Suggested title', 'GSC status'].join(',')];
        clusters.forEach(c => (c.keywords || []).forEach(k => rows.push([
            esc(c.pillar), esc(k.keyword), k.volume || 0, k.kd ?? '', esc(c.intent), esc(c.page_type),
            esc(c.title), esc(c.gsc_status),
        ].join(','))));
        const blob = new Blob(['﻿' + rows.join('\n')], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a'); a.href = url; a.download = `clusters-${domain || 'export'}.csv`; a.click();
        URL.revokeObjectURL(url);
    };

    const trackPillars = async () => {
        const pillars = clusters.map(c => c.pillar).filter(Boolean);
        if (!pillars.length || !domain) { toast.error('Need a domain + clusters to track'); return; }
        try {
            const res = await api.post('/api/ranktracker/keywords', {
                keywords: pillars, domain, client_id: clientId, gl: country.gl, location_id: country.locId });
            toast.success(`Tracking ${res.data.added} pillar keywords`);
        } catch { toast.error('Could not add to rank tracker'); }
    };

    const busy = run && (run.status === 'queued' || run.status === 'running');
    const prog = run?.progress || {};

    return (
        <div className="max-w-[1100px] mx-auto px-4 sm:px-6 py-8">
            <div className="flex items-center gap-2 mb-1">
                <RectangleGroupIcon className="w-6 h-6 text-indigo-600" />
                <h1 className="text-[22px] font-black text-slate-800">Keyword Clustering</h1>
            </div>
            <p className="text-[13px] text-slate-500 mb-6">Group keywords into content clusters by shared Google rankings (SERP overlap) — each cluster is one page to build.</p>

            {/* Input */}
            <div className="bg-white border border-slate-200 rounded-2xl p-5 mb-6">
                <div className="flex flex-col lg:flex-row gap-4">
                    <div className="flex-1">
                        <div className="flex items-center justify-between mb-1">
                            <label className="text-[13px] font-bold text-slate-700">Keywords ({keywordList.length})</label>
                            <div className="flex items-center gap-3 text-[12px]">
                                <label className="text-indigo-600 font-semibold cursor-pointer hover:underline">
                                    Upload CSV<input type="file" accept=".csv,text/csv" onChange={onCsv} className="hidden" />
                                </label>
                            </div>
                        </div>
                        <textarea value={kwText} onChange={e => setKwText(e.target.value)} rows={8}
                            placeholder={'One keyword per line (optionally "keyword,volume")\nwine tasting bangkok\nwine course\nlearn wine online'}
                            className="w-full border border-slate-300 rounded-lg px-3 py-2 text-[13px] font-mono outline-none focus:ring-2 focus:ring-indigo-500/30" />
                        <div className="mt-2">
                            <p className="text-[12px] text-slate-400 mb-1">…or import every query a site ranks for (free, from Search Console):</p>
                            <div className="flex items-end gap-2 flex-wrap">
                                <div className="flex-1 min-w-[220px]"><GSCPropertySelector onPropertySelect={setGscProps} selectedProperties={gscProps} /></div>
                                <button onClick={importGsc} disabled={importing} className="px-3 py-2 border border-slate-300 rounded-lg text-[13px] font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50">
                                    {importing ? 'Importing…' : 'Import GSC queries'}
                                </button>
                            </div>
                        </div>
                    </div>

                    {/* Controls */}
                    <div className="lg:w-[300px] flex flex-col gap-3">
                        <div className="relative">
                            <GlobeAltIcon className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                            <input value={domain} onChange={e => setDomain(e.target.value)} placeholder="site domain (for GSC gap flag)"
                                className="w-full pl-9 pr-3 py-2 border border-slate-300 rounded-lg text-[13px] outline-none focus:ring-2 focus:ring-indigo-500/30" />
                        </div>
                        <label className="text-[12px] text-slate-500">Market
                            <select value={countryGl} onChange={e => setCountryGl(e.target.value)} className="mt-1 w-full border border-slate-300 rounded-lg px-2 py-2 text-[13px] font-semibold text-slate-700">
                                {COUNTRIES.map(c => <option key={c.gl} value={c.gl}>{c.label}</option>)}
                            </select>
                        </label>
                        <div className="text-[12px] text-slate-500">
                            Accuracy — shared URLs to group <b className="text-slate-700">({minOverlap})</b>
                            <input type="range" min={2} max={6} value={minOverlap} onChange={e => setMinOverlap(+e.target.value)} className="w-full accent-indigo-600" />
                            <div className="flex justify-between text-[10px] text-slate-400"><span>looser</span><span>tighter</span></div>
                        </div>
                        <div className="flex gap-2 text-[12px]">
                            <label className="flex-1">Mode
                                <select value={mode} onChange={e => setMode(e.target.value)} className="mt-1 w-full border border-slate-300 rounded-lg px-2 py-1.5 font-semibold text-slate-700">
                                    <option value="hard">Hard (groups)</option>
                                    <option value="centric">Centric (pillar)</option>
                                </select>
                            </label>
                            <label className="flex-1">SERP depth
                                <select value={topN} onChange={e => setTopN(+e.target.value)} className="mt-1 w-full border border-slate-300 rounded-lg px-2 py-1.5 font-semibold text-slate-700">
                                    <option value={10}>Top 10</option>
                                    <option value={20}>Top 20</option>
                                </select>
                            </label>
                        </div>
                        {/* Discover: expand the list into NEW keywords before clustering */}
                        <div className="rounded-lg border border-indigo-100 bg-indigo-50/50 p-2.5">
                            <label className="flex items-center gap-2 text-[13px] font-semibold text-slate-700">
                                <input type="checkbox" checked={discover} onChange={e => setDiscover(e.target.checked)} className="rounded border-slate-300 text-indigo-600" />
                                Discover new keywords first
                            </label>
                            <p className="text-[11px] text-slate-500 mt-1">Expands your list via Mangools (related + competitor keywords) before clustering — finds terms you gave it AND new ones.</p>
                            {discover && (
                                <label className="flex items-center gap-2 text-[12px] text-slate-600 mt-2">
                                    <input type="checkbox" checked={excludeRanked} onChange={e => setExcludeRanked(e.target.checked)} className="rounded border-slate-300 text-indigo-600" />
                                    Hide keywords the site already ranks for
                                </label>
                            )}
                        </div>
                    </div>
                </div>

                {/* Estimate + start */}
                <div className="flex items-center justify-between gap-3 mt-4 flex-wrap border-t border-slate-100 pt-3">
                    <div className="text-[12px] text-slate-500">
                        {discover
                            ? <>Cost: <b className="text-amber-600">up to ~600 SerpAPI searches</b> (discovery expands your list before clustering)</>
                            : estimate && <>Cost: <b className="text-slate-700">~{estimate.serp_cost} SerpAPI searches</b>{estimate.over_cap && <span className="text-amber-600"> (capped at {estimate.cap})</span>}</>}
                        {quota?.serpapi?.left != null && <span className="ml-3">Balance: {quota.serpapi.left.toLocaleString()} left</span>}
                        <span className="ml-3 text-slate-400">Duplicates within 24h are free.</span>
                    </div>
                    <button onClick={start} disabled={busy || keywordList.length < 2}
                        className="flex items-center gap-2 px-5 py-2.5 bg-indigo-600 text-white rounded-lg font-bold text-[14px] disabled:opacity-50">
                        <RectangleGroupIcon className="w-4 h-4" /> {busy ? 'Clustering…' : 'Cluster keywords'}
                    </button>
                </div>
            </div>

            {/* Progress */}
            {busy && (
                <div className="bg-white border border-slate-200 rounded-2xl p-5 mb-6">
                    <div className="flex items-center gap-2 text-[13px] font-semibold text-slate-600 mb-2">
                        <ArrowPathIcon className="w-4 h-4 animate-spin text-indigo-600" />
                        Fetching SERPs & clustering… {prog.done || 0}/{prog.total || keywordList.length}
                    </div>
                    <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                        <div className="h-full bg-indigo-500 transition-all" style={{ width: `${prog.total ? Math.round(100 * (prog.done || 0) / prog.total) : 5}%` }} />
                    </div>
                </div>
            )}

            {/* Results */}
            {run?.status === 'done' && (
                <div className="mb-8">
                    <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
                        <p className="text-[14px] font-bold text-slate-700">{clusters.length} clusters</p>
                        <div className="flex items-center gap-3">
                            {domain && <button onClick={trackPillars} className="text-[13px] font-semibold text-teal-600 hover:underline">Track pillars</button>}
                            <button onClick={exportCsv} className="text-[13px] font-semibold text-slate-500 hover:text-slate-700 underline">Export CSV</button>
                        </div>
                    </div>
                    <div className="flex flex-col gap-2.5">
                        {clusters.map((c, i) => {
                            const open = openIdx === i;
                            const gb = GSC_BADGE[c.gsc_status];
                            return (
                                <div key={i} className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                                    <button onClick={() => setOpenIdx(open ? null : i)} className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-slate-50">
                                        <div className="min-w-0 flex-1">
                                            <div className="flex items-center gap-2 flex-wrap">
                                                <span className="font-bold text-slate-800 text-[14px]">{c.title || c.pillar}</span>
                                                {c.intent && <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${INTENT_COLOR[c.intent] || 'bg-slate-100 text-slate-600'}`}>{c.intent}</span>}
                                                {gb && <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${gb.cls}`}>{gb.label}{c.gsc_best_position ? ` #${c.gsc_best_position}` : ''}</span>}
                                            </div>
                                            <p className="text-[12px] text-slate-400 mt-0.5 truncate">Pillar: {c.pillar} · {c.keywords.length} keywords{c.page_type ? ` · ${c.page_type}` : ''}</p>
                                        </div>
                                        <span className="text-[13px] font-bold text-indigo-700 tabular-nums shrink-0">{(c.total_volume || 0).toLocaleString()}/mo</span>
                                        {open ? <ChevronUpIcon className="w-4 h-4 text-slate-400" /> : <ChevronDownIcon className="w-4 h-4 text-slate-400" />}
                                    </button>
                                    {open && (
                                        <div className="px-4 pb-3 border-t border-slate-100 pt-3">
                                            {c.angle && <p className="text-[13px] text-slate-600 mb-2"><b>Angle:</b> {c.angle}</p>}
                                            <table className="w-full text-[12px]">
                                                <thead><tr className="text-[10px] uppercase text-slate-400 text-left"><th className="py-1">Keyword</th><th className="text-right">Vol</th><th className="text-right">KD</th></tr></thead>
                                                <tbody>
                                                    {c.keywords.map((k, j) => (
                                                        <tr key={j} className="border-t border-slate-50">
                                                            <td className="py-1 text-slate-700">{k.keyword}</td>
                                                            <td className="py-1 text-right tabular-nums text-slate-600">{(k.volume || 0).toLocaleString()}</td>
                                                            <td className="py-1 text-right tabular-nums text-slate-500">{k.kd ?? '—'}</td>
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}

            {/* Saved runs */}
            {runs.length > 0 && (
                <div className="border border-slate-200 rounded-2xl divide-y divide-slate-100 bg-white">
                    <p className="px-4 py-2 text-[12px] font-bold text-slate-500 bg-slate-50 rounded-t-2xl">Saved clustering runs</p>
                    {runs.map(r => (
                        <div key={r.id} onClick={() => openRun(r.id)} className="flex items-center gap-3 px-4 py-2.5 cursor-pointer hover:bg-slate-50">
                            <div className="min-w-0 flex-1">
                                <p className="text-[13px] font-semibold text-slate-800 truncate">{r.name}</p>
                                <p className="text-[11px] text-slate-400">{r.cluster_count} clusters · {r.keyword_count} keywords · {r.params?.mode} · overlap {r.params?.min_overlap}
                                    {r.status !== 'done' && <span className="ml-1 text-amber-600">· {r.status}</span>}</p>
                            </div>
                            <span className="text-[11px] text-slate-400">{r.created_at ? new Date(r.created_at).toLocaleDateString() : ''}</span>
                            <button onClick={(e) => deleteRun(r.id, e)} className="text-slate-300 hover:text-red-500"><TrashIcon className="w-4 h-4" /></button>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}

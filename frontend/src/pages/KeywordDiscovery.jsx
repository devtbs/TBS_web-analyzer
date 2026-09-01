import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { MagnifyingGlassIcon, SparklesIcon, GlobeAltIcon, RectangleGroupIcon } from '@heroicons/react/24/outline';
import toast from 'react-hot-toast';
import api from '../api/axios';

/* Keyword Discovery — seed-first expansion (Keyword-Insights style). Enter a few seeds → a large
   keyword universe with real volume/KD. Mangools-powered (cheap); SERP questions optional. */

import { MARKETS as COUNTRIES } from '../constants/markets';
const kdColor = (kd) => kd == null ? 'text-slate-400' : kd <= 30 ? 'text-emerald-600' : kd <= 50 ? 'text-amber-600' : 'text-red-500';

export default function KeywordDiscovery() {
    const navigate = useNavigate();
    const [seedText, setSeedText] = useState('');
    const [countryGl, setCountryGl] = useState('th');
    const [expand, setExpand] = useState(true);
    const [includeSerp, setIncludeSerp] = useState(false);
    const [busy, setBusy] = useState(false);

    const [rows, setRows] = useState([]);
    const [meta, setMeta] = useState(null);
    const [selected, setSelected] = useState(new Set());
    const [minVol, setMinVol] = useState(0);
    const [qOnly, setQOnly] = useState(false);
    const [search, setSearch] = useState('');

    const country = COUNTRIES.find(c => c.gl === countryGl) || COUNTRIES[0];
    const seeds = seedText.split('\n').map(s => s.trim()).filter(Boolean);

    const discover = async () => {
        if (!seeds.length) { toast.error('Enter at least one seed keyword'); return; }
        setBusy(true);
        try {
            const res = await api.post('/api/research/discover', {
                seeds, gl: country.gl, location_id: country.locId, expand, include_serp: includeSerp,
            });
            setRows(res.data.keywords || []);
            setMeta({ total: res.data.total, questions: res.data.question_count, seeds: res.data.seeds_used });
            setSelected(new Set());
        } catch (e) { toast.error(e.response?.data?.detail || 'Discovery failed'); }
        finally { setBusy(false); }
    };

    const visible = rows
        .filter(r => (r.volume || 0) >= minVol)
        .filter(r => !qOnly || r.is_question)
        .filter(r => !search || r.keyword.toLowerCase().includes(search.toLowerCase()));

    const toggle = (kw) => setSelected(s => { const n = new Set(s); n.has(kw) ? n.delete(kw) : n.add(kw); return n; });
    const selectAllVisible = () => setSelected(new Set(visible.map(r => r.keyword)));

    const exportCsv = () => {
        const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
        const list = selected.size ? visible.filter(r => selected.has(r.keyword)) : visible;
        const lines = [['Keyword', 'Volume', 'KD', 'Question'].join(',')]
            .concat(list.map(r => [esc(r.keyword), r.volume || 0, r.kd ?? '', r.is_question ? 'yes' : ''].join(',')));
        const blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a'); a.href = url; a.download = `discovery-${seeds[0] || 'keywords'}.csv`; a.click();
        URL.revokeObjectURL(url);
    };

    // Hand the chosen keywords to the clustering tool (prefilled) — discover → cluster in two clicks.
    const sendToCluster = () => {
        const list = (selected.size ? visible.filter(r => selected.has(r.keyword)) : visible).map(r => r.keyword);
        if (list.length < 2) { toast.error('Select at least 2 keywords to cluster'); return; }
        navigate('/keyword-clustering', { state: { keywords: list, gl: country.gl, locId: country.locId } });
    };

    return (
        <div className="max-w-[1100px] mx-auto px-4 sm:px-6 py-8">
            <div className="flex items-center gap-2 mb-1">
                <MagnifyingGlassIcon className="w-6 h-6 text-emerald-600" />
                <h1 className="text-[22px] font-black text-slate-800">Keyword Discovery</h1>
            </div>
            <p className="text-[13px] text-slate-500 mb-6">Enter a few seed keywords → get a large universe of related keywords + questions with real search volume.</p>

            {/* Seeds + options */}
            <div className="bg-white border border-slate-200 rounded-2xl p-5 mb-6">
                <div className="flex flex-col lg:flex-row gap-4">
                    <div className="flex-1">
                        <label className="text-[13px] font-bold text-slate-700">Seed keywords ({seeds.length})</label>
                        <textarea value={seedText} onChange={e => setSeedText(e.target.value)} rows={4}
                            placeholder={'One seed per line\nwine tasting\nsommelier course'}
                            className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-[14px] outline-none focus:ring-2 focus:ring-emerald-500/30" />
                    </div>
                    <div className="lg:w-[300px] flex flex-col gap-2.5">
                        <label className="text-[12px] text-slate-500 flex items-center gap-2">
                            <GlobeAltIcon className="w-4 h-4 text-slate-400" /> Market
                            <select value={countryGl} onChange={e => setCountryGl(e.target.value)} className="flex-1 border border-slate-300 rounded-lg px-2 py-1.5 text-[13px] font-semibold text-slate-700">
                                {COUNTRIES.map(c => <option key={c.gl} value={c.gl}>{c.label}</option>)}
                            </select>
                        </label>
                        <label className="flex items-center gap-2 text-[13px] text-slate-600">
                            <input type="checkbox" checked={expand} onChange={e => setExpand(e.target.checked)} className="rounded border-slate-300 text-emerald-600" />
                            AI-expand seeds (questions, entities, modifiers)
                        </label>
                        <label className="flex items-center gap-2 text-[13px] text-slate-600">
                            <input type="checkbox" checked={includeSerp} onChange={e => setIncludeSerp(e.target.checked)} className="rounded border-slate-300 text-emerald-600" />
                            Add SERP questions <span className="text-[11px] text-amber-600">(costs SerpAPI)</span>
                        </label>
                        <button onClick={discover} disabled={busy}
                            className="flex items-center justify-center gap-2 px-4 py-2.5 bg-emerald-600 text-white rounded-lg font-bold text-[14px] disabled:opacity-60">
                            <SparklesIcon className="w-4 h-4" /> {busy ? 'Discovering…' : 'Discover keywords'}
                        </button>
                        <p className="text-[11px] text-slate-400">Cheap by default — 1 Mangools lookup per seed, no SerpAPI unless SERP questions is on.</p>
                    </div>
                </div>
            </div>

            {/* Results */}
            {meta && (
                <>
                    <div className="flex items-center justify-between gap-3 mb-2 flex-wrap">
                        <p className="text-[13px] font-bold text-slate-600">
                            {visible.length} shown · {meta.total} found · {meta.questions} questions
                            {selected.size > 0 && <span className="text-emerald-600"> · {selected.size} selected</span>}
                        </p>
                        <div className="flex items-center gap-3 flex-wrap text-[12px]">
                            <div className="flex items-center gap-1">
                                <span className="text-slate-400">Min vol</span>
                                {[['All', 0], ['≥50', 50], ['≥100', 100], ['≥500', 500]].map(([l, v]) => (
                                    <button key={l} onClick={() => setMinVol(v)} className={`px-2 py-1 rounded-md font-semibold ${minVol === v ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-500'}`}>{l}</button>
                                ))}
                            </div>
                            <label className="flex items-center gap-1.5 text-slate-500">
                                <input type="checkbox" checked={qOnly} onChange={e => setQOnly(e.target.checked)} className="rounded border-slate-300 text-emerald-600" /> Questions only
                            </label>
                            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="filter…" className="border border-slate-300 rounded-md px-2 py-1 w-28 outline-none" />
                        </div>
                    </div>
                    <div className="flex items-center gap-3 mb-3 text-[13px] font-semibold">
                        <button onClick={selectAllVisible} className="text-slate-500 hover:text-slate-700">Select all shown</button>
                        <button onClick={sendToCluster} className="flex items-center gap-1.5 text-indigo-600 hover:underline"><RectangleGroupIcon className="w-4 h-4" /> Cluster {selected.size ? `(${selected.size})` : 'all shown'}</button>
                        <button onClick={exportCsv} className="text-slate-500 hover:text-slate-700 underline">Export CSV</button>
                    </div>
                    <div className="border border-slate-200 rounded-xl overflow-hidden max-h-[560px] overflow-y-auto bg-white">
                        <table className="w-full text-[13px]">
                            <thead className="bg-slate-50 sticky top-0"><tr className="text-[11px] uppercase text-slate-400">
                                <th className="w-8 py-2"></th><th className="text-left py-2 px-2 font-bold">Keyword</th>
                                <th className="text-right py-2 px-2 font-bold">Vol</th><th className="text-right py-2 px-2 font-bold">KD</th>
                            </tr></thead>
                            <tbody>
                                {visible.map((r, i) => (
                                    <tr key={i} className="border-t border-slate-50 hover:bg-slate-50">
                                        <td className="text-center"><input type="checkbox" checked={selected.has(r.keyword)} onChange={() => toggle(r.keyword)} className="rounded border-slate-300 text-emerald-600" /></td>
                                        <td className="py-1.5 px-2 text-slate-800 font-medium">
                                            {r.keyword}
                                            {r.is_question && <span className="ml-2 px-1.5 py-0.5 rounded bg-sky-100 text-sky-700 text-[10px] font-bold">Q</span>}
                                        </td>
                                        <td className="py-1.5 px-2 text-right font-bold text-indigo-700 tabular-nums">{(r.volume || 0).toLocaleString()}</td>
                                        <td className={`py-1.5 px-2 text-right font-bold tabular-nums ${kdColor(r.kd)}`}>{r.kd == null ? '—' : r.kd}</td>
                                    </tr>
                                ))}
                                {visible.length === 0 && <tr><td colSpan={4} className="text-center py-8 text-slate-400">No keywords match the filters.</td></tr>}
                            </tbody>
                        </table>
                    </div>
                </>
            )}
        </div>
    );
}

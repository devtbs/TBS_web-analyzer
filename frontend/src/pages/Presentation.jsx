import { useState, useEffect, useMemo, useRef } from 'react';
import { motion } from 'framer-motion';
import toast from 'react-hot-toast';
import { PresentationChartLineIcon, ArrowDownTrayIcon, MagnifyingGlassIcon, DocumentArrowUpIcon, SparklesIcon, ChevronLeftIcon, ChevronRightIcon } from '@heroicons/react/24/outline';
import api from '../api/axios';
import { useAuth } from '../context/AuthContext';

/* Flatten the grouped /all response into a single list, tagging each item with
   the Google account it belongs to. */
const flattenGroups = (groups, key) =>
    (groups || []).flatMap(g =>
        (g[key] || []).map(item => ({ ...item, account_id: g.account_id, google_email: g.google_email }))
    );

const prettyName = (url) => {
    if (!url) return url;
    if (url.startsWith('sc-domain:')) return url.slice('sc-domain:'.length);
    try { return new URL(url).hostname.replace(/^www\./, ''); }
    catch { return url; }
};

const siteFavicon = (url) =>
    `https://www.google.com/s2/favicons?sz=32&domain_url=${encodeURIComponent(prettyName(url))}`;

// Small pill descriptors describing a GSC property (scheme / www / domain-property).
const siteTags = (url) => {
    if (!url) return [];
    if (url.startsWith('sc-domain:'))
        return [{ label: 'Domain', cls: 'bg-indigo-50 text-indigo-600 border-indigo-100' }];
    try {
        const u = new URL(url);
        // A www property is shown with just the www tag; otherwise show the scheme.
        if (u.hostname.startsWith('www.'))
            return [{ label: 'www', cls: 'bg-sky-50 text-sky-600 border-sky-100' }];
        return u.protocol === 'http:'
            ? [{ label: 'HTTP', cls: 'bg-amber-50 text-amber-600 border-amber-100' }]
            : [{ label: 'HTTPS', cls: 'bg-emerald-50 text-emerald-600 border-emerald-100' }];
    } catch { return []; }
};

const Presentation = () => {
    const { switchAccount } = useAuth();
    const [mode, setMode] = useState('gsc');           // 'gsc' | 'ads' | 'pdf'  (gsc deck auto-includes GA4)

    // GSC site picker
    const [properties, setProperties] = useState([]);
    const [loadingProps, setLoadingProps] = useState(true);
    const [propUrl, setPropUrl] = useState('');
    const [query, setQuery] = useState('');
    const [open, setOpen] = useState(false);
    const boxRef = useRef(null);

    // Google Ads account picker (loaded lazily when the Ads tab is first opened)
    const [adsCusts, setAdsCusts] = useState([]);
    const [adsLoading, setAdsLoading] = useState(false);
    const [adsLoaded, setAdsLoaded] = useState(false);
    const [adsCustId, setAdsCustId] = useState('');
    const [adsQuery, setAdsQuery] = useState('');
    const [adsOpen, setAdsOpen] = useState(false);
    const adsBoxRef = useRef(null);

    // shared period (gsc / ads)
    const [days, setDays] = useState(28);

    // PDF upload
    const [pdfFile, setPdfFile] = useState(null);

    // shared
    const [providers, setProviders] = useState([]);
    const [provider, setProvider] = useState('deepseek');
    const [useImages, setUseImages] = useState(true);
    const [notes, setNotes] = useState('');
    const [generating, setGenerating] = useState(false);
    const [progressMsg, setProgressMsg] = useState('');
    const [downloading, setDownloading] = useState('');

    // generated deck (preview carousel + download)
    const [deckSlides, setDeckSlides] = useState([]);
    const [slideIdx, setSlideIdx] = useState(0);
    const [deckDocId, setDeckDocId] = useState('');
    const [deckLabel, setDeckLabel] = useState('');

    useEffect(() => {
        (async () => {
            try {
                const res = await api.get('/auth/gsc/properties/all');
                const list = flattenGroups(res.data.groups, 'properties');
                setProperties(list);
                if (list.length) { setPropUrl(list[0].url); setQuery(prettyName(list[0].url)); switchAccount(list[0].account_id); }
            } catch { toast.error('Could not load sites — is Search Console connected?'); }
            finally { setLoadingProps(false); }
        })();
        (async () => {
            try {
                const res = await api.get('/api/presentation/ai-providers');
                const list = res.data.providers || [];
                setProviders(list);
                if (list.length) setProvider(list.some(p => p.id === 'deepseek') ? 'deepseek' : list[0].id);
            } catch {}
        })();
    }, []);

    useEffect(() => {
        const onClick = (e) => { if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false); };
        document.addEventListener('mousedown', onClick);
        return () => document.removeEventListener('mousedown', onClick);
    }, []);

    useEffect(() => {
        const onClick = (e) => { if (adsBoxRef.current && !adsBoxRef.current.contains(e.target)) setAdsOpen(false); };
        document.addEventListener('mousedown', onClick);
        return () => document.removeEventListener('mousedown', onClick);
    }, []);

    // Lazily load the Ads source list the first time its tab is opened.
    useEffect(() => {
        if (mode === 'ads' && !adsLoaded) {
            setAdsLoaded(true); setAdsLoading(true);
            (async () => {
                try {
                    const res = await api.get('/auth/ads/customers/all');
                    const list = flattenGroups(res.data.groups, 'customers');
                    setAdsCusts(list);
                    if (list.length) { setAdsCustId(list[0].customer_id); switchAccount(list[0].account_id); }
                    else if (res.data.configured === false) toast.error('Google Ads is not configured yet.');
                } catch { toast.error('Could not load Google Ads accounts.'); }
                finally { setAdsLoading(false); }
            })();
        }
    }, [mode, adsLoaded]);

    const filtered = useMemo(() => {
        const q = query.trim().toLowerCase();
        const sel = prettyName(propUrl);
        const list = (!q || q === sel.toLowerCase()) ? properties
            : properties.filter((p) => prettyName(p.url).toLowerCase().includes(q));
        return list.slice(0, 100);
    }, [properties, query, propUrl]);

    const pick = (p) => { switchAccount(p.account_id); setPropUrl(p.url); setQuery(prettyName(p.url)); setOpen(false); };

    const adsLabel = useMemo(
        () => adsCusts.find((c) => c.customer_id === adsCustId)?.display || '',
        [adsCusts, adsCustId]);

    // Read a Server-Sent Events stream, invoking handlers per (event, data) frame.
    const readSSE = async (response, { onProgress, onResult, onError }) => {
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buf = '';
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buf += decoder.decode(value, { stream: true });
            let sep;
            while ((sep = buf.indexOf('\n\n')) !== -1) {
                const frame = buf.slice(0, sep); buf = buf.slice(sep + 2);
                let event = 'message', data = '';
                for (const line of frame.split('\n')) {
                    if (line.startsWith('event:')) event = line.slice(6).trim();
                    else if (line.startsWith('data:')) data += line.slice(5).trim();
                }
                let parsed = {};
                try { parsed = data ? JSON.parse(data) : {}; } catch {}
                if (event === 'progress') onProgress?.(parsed);
                else if (event === 'result') onResult?.(parsed);
                else if (event === 'error') onError?.(parsed);
            }
        }
    };

    const canGenerate = mode === 'gsc' ? !!propUrl
        : mode === 'ads' ? !!adsCustId
        : !!pdfFile;

    const generate = async () => {
        if (!canGenerate) {
            toast.error(mode === 'pdf' ? 'Choose a PDF first.'
                : mode === 'ads' ? 'Pick a Google Ads account first.'
                : 'Pick a site first.');
            return;
        }
        setGenerating(true);
        setProgressMsg('Starting…');
        setDeckSlides([]); setDeckDocId('');
        const t = toast.loading('AI is designing your presentation…');
        const token = localStorage.getItem('access_token');
        const headers = token ? { Authorization: `Bearer ${token}` } : {};
        const jsonHeaders = { ...headers, 'Content-Type': 'application/json' };
        try {
            let response;
            if (mode === 'gsc') {
                response = await fetch(
                    `/api/presentation/ai-deck-gsc?property=${encodeURIComponent(propUrl)}&days=${days}&provider=${provider}&images=${useImages}`,
                    { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ notes }) });
            } else if (mode === 'ads') {
                response = await fetch(
                    `/api/presentation/ai-deck-ads?customer_id=${encodeURIComponent(adsCustId)}&days=${days}&provider=${provider}&images=${useImages}&label=${encodeURIComponent(adsLabel)}`,
                    { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ notes }) });
            } else {
                const fd = new FormData();
                fd.append('file', pdfFile);
                fd.append('provider', provider);
                fd.append('images', useImages);
                fd.append('notes', notes);
                response = await fetch('/api/presentation/ai-deck-from-pdf', { method: 'POST', headers, body: fd });
            }
            if (!response.ok || !response.body) {
                let msg = 'Generation failed.';
                try { msg = (await response.json())?.detail || msg; } catch {}
                throw new Error(msg);
            }
            let streamErr = null, gotResult = false;
            await readSSE(response, {
                onProgress: (d) => { if (d.message) setProgressMsg(d.message); },
                onResult: (d) => {
                    gotResult = true;
                    setDeckSlides(d.slides || []);
                    setSlideIdx(0);
                    setDeckDocId(d.document_id || '');
                    setDeckLabel(d.label || '');
                },
                onError: (d) => { streamErr = d.detail || 'Generation failed.'; },
            });
            if (streamErr) throw new Error(streamErr);
            if (!gotResult) throw new Error('Generation ended unexpectedly.');
            toast.success('Deck ready — preview below.', { id: t });
        } catch (e) {
            toast.error(e.message || 'Generation failed.', { id: t });
        } finally { setGenerating(false); setProgressMsg(''); }
    };

    const downloadDeck = async (fmt) => {
        if (!deckDocId) return;
        setDownloading(fmt);
        try {
            const res = await api.get(`/api/presentation/deck/${deckDocId}/download?format=${fmt}`, { responseType: 'blob' });
            const name = `AI_Deck_${(deckLabel || 'report').replace(/[^a-z0-9.-]/gi, '_')}.${fmt}`;
            const url = URL.createObjectURL(new Blob([res.data]));
            const a = document.createElement('a');
            a.href = url; a.download = name;
            document.body.appendChild(a); a.click(); a.remove();
            URL.revokeObjectURL(url);
        } catch (e) {
            let msg = 'Download failed.';
            try { msg = JSON.parse(await e.response?.data?.text())?.detail || msg; } catch {}
            toast.error(msg);
        } finally { setDownloading(''); }
    };

    const prevSlide = () => setSlideIdx((i) => Math.max(0, i - 1));
    const nextSlide = () => setSlideIdx((i) => Math.min(deckSlides.length - 1, i + 1));

    const fieldCls = 'w-full border border-slate-300 rounded-xl px-4 py-3 text-slate-800 focus:outline-none focus:ring-2 focus:ring-[#26397A]/40 bg-white';

    return (
        <div className="p-6 md:p-10 max-w-3xl mx-auto">
            <div className="flex items-center gap-3 mb-2">
                <div className="w-11 h-11 rounded-xl bg-[#26397A] flex items-center justify-center">
                    <PresentationChartLineIcon className="w-6 h-6 text-white" />
                </div>
                <div>
                    <h1 className="text-2xl font-black text-slate-900 tracking-tight">AI Presentation</h1>
                    <p className="text-sm text-slate-500">A premium, uniquely-styled deck from your Search Console, Analytics, Google Ads or an uploaded PDF.</p>
                </div>
            </div>

            <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
                className="mt-6 bg-white border border-slate-200 rounded-2xl p-6 md:p-8 shadow-sm">

                <div className="grid grid-cols-3 gap-3 mb-6">
                    {[['gsc', 'Monthly Reports'], ['ads', 'Google Ads'], ['pdf', 'From a PDF']].map(([m, label]) => (
                        <button key={m} onClick={() => setMode(m)} disabled={generating}
                            className={`py-2.5 px-2 rounded-xl font-bold text-sm border transition-colors ${
                                mode === m ? 'bg-[#26397A] text-white border-[#26397A]' : 'bg-white text-slate-600 border-slate-300 hover:border-[#26397A]/50'}`}>
                            {label}
                        </button>
                    ))}
                </div>

                {mode === 'gsc' && (
                    <>
                        <label className="block text-sm font-bold text-slate-700 mb-2">Site</label>
                        <div className="relative mb-6" ref={boxRef}>
                            <MagnifyingGlassIcon className="w-5 h-5 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                            <input value={loadingProps ? 'Loading sites…' : query} disabled={loadingProps || generating}
                                onChange={(e) => { setQuery(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)}
                                placeholder="Search sites…" className={fieldCls + ' pl-11'} />
                            {open && !loadingProps && (
                                <div className="absolute z-20 mt-1 w-full bg-white border border-slate-200 rounded-xl shadow-lg max-h-72 overflow-auto">
                                    {filtered.length === 0 && <div className="px-4 py-3 text-sm text-slate-400">No matches</div>}
                                    {Object.entries(
                                        filtered.reduce((acc, p) => { (acc[p.google_email || 'Account'] ||= []).push(p); return acc; }, {})
                                    ).map(([email, items]) => (
                                        <div key={email}>
                                            <p className="px-4 pt-2 pb-1 text-[10px] font-bold uppercase tracking-wide text-slate-400 truncate">{email}</p>
                                            {items.map((p) => (
                                                <button key={p.url} onClick={() => pick(p)}
                                                    className={`flex items-center gap-2.5 w-full text-left px-4 py-2.5 text-sm hover:bg-slate-50 ${p.url === propUrl ? 'text-[#26397A] font-bold bg-slate-50' : 'text-slate-700'}`}>
                                                    <img src={siteFavicon(p.url)} alt="" className="w-4 h-4 rounded-sm flex-shrink-0"
                                                        onError={(e) => { e.currentTarget.style.visibility = 'hidden'; }} />
                                                    <span className="truncate">{prettyName(p.url)}</span>
                                                    <span className="ml-auto flex items-center gap-1 flex-shrink-0">
                                                        {siteTags(p.url).map((t) => (
                                                            <span key={t.label} className={`px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide rounded-md border ${t.cls}`}>
                                                                {t.label}
                                                            </span>
                                                        ))}
                                                    </span>
                                                </button>
                                            ))}
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                        <p className="-mt-4 mb-6 text-xs text-slate-400">
                            Includes Google Analytics data automatically when a matching GA4 property is connected.
                        </p>
                    </>
                )}

                {mode === 'ads' && (
                    <>
                        <label className="block text-sm font-bold text-slate-700 mb-2">Google Ads account</label>
                        <div className="relative mb-6" ref={adsBoxRef}>
                            <button
                                type="button"
                                disabled={adsLoading || generating}
                                onClick={() => !adsLoading && !generating && setAdsOpen(o => !o)}
                                className={fieldCls + ' flex items-center justify-between text-left'}
                            >
                                <span className={adsCustId ? 'text-slate-800' : 'text-slate-400'}>
                                    {adsLoading
                                        ? 'Loading accounts…'
                                        : adsCustId
                                            ? (() => { const c = adsCusts.find(x => x.customer_id === adsCustId); return c ? `${c.display}${c.currency ? ` (${c.currency})` : ''}` : adsCustId; })()
                                            : adsCusts.length === 0 ? 'No Google Ads accounts found' : 'Select an account…'}
                                </span>
                                <svg className={`w-4 h-4 text-slate-400 transition-transform ${adsOpen ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                            </button>
                            {adsOpen && (
                                <div className="absolute z-20 mt-1 w-full bg-white border border-slate-200 rounded-xl shadow-lg overflow-hidden">
                                    <div className="flex items-center gap-2 px-3 py-2 border-b border-slate-100">
                                        <MagnifyingGlassIcon className="w-4 h-4 text-slate-400 shrink-0" />
                                        <input
                                            autoFocus
                                            type="text"
                                            placeholder="Search accounts…"
                                            value={adsQuery}
                                            onChange={e => setAdsQuery(e.target.value)}
                                            className="flex-1 text-sm outline-none bg-transparent text-slate-700 placeholder:text-slate-400"
                                        />
                                    </div>
                                    <ul className="max-h-52 overflow-y-auto">
                                        {(() => {
                                            const matches = adsCusts.filter(c => c.display.toLowerCase().includes(adsQuery.toLowerCase()) || c.customer_id.includes(adsQuery));
                                            if (matches.length === 0) return <li className="px-4 py-3 text-sm text-slate-400">No accounts match "{adsQuery}"</li>;
                                            const groups = matches.reduce((acc, c) => { (acc[c.google_email || 'Account'] ||= []).push(c); return acc; }, {});
                                            return Object.entries(groups).map(([email, items]) => (
                                                <li key={email}>
                                                    <p className="px-4 pt-2 pb-1 text-[10px] font-bold uppercase tracking-wide text-slate-400 truncate">{email}</p>
                                                    {items.map(c => (
                                                        <button
                                                            key={c.customer_id}
                                                            type="button"
                                                            onClick={() => { switchAccount(c.account_id); setAdsCustId(c.customer_id); setAdsOpen(false); setAdsQuery(''); }}
                                                            className={`w-full text-left px-4 py-2.5 text-sm hover:bg-slate-50 flex items-center justify-between gap-2 ${c.customer_id === adsCustId ? 'bg-indigo-50 text-[#26397A] font-medium' : 'text-slate-700'}`}
                                                        >
                                                            <span>{c.display}{c.currency ? ` (${c.currency})` : ''}</span>
                                                            {c.customer_id === adsCustId && <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>}
                                                        </button>
                                                    ))}
                                                </li>
                                            ));
                                        })()}
                                    </ul>
                                </div>
                            )}
                        </div>
                    </>
                )}

                {mode === 'pdf' && (
                    <>
                        <label className="block text-sm font-bold text-slate-700 mb-2">PDF file (e.g. a Looker Studio export)</label>
                        <label className="flex items-center gap-3 border border-dashed border-slate-300 rounded-xl px-4 py-5 mb-6 cursor-pointer hover:border-[#26397A]/50">
                            <DocumentArrowUpIcon className="w-6 h-6 text-[#26397A]" />
                            <span className="text-sm text-slate-600">{pdfFile ? pdfFile.name : 'Click to choose a PDF…'}</span>
                            <input type="file" accept="application/pdf,.pdf" className="hidden"
                                onChange={(e) => setPdfFile(e.target.files?.[0] || null)} disabled={generating} />
                        </label>
                    </>
                )}

                {mode !== 'pdf' && (
                    <>
                        <label className="block text-sm font-bold text-slate-700 mb-2">Period</label>
                        <select value={days} onChange={(e) => setDays(Number(e.target.value))} disabled={generating} className={fieldCls + ' mb-6'}>
                            <option value={28}>Last 28 days</option>
                            <option value={90}>Last 90 days</option>
                            <option value={180}>Last 6 months</option>
                        </select>
                    </>
                )}

                <label className="block text-sm font-bold text-slate-700 mb-2">AI model</label>
                <select value={provider} onChange={(e) => setProvider(e.target.value)} disabled={generating} className={fieldCls + ' mb-6'}>
                    {providers.length === 0 && <option value="deepseek">DeepSeek</option>}
                    {providers.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
                </select>

                <button type="button" onClick={() => setUseImages((v) => !v)} disabled={generating}
                    className="w-full flex items-center justify-between gap-3 border border-slate-300 rounded-xl px-4 py-3 mb-8 text-left hover:border-[#26397A]/50 disabled:opacity-60">
                    <span>
                        <span className="block text-sm font-bold text-slate-700">Add AI photos</span>
                        <span className="block text-xs text-slate-400">Supermachine photos on most slides · slower &amp; uses Supermachine credits</span>
                    </span>
                    <span className={`relative w-11 h-6 rounded-full transition-colors flex-shrink-0 ${useImages ? 'bg-[#26397A]' : 'bg-slate-300'}`}>
                        <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${useImages ? 'translate-x-5' : ''}`} />
                    </span>
                </button>

                <label className="block text-sm font-bold text-slate-700 mb-2">Notes / highlights <span className="font-normal text-slate-400">(optional)</span></label>
                <textarea value={notes} onChange={(e) => setNotes(e.target.value)} disabled={generating} rows={3}
                    placeholder={"Lines starting with /on <date> are added verbatim to a Key Dates slide, e.g.\n/on 26 may product launch at 9 AM\n/on 30 may final client sign-off"}
                    className={fieldCls + ' mb-8 text-sm font-mono'} />

                <button onClick={generate} disabled={generating || !canGenerate}
                    className="w-full py-4 rounded-xl bg-[#26397A] text-white font-bold flex items-center justify-center gap-2 hover:bg-[#1b2a5e] transition-colors disabled:opacity-60">
                    {generating ? <><span className="w-5 h-5 border-2 border-white/40 border-t-white rounded-full animate-spin" /> {progressMsg || 'Generating…'}</>
                        : <><SparklesIcon className="w-5 h-5" /> Generate presentation</>}
                </button>
                <p className="text-xs text-slate-400 mt-3 text-center">The AI uses only your real data — no fabricated numbers.</p>
            </motion.div>

            {/* Preview carousel + download */}
            {deckSlides.length > 0 && (
                <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
                    className="mt-6 bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
                    <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
                        <h2 className="font-black text-slate-900">Preview <span className="text-slate-400 font-medium text-sm">· {deckLabel}</span></h2>
                        <div className="flex gap-2">
                            <button onClick={() => downloadDeck('pdf')} disabled={!!downloading}
                                className="px-4 py-2 rounded-lg bg-[#26397A] text-white font-bold text-sm flex items-center gap-2 hover:bg-[#1b2a5e] disabled:opacity-60">
                                <ArrowDownTrayIcon className="w-4 h-4" /> {downloading === 'pdf' ? 'Rendering…' : 'PDF'}
                            </button>
                            <button onClick={() => downloadDeck('pptx')} disabled={!!downloading}
                                className="px-4 py-2 rounded-lg border border-[#26397A] text-[#26397A] font-bold text-sm flex items-center gap-2 hover:bg-[#26397A]/5 disabled:opacity-60">
                                <ArrowDownTrayIcon className="w-4 h-4" /> {downloading === 'pptx' ? 'Rendering…' : 'PPTX'}
                            </button>
                        </div>
                    </div>
                    <div className="relative rounded-xl overflow-hidden border border-slate-200 bg-slate-50 select-none">
                        <img src={deckSlides[slideIdx]} alt={`Slide ${slideIdx + 1}`} className="w-full block" draggable={false} />
                        <button onClick={prevSlide} disabled={slideIdx === 0}
                            className="absolute left-3 top-1/2 -translate-y-1/2 w-11 h-11 rounded-full bg-white/90 shadow flex items-center justify-center text-slate-700 hover:bg-white disabled:opacity-0 transition">
                            <ChevronLeftIcon className="w-6 h-6" />
                        </button>
                        <button onClick={nextSlide} disabled={slideIdx === deckSlides.length - 1}
                            className="absolute right-3 top-1/2 -translate-y-1/2 w-11 h-11 rounded-full bg-white/90 shadow flex items-center justify-center text-slate-700 hover:bg-white disabled:opacity-0 transition">
                            <ChevronRightIcon className="w-6 h-6" />
                        </button>
                    </div>
                    <div className="flex items-center justify-center gap-2 mt-3">
                        {deckSlides.map((_, i) => (
                            <button key={i} onClick={() => setSlideIdx(i)}
                                className={`h-2 rounded-full transition-all ${i === slideIdx ? 'w-6 bg-[#26397A]' : 'w-2 bg-slate-300 hover:bg-slate-400'}`} />
                        ))}
                    </div>
                    <p className="text-xs text-slate-400 mt-2 text-center">Slide {slideIdx + 1} of {deckSlides.length} · saved to Documents — re-download anytime from there.</p>
                </motion.div>
            )}
        </div>
    );
};

export default Presentation;

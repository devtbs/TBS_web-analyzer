import { useState, useEffect, useMemo, useRef } from 'react';
import { motion } from 'framer-motion';
import toast from 'react-hot-toast';
import { PresentationChartLineIcon, ArrowDownTrayIcon, MagnifyingGlassIcon, DocumentArrowUpIcon, SparklesIcon, ChevronLeftIcon, ChevronRightIcon, ChevronDownIcon } from '@heroicons/react/24/outline';
import api from '../api/axios';
import { useAuth } from '../context/AuthContext';

/* Friendly names for the visual-style presets (kept next to the <select> options). */
const STYLE_LABELS = {
    tbs: 'TBS house', auto: 'Auto', A: 'Editorial', B: 'Bold Modern',
    C: 'Clean Corporate', D: 'Warm Premium', I: 'Ink & Gold', K: 'Coastal',
};

/* A collapsible options group. Collapsed it shows a one-line summary of its current values, so the
   form reads at a glance instead of as a wall of inputs. Defined at module level so toggling it
   doesn't remount its children (which would blur inputs mid-typing). */
const Section = ({ title, summary, open, onToggle, children }) => (
    <div className="border border-slate-200 rounded-xl mb-3 overflow-hidden">
        <button type="button" onClick={onToggle}
            className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left hover:bg-slate-50 transition-colors">
            <span className="text-sm font-bold text-slate-700 flex-shrink-0">{title}</span>
            <span className="flex items-center gap-2 min-w-0">
                {!open && <span className="text-xs text-slate-400 truncate">{summary}</span>}
                <ChevronDownIcon className={`w-4 h-4 text-slate-400 flex-shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
            </span>
        </button>
        {open && <div className="px-4 pb-4 pt-3 border-t border-slate-100">{children}</div>}
    </div>
);

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
    const [mode, setMode] = useState('gsc');           // 'gsc' | 'ga4' | 'ads' | 'pdf'

    // GSC site picker
    const [properties, setProperties] = useState([]);
    const [loadingProps, setLoadingProps] = useState(true);
    const [propUrl, setPropUrl] = useState('');
    const [query, setQuery] = useState('');
    const [open, setOpen] = useState(false);
    const boxRef = useRef(null);

    // GA4 property picker (loaded lazily when the GA4 tab is first opened)
    const [ga4Props, setGa4Props] = useState([]);
    const [ga4Loading, setGa4Loading] = useState(false);
    const [ga4Loaded, setGa4Loaded] = useState(false);
    const [ga4PropId, setGa4PropId] = useState('');
    const [ga4Query, setGa4Query] = useState('');
    const [ga4Open, setGa4Open] = useState(false);
    const ga4BoxRef = useRef(null);

    // Google Ads account picker (loaded lazily when the Ads tab is first opened)
    const [adsCusts, setAdsCusts] = useState([]);
    const [adsLoading, setAdsLoading] = useState(false);
    const [adsLoaded, setAdsLoaded] = useState(false);
    const [adsCustId, setAdsCustId] = useState('');
    const [adsQuery, setAdsQuery] = useState('');
    const [adsOpen, setAdsOpen] = useState(false);
    const adsBoxRef = useRef(null);

    // Bing site picker (loaded lazily when the Bing tab is first opened)
    const [bingSites, setBingSites] = useState([]);
    const [bingLoading, setBingLoading] = useState(false);
    const [bingLoaded, setBingLoaded] = useState(false);
    const [bingSite, setBingSite] = useState(null); // { url, account_id, account_label }
    const [bingQuery, setBingQuery] = useState('');
    const [bingOpen, setBingOpen] = useState(false);
    const [bingAiCsv, setBingAiCsv] = useState(null); // { name, text }
    const [bingAiStatus, setBingAiStatus] = useState(null); // { total_citations, days } once auto-pulled
    const [bingAiChecking, setBingAiChecking] = useState(false);
    const [bingBookmarklet, setBingBookmarklet] = useState(''); // javascript: href for the drag link
    const bingBookmarkletRef = useRef(null); // href set imperatively — React strips javascript: hrefs in JSX
    const bingBoxRef = useRef(null);

    // shared period (gsc / ads)
    const [days, setDays] = useState(28);

    // PDF upload
    const [pdfFile, setPdfFile] = useState(null);

    // shared
    const [providers, setProviders] = useState([]);
    const [provider, setProvider] = useState('deepseek');
    const [compareModels, setCompareModels] = useState([]);   // extra models to run the SAME deck on
    const [pipeline, setPipeline] = useState('single');       // 'single' | 'layered'
    const [layerModels, setLayerModels] = useState({ planner: '', insights: '', html: '' });
    const [creativity, setCreativity] = useState('balanced');
    const [themeMode, setThemeMode] = useState('tbs');        // 'tbs' | 'site' | 'custom' (deck colours)
    const [customColor, setCustomColor] = useState('#3C8DD9');
    const [style, setStyle] = useState('tbs');                // 'tbs' | 'auto' | preset letter A-L
    // Options groups start collapsed — the defaults are shown as a summary on each header.
    const [openSec, setOpenSec] = useState({ ai: false, design: false, notes: false });
    const [useImages, setUseImages] = useState(true);
    const [notes, setNotes] = useState('');
    const [brandTerms, setBrandTerms] = useState('');   // extra brand names to keep out of the deck
    const [generating, setGenerating] = useState(false);      // transient: only while dispatching requests
    const [downloading, setDownloading] = useState('');
    // Concurrent background jobs — each entry: {localId, job_id, provider, label, status, message, result}
    const [activeJobs, setActiveJobs] = useState([]);

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

    useEffect(() => {
        const onClick = (e) => { if (ga4BoxRef.current && !ga4BoxRef.current.contains(e.target)) setGa4Open(false); };
        document.addEventListener('mousedown', onClick);
        return () => document.removeEventListener('mousedown', onClick);
    }, []);

    // Lazily load the GA4 property list the first time its tab is opened.
    useEffect(() => {
        if (mode === 'ga4' && !ga4Loaded) {
            setGa4Loaded(true); setGa4Loading(true);
            (async () => {
                try {
                    const res = await api.get('/auth/ga4/properties/all');
                    const list = flattenGroups(res.data.groups, 'properties');
                    setGa4Props(list);
                    if (list.length) { setGa4PropId(list[0].property_id); switchAccount(list[0].account_id); }
                } catch { toast.error('Could not load Google Analytics properties.'); }
                finally { setGa4Loading(false); }
            })();
        }
    }, [mode, ga4Loaded]);

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

    // Lazily load the Bing verified-site list the first time its tab is opened.
    useEffect(() => {
        if (mode === 'bing' && !bingLoaded) {
            setBingLoaded(true); setBingLoading(true);
            (async () => {
                try {
                    const res = await api.get('/api/bing/sites');
                    const list = res.data.sites || [];
                    setBingSites(list);
                    if (list.length) setBingSite(list[0]);
                    else if (res.data.configured === false) toast.error('Bing is not configured yet.');
                    else toast.error('No connected Bing accounts — connect one on the Bing Search page.');
                } catch { toast.error('Could not load Bing sites.'); }
                finally { setBingLoading(false); }
            })();
        }
    }, [mode, bingLoaded]);

    // Check whether AI Performance data has already been auto-pulled for the selected Bing site.
    const checkBingAi = async (site) => {
        if (!site) { setBingAiStatus(null); return; }
        setBingAiChecking(true);
        try {
            const res = await api.get('/api/bing/ai-performance', { params: { site: site.url } });
            setBingAiStatus({ total_citations: res.data.total_citations, days: (res.data.daily || []).length });
        } catch { setBingAiStatus(null); }
        finally { setBingAiChecking(false); }
    };

    // When the selected Bing site changes, refresh its bookmarklet + auto-pull status.
    useEffect(() => {
        if (mode !== 'bing' || !bingSite) { setBingBookmarklet(''); setBingAiStatus(null); return; }
        checkBingAi(bingSite);
        (async () => {
            try {
                const res = await api.get('/api/bing/ai-performance/bookmarklet', { params: { site: bingSite.url } });
                setBingBookmarklet(res.data.bookmarklet || '');
            } catch { setBingBookmarklet(''); }
        })();
    }, [mode, bingSite]);

    // Set the bookmarklet href imperatively: React sanitizes javascript: URLs out of JSX href
    // (replacing them with a "React has blocked…" stub), so we must assign it on the DOM node.
    useEffect(() => {
        const el = bingBookmarkletRef.current;
        if (el && bingBookmarklet) el.setAttribute('href', bingBookmarklet);
    }, [bingBookmarklet]);

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

    const ga4Label = useMemo(
        () => ga4Props.find((p) => p.property_id === ga4PropId)?.display || '',
        [ga4Props, ga4PropId]);

    const bingPretty = (u) => (u || '').replace(/^https?:\/\//, '').replace(/\/$/, '');
    const bingFiltered = useMemo(() => {
        const q = bingQuery.trim().toLowerCase();
        const sel = bingSite ? bingPretty(bingSite.url) : '';
        const list = (!q || q === sel.toLowerCase()) ? bingSites
            : bingSites.filter((s) => bingPretty(s.url).toLowerCase().includes(q));
        return list.slice(0, 100);
    }, [bingSites, bingQuery, bingSite]);

    // Read a Server-Sent Events stream, invoking handlers per (event, data) frame.
    const readSSE = async (response, { onJob, onProgress, onResult, onError }) => {
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
                if (event === 'job') onJob?.(parsed);
                else if (event === 'progress') onProgress?.(parsed);
                else if (event === 'result') onResult?.(parsed);
                else if (event === 'error') onError?.(parsed);
            }
        }
    };

    const canGenerate = mode === 'gsc' ? !!propUrl
        : mode === 'ga4' ? !!ga4PropId
        : mode === 'ads' ? !!adsCustId
        : mode === 'bing' ? !!bingSite
        : !!pdfFile;

    // Background deck jobs: generation runs server-side and survives reload/navigation. Several can
    // run at once (incl. the same deck across models), each tracked as an entry in activeJobs.
    const ACTIVE_JOBS_KEY = 'active_deck_jobs';

    const applyDeckResult = (d) => {
        setDeckSlides(d.slides || []);
        setSlideIdx(0);
        setDeckDocId(d.document_id || '');
        setDeckLabel(d.label || '');
    };

    const patchJob = (localId, patch) =>
        setActiveJobs(js => js.map(j => (j.localId === localId ? { ...j, ...patch } : j)));

    const providerLabel = (id) => providers.find(p => p.id === id)?.label || id;

    const jobLabelFor = () => {
        if (mode === 'gsc') return (propUrl || '').replace(/^sc-domain:/, '').replace(/^https?:\/\//, '').replace(/\/$/, '') || 'site';
        if (mode === 'ga4') return ga4Label || ga4PropId || 'GA4';
        if (mode === 'ads') return adsLabel || adsCustId || 'Ads';
        if (mode === 'bing') return bingPretty(bingSite?.url || '') || 'Bing';
        return pdfFile?.name || 'report';
    };

    const resolvedLayerModels = (prov) => ({
        planner: layerModels.planner || prov,
        insights: layerModels.insights || prov,
        html: layerModels.html || prov,
    });

    // Persist running jobs (with a server job_id) so a reload can re-attach.
    useEffect(() => {
        const persistable = activeJobs
            .filter(j => j.job_id && j.status === 'running')
            .map(j => ({ job_id: j.job_id, provider: j.provider, label: j.label, ts: j.ts }));
        if (persistable.length) localStorage.setItem(ACTIVE_JOBS_KEY, JSON.stringify(persistable));
        else localStorage.removeItem(ACTIVE_JOBS_KEY);
    }, [activeJobs]);

    // Poll a background deck job to completion (reload/return, or if the live stream drops).
    const pollJobToEnd = async (jobId, localId) => {
        while (true) {
            let d;
            try { d = (await api.get(`/api/presentation/deck-job/${jobId}`)).data; }
            catch { patchJob(localId, { status: 'error', message: 'Lost track of the generation.' }); return; }
            if (d.message) patchJob(localId, { message: d.message });
            if (d.status === 'done') { patchJob(localId, { status: 'done', message: 'Ready', result: d }); applyDeckResult(d); toast.success('Deck ready — preview below.'); return; }
            if (d.status === 'error') { patchJob(localId, { status: 'error', message: d.error || 'Generation failed.' }); toast.error(d.error || 'Generation failed.'); return; }
            await new Promise(r => setTimeout(r, 3000));
        }
    };

    // On mount / reload: resume any background jobs that were left running.
    useEffect(() => {
        const raw = localStorage.getItem(ACTIVE_JOBS_KEY);
        if (!raw) return;
        let stored; try { stored = JSON.parse(raw); } catch { localStorage.removeItem(ACTIVE_JOBS_KEY); return; }
        const fresh = (Array.isArray(stored) ? stored : []).filter(s => s.job_id && Date.now() - (s.ts || 0) < 2 * 60 * 60 * 1000);
        if (!fresh.length) { localStorage.removeItem(ACTIVE_JOBS_KEY); return; }
        const resumed = fresh.map(s => ({ localId: `resume-${s.job_id}`, job_id: s.job_id, provider: s.provider, label: s.label, status: 'running', message: 'Resuming…', result: null, ts: s.ts }));
        setActiveJobs(js => [...js, ...resumed]);
        resumed.forEach(j => pollJobToEnd(j.job_id, j.localId));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Fire ONE background job for the given provider, streaming its progress into its activeJobs entry.
    const startOne = async (prov) => {
        const localId = `${prov}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
        const label = jobLabelFor();
        setActiveJobs(js => [...js, { localId, job_id: null, provider: prov, label, status: 'running', message: 'Starting…', result: null, ts: Date.now() }]);
        const token = localStorage.getItem('access_token');
        // Raw fetch bypasses the axios interceptor, so attach the selected Google account
        // (X-Account-Id) ourselves — otherwise the deck is built with the PRIMARY account's
        // token and a site owned by another connected account returns a 403.
        const acctId = localStorage.getItem('selected_account_id');
        const headers = {
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            ...(acctId ? { 'X-Account-Id': acctId } : {}),
        };
        const jsonHeaders = { ...headers, 'Content-Type': 'application/json' };
        const models = pipeline === 'layered' ? resolvedLayerModels(prov) : undefined;
        const body = {
            notes, creativity, pipeline, theme_mode: themeMode, style,
            ...(brandTerms.trim() ? { brand_terms: brandTerms } : {}),
            ...(themeMode === 'custom' ? { custom_color: customColor } : {}),
            ...(models ? { models } : {}),
        };
        try {
            let response;
            if (mode === 'gsc') {
                response = await fetch(
                    `/api/presentation/ai-deck-gsc?property=${encodeURIComponent(propUrl)}&days=${days}&provider=${prov}&images=${useImages}`,
                    { method: 'POST', headers: jsonHeaders, body: JSON.stringify(body) });
            } else if (mode === 'ga4') {
                response = await fetch(
                    `/api/presentation/ai-deck-ga4?property_id=${encodeURIComponent(ga4PropId)}&days=${days}&provider=${prov}&images=${useImages}&label=${encodeURIComponent(ga4Label)}`,
                    { method: 'POST', headers: jsonHeaders, body: JSON.stringify(body) });
            } else if (mode === 'ads') {
                response = await fetch(
                    `/api/presentation/ai-deck-ads?customer_id=${encodeURIComponent(adsCustId)}&days=${days}&provider=${prov}&images=${useImages}&label=${encodeURIComponent(adsLabel)}`,
                    { method: 'POST', headers: jsonHeaders, body: JSON.stringify(body) });
            } else if (mode === 'bing') {
                response = await fetch(
                    `/api/presentation/ai-deck-bing?account_id=${bingSite.account_id}&site=${encodeURIComponent(bingSite.url)}&days=${days}&provider=${prov}&images=${useImages}&label=${encodeURIComponent(bingPretty(bingSite.url))}`,
                    { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ ...body, ai_performance_csv: bingAiCsv?.text || null }) });
            } else {
                const fd = new FormData();
                fd.append('file', pdfFile);
                fd.append('provider', prov);
                fd.append('images', useImages);
                fd.append('notes', notes);
                fd.append('creativity', creativity);
                fd.append('pipeline', pipeline);
                fd.append('theme_mode', themeMode);
                fd.append('style', style);
                if (themeMode === 'custom') fd.append('custom_color', customColor);
                if (models) fd.append('models', JSON.stringify(models));
                response = await fetch('/api/presentation/ai-deck-from-pdf', { method: 'POST', headers, body: fd });
            }
            if (!response.ok || !response.body) {
                let msg = 'Generation failed.';
                try { msg = (await response.json())?.detail || msg; } catch {}
                throw new Error(msg);
            }
            let streamErr = null, gotResult = false, jobId = null;
            await readSSE(response, {
                onJob: (d) => { jobId = d.job_id || null; if (jobId) patchJob(localId, { job_id: jobId }); },
                onProgress: (d) => { if (d.message) patchJob(localId, { message: d.message }); },
                onResult: (d) => { gotResult = true; patchJob(localId, { status: 'done', message: 'Ready', result: d }); applyDeckResult(d); },
                onError: (d) => { streamErr = d.detail || 'Generation failed.'; patchJob(localId, { status: 'error', message: streamErr }); },
            });
            if (streamErr) { toast.error(streamErr); return; }
            if (gotResult) { toast.success('Deck ready — preview below.'); return; }
            // Live stream ended without a terminal event — the job keeps running server-side, re-attach.
            if (jobId) { await pollJobToEnd(jobId, localId); return; }
            patchJob(localId, { status: 'error', message: 'Generation ended unexpectedly.' });
        } catch (e) {
            patchJob(localId, { status: 'error', message: e.message || 'Generation failed.' });
            toast.error(e.message || 'Generation failed.');
        }
    };

    const generate = () => {
        if (!canGenerate) {
            toast.error(mode === 'pdf' ? 'Choose a PDF first.'
                : mode === 'ads' ? 'Pick a Google Ads account first.'
                : mode === 'ga4' ? 'Pick a GA4 property first.'
                : mode === 'bing' ? 'Pick a Bing site first.'
                : 'Pick a site first.');
            return;
        }
        setGenerating(true);
        setDeckSlides([]); setDeckDocId('');
        // Run the same deck across the primary model plus any "compare" models (deduped).
        const provs = Array.from(new Set([provider, ...compareModels]));
        provs.forEach(p => startOne(p));
        toast.success(provs.length > 1 ? `Started ${provs.length} decks — tracking below.` : 'Generation started — tracking below.');
        // Release the button quickly; the jobs run in the background and stay usable to start more.
        setTimeout(() => setGenerating(false), 700);
    };

    const dismissJob = (localId) => setActiveJobs(js => js.filter(j => j.localId !== localId));

    const downloadDeck = async (fmt) => {
        if (!deckDocId) return;
        setDownloading(fmt);
        try {
            const res = await api.get(`/api/presentation/deck/${deckDocId}/download?format=${fmt}`, { responseType: 'blob' });
            if (!res.data || res.data.size === 0) throw new Error('Empty file returned.');
            const type = fmt === 'pdf' ? 'application/pdf'
                : 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
            const name = `AI_Deck_${(deckLabel || 'report').replace(/[^a-z0-9.-]/gi, '_')}.${fmt}`;
            const url = URL.createObjectURL(new Blob([res.data], { type }));
            const a = document.createElement('a');
            a.href = url; a.download = name;
            document.body.appendChild(a); a.click();
            // Defer cleanup — revoking the blob URL in the same tick as click() cancels the download.
            setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 1500);
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
        <div className="p-6 md:p-10 max-w-4xl mx-auto">
            <div className="flex items-center gap-3 mb-2">
                <div className="w-11 h-11 rounded-xl bg-[#26397A] flex items-center justify-center">
                    <PresentationChartLineIcon className="w-6 h-6 text-white" />
                </div>
                <div>
                    <h1 className="text-2xl font-black text-slate-900 tracking-tight">AI Presentation</h1>
                    <p className="text-sm text-slate-500">A premium, uniquely-styled deck from your Search Console, Analytics, Google Ads, Bing or an uploaded PDF.</p>
                </div>
            </div>

            <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
                className="mt-6 bg-white border border-slate-200 rounded-2xl p-6 md:p-8 shadow-sm">

                <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 mb-6">
                    {[['gsc', 'GSC'], ['ga4', 'GA4'], ['ads', 'Google Ads'], ['bing', 'Bing'], ['pdf', 'From a PDF']].map(([m, label]) => (
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
                            Organic search performance from Google Search Console. For website analytics, use the GA4 tab.
                        </p>
                    </>
                )}

                {mode === 'ga4' && (
                    <>
                        <label className="block text-sm font-bold text-slate-700 mb-2">Google Analytics property</label>
                        <div className="relative mb-6" ref={ga4BoxRef}>
                            <button
                                type="button"
                                disabled={ga4Loading || generating}
                                onClick={() => !ga4Loading && !generating && setGa4Open(o => !o)}
                                className={fieldCls + ' flex items-center justify-between text-left'}
                            >
                                <span className={ga4PropId ? 'text-slate-800' : 'text-slate-400'}>
                                    {ga4Loading
                                        ? 'Loading properties…'
                                        : ga4PropId
                                            ? (ga4Props.find(x => x.property_id === ga4PropId)?.display || ga4PropId)
                                            : ga4Props.length === 0 ? 'No GA4 properties found' : 'Select a property…'}
                                </span>
                                <svg className={`w-4 h-4 text-slate-400 transition-transform ${ga4Open ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                            </button>
                            {ga4Open && (
                                <div className="absolute z-20 mt-1 w-full bg-white border border-slate-200 rounded-xl shadow-lg overflow-hidden">
                                    <div className="flex items-center gap-2 px-3 py-2 border-b border-slate-100">
                                        <MagnifyingGlassIcon className="w-4 h-4 text-slate-400 shrink-0" />
                                        <input
                                            autoFocus
                                            type="text"
                                            placeholder="Search properties…"
                                            value={ga4Query}
                                            onChange={e => setGa4Query(e.target.value)}
                                            className="flex-1 text-sm outline-none bg-transparent text-slate-700 placeholder:text-slate-400"
                                        />
                                    </div>
                                    <ul className="max-h-52 overflow-y-auto">
                                        {(() => {
                                            const matches = ga4Props.filter(p => (p.display || '').toLowerCase().includes(ga4Query.toLowerCase()) || (p.property_id || '').includes(ga4Query));
                                            if (matches.length === 0) return <li className="px-4 py-3 text-sm text-slate-400">No properties match "{ga4Query}"</li>;
                                            const groups = matches.reduce((acc, p) => { (acc[p.google_email || 'Account'] ||= []).push(p); return acc; }, {});
                                            return Object.entries(groups).map(([email, items]) => (
                                                <li key={email}>
                                                    <p className="px-4 pt-2 pb-1 text-[10px] font-bold uppercase tracking-wide text-slate-400 truncate">{email}</p>
                                                    {items.map(p => (
                                                        <button
                                                            key={p.property_id}
                                                            type="button"
                                                            onClick={() => { switchAccount(p.account_id); setGa4PropId(p.property_id); setGa4Open(false); setGa4Query(''); }}
                                                            className={`w-full text-left px-4 py-2.5 text-sm hover:bg-slate-50 flex items-center justify-between gap-2 ${p.property_id === ga4PropId ? 'bg-indigo-50 text-[#26397A] font-medium' : 'text-slate-700'}`}
                                                        >
                                                            <span className="truncate">{p.display}</span>
                                                            {p.property_id === ga4PropId && <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>}
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

                {mode === 'bing' && (
                    <>
                        <label className="block text-sm font-bold text-slate-700 mb-2">Bing site</label>
                        <div className="relative mb-6" ref={bingBoxRef}>
                            <button
                                type="button"
                                disabled={bingLoading || generating}
                                onClick={() => !bingLoading && !generating && setBingOpen(o => !o)}
                                className={fieldCls + ' flex items-center justify-between text-left'}
                            >
                                <span className={bingSite ? 'text-slate-800' : 'text-slate-400'}>
                                    {bingLoading ? 'Loading sites…'
                                        : bingSite ? bingPretty(bingSite.url)
                                        : bingSites.length === 0 ? 'No connected Bing sites' : 'Select a site…'}
                                </span>
                                <svg className={`w-4 h-4 text-slate-400 transition-transform ${bingOpen ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                            </button>
                            {bingOpen && (
                                <div className="absolute z-20 mt-1 w-full bg-white border border-slate-200 rounded-xl shadow-lg overflow-hidden">
                                    <div className="flex items-center gap-2 px-3 py-2 border-b border-slate-100">
                                        <MagnifyingGlassIcon className="w-4 h-4 text-slate-400 shrink-0" />
                                        <input
                                            autoFocus
                                            type="text"
                                            placeholder="Search sites…"
                                            value={bingQuery}
                                            onChange={e => setBingQuery(e.target.value)}
                                            className="flex-1 text-sm outline-none bg-transparent text-slate-700 placeholder:text-slate-400"
                                        />
                                    </div>
                                    <ul className="max-h-52 overflow-y-auto">
                                        {bingFiltered.length === 0
                                            ? <li className="px-4 py-3 text-sm text-slate-400">No sites match "{bingQuery}"</li>
                                            : bingFiltered.map(s => (
                                                <button
                                                    key={`${s.account_id}-${s.url}`}
                                                    type="button"
                                                    onClick={() => { setBingSite(s); setBingOpen(false); setBingQuery(''); }}
                                                    className={`w-full text-left px-4 py-2.5 text-sm hover:bg-slate-50 flex items-center justify-between gap-2 ${bingSite && s.url === bingSite.url && s.account_id === bingSite.account_id ? 'bg-indigo-50 text-[#26397A] font-medium' : 'text-slate-700'}`}
                                                >
                                                    <span className="truncate">{bingPretty(s.url)}</span>
                                                    {bingSite && s.url === bingSite.url && s.account_id === bingSite.account_id && <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>}
                                                </button>
                                            ))}
                                    </ul>
                                </div>
                            )}
                        </div>

                        <label className="block text-sm font-bold text-slate-700 mb-2">
                            AI Performance <span className="font-normal text-slate-400">(optional — adds an AI Search Visibility slide)</span>
                        </label>

                        {/* Auto-pull: a one-time bookmarklet the user runs on Bing's AI Performance page. */}
                        <div className="border border-slate-200 rounded-xl px-4 py-4 mb-3 bg-slate-50/60">
                            {bingAiStatus ? (
                                <div className="flex items-center gap-2 text-sm text-emerald-700 font-medium">
                                    <svg className="w-5 h-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                                    Auto-pulled: {bingAiStatus.total_citations?.toLocaleString()} citations across {bingAiStatus.days} days.
                                    <button type="button" className="ml-auto text-xs text-slate-500 hover:text-[#26397A] underline"
                                        onClick={() => checkBingAi(bingSite)} disabled={bingAiChecking}>Re-check</button>
                                </div>
                            ) : (
                                <div className="text-sm text-slate-600">
                                    <p className="mb-2 font-medium text-slate-700">Pull it automatically — no CSV needed:</p>
                                    <ol className="list-decimal list-inside space-y-1 mb-3 text-slate-500">
                                        <li>Drag this button to your bookmarks bar:&nbsp;
                                            {bingBookmarklet
                                                ? <a ref={bingBookmarkletRef} onClick={(e) => e.preventDefault()}
                                                    className="inline-block px-2 py-0.5 rounded bg-[#26397A] text-white text-xs font-semibold cursor-grab">Pull Bing AI Perf</a>
                                                : <span className="text-slate-400">select a site first…</span>}
                                        </li>
                                        <li>Open your site's <span className="font-medium">Bing Webmaster → AI Performance</span> report (logged in).</li>
                                        <li>Click the bookmark, then <button type="button" className="text-[#26397A] underline" onClick={() => checkBingAi(bingSite)} disabled={bingAiChecking}>{bingAiChecking ? 'checking…' : 're-check here'}</button>.</li>
                                    </ol>
                                </div>
                            )}
                        </div>

                        {/* Fallback: manual CSV upload. */}
                        <label className="flex items-center gap-3 border border-dashed border-slate-300 rounded-xl px-4 py-3 mb-6 cursor-pointer hover:border-[#26397A]/50">
                            <DocumentArrowUpIcon className="w-5 h-5 text-slate-400" />
                            <span className="text-sm text-slate-500">{bingAiCsv ? bingAiCsv.name : 'or upload a CSV manually…'}</span>
                            <input type="file" accept=".csv,text/csv" className="hidden" disabled={generating}
                                onChange={async (e) => {
                                    const f = e.target.files?.[0];
                                    if (!f) { setBingAiCsv(null); return; }
                                    setBingAiCsv({ name: f.name, text: await f.text() });
                                }} />
                        </label>
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


                {/* ── AI ── model, compare, pipeline ── */}
                <Section title="AI model & pipeline" open={openSec.ai}
                    onToggle={() => setOpenSec(o => ({ ...o, ai: !o.ai }))}
                    summary={`${providerLabel(provider)}${compareModels.length ? ` +${compareModels.length}` : ''} · ${pipeline === 'layered' ? '3-layer' : 'Single-pass'}`}>
                    <label className="block text-sm font-bold text-slate-700 mb-2">AI model</label>
                    <select value={provider} onChange={(e) => setProvider(e.target.value)} className={fieldCls + ' mb-3'}>
                        {providers.length === 0 && <option value="deepseek">DeepSeek</option>}
                        {providers.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
                    </select>
                    {/* Compare models: run the SAME deck across extra models at once */}
                    {providers.length > 1 && (
                        <div className="mb-6">
                            <label className="block text-xs font-bold text-slate-500 mb-2">Also generate with (compare) <span className="font-normal text-slate-400">— runs the same deck on each, in parallel</span></label>
                            <div className="flex flex-wrap gap-2">
                                {providers.filter(p => p.id !== provider).map((p) => {
                                    const on = compareModels.includes(p.id);
                                    return (
                                        <button key={p.id} type="button"
                                            onClick={() => setCompareModels(cm => on ? cm.filter(x => x !== p.id) : [...cm, p.id])}
                                            className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${on ? 'bg-[#26397A] text-white border-[#26397A]' : 'bg-white text-slate-600 border-slate-300 hover:border-[#26397A]/50'}`}>
                                            {on ? '✓ ' : '+ '}{p.label}
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                    )}
                    {/* Generation pipeline: single-pass vs 3-layer (per-layer model choice) */}
                    <label className="block text-sm font-bold text-slate-700 mb-2">Pipeline</label>
                    <select value={pipeline} onChange={(e) => setPipeline(e.target.value)} className={fieldCls + ' mb-2'}>
                        <option value="single">Single-pass — one model writes the whole deck (fast)</option>
                        <option value="layered">3-layer — plan → per-slide copy → per-slide design (slower)</option>
                    </select>
                    {pipeline === 'layered' ? (
                        <div className="mb-6 mt-2 grid grid-cols-1 gap-2 rounded-xl border border-slate-200 bg-slate-50/60 p-3">
                            <p className="text-xs text-slate-400">Pick a model per layer (blank = the AI model above). 3× the calls, so notably slower.</p>
                            {[['planner', 'Planner (deck outline)'], ['insights', 'Insights (slide copy)'], ['html', 'Design (HTML)']].map(([key, lbl]) => (
                                <div key={key} className="flex items-center gap-2">
                                    <span className="text-xs font-semibold text-slate-500 w-40 flex-shrink-0">{lbl}</span>
                                    <select value={layerModels[key]} onChange={(e) => setLayerModels(m => ({ ...m, [key]: e.target.value }))}
                                        className="flex-1 text-xs border border-slate-300 rounded-lg px-2 py-1.5">
                                        <option value="">Same as AI model ({providerLabel(provider)})</option>
                                        {providers.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
                                    </select>
                                </div>
                            ))}
                        </div>
                    ) : <div className="mb-6" />}
                </Section>

                {/* ── Design ── colours, style, freedom, photos ── */}
                <Section title="Design" open={openSec.design}
                    onToggle={() => setOpenSec(o => ({ ...o, design: !o.design }))}
                    summary={`${themeMode === 'tbs' ? 'TBS brand' : themeMode === 'site' ? 'Site brand' : 'Custom'} · ${STYLE_LABELS[style] || 'Custom'} · ${creativity[0].toUpperCase() + creativity.slice(1)} · Photos ${useImages ? 'on' : 'off'}`}>
                    {/* Deck colours: TBS house palette (default), the client's site brand, or a custom hex */}
                    <label className="block text-sm font-bold text-slate-700 mb-2">Deck colours</label>
                    <div className="flex flex-wrap gap-2 mb-3">
                        {[['tbs', 'TBS brand', ['#3C8DD9', '#79B84B']], ['site', 'Site brand', null], ['custom', 'Custom', [customColor]]].map(([val, lbl, swatch]) => (
                            <button key={val} type="button" onClick={() => setThemeMode(val)}
                                className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${themeMode === val ? 'bg-[#26397A] text-white border-[#26397A]' : 'bg-white text-slate-600 border-slate-300 hover:border-[#26397A]/50'}`}>
                                {swatch && (
                                    <span className="flex -space-x-1">
                                        {swatch.map((c) => (
                                            <span key={c} className="w-3 h-3 rounded-full border border-white/70" style={{ background: c }} />
                                        ))}
                                    </span>
                                )}
                                {lbl}
                            </button>
                        ))}
                        {themeMode === 'custom' && (
                            <span className="inline-flex items-center gap-2">
                                <input type="color" value={customColor} onChange={(e) => setCustomColor(e.target.value)}
                                    className="w-9 h-9 rounded-lg border border-slate-300 cursor-pointer p-0.5" />
                                <input type="text" value={customColor} onChange={(e) => setCustomColor(e.target.value)}
                                    className="w-24 text-xs border border-slate-300 rounded-lg px-2 py-1.5 font-mono" />
                            </span>
                        )}
                    </div>
                    <p className="text-xs text-slate-400 mb-6">
                        {themeMode === 'tbs' ? 'TBS Marketing house colours (blue/green) on every deck.'
                            : themeMode === 'site' ? "Auto-detected from the client's own website."
                            : 'Your chosen accent colour (a second shade is derived from it).'}
                    </p>

                    {/* Visual style: fonts + background */}
                    <label className="block text-sm font-bold text-slate-700 mb-2">Visual style</label>
                    <select value={style} onChange={(e) => setStyle(e.target.value)} className={fieldCls + ' mb-6'}>
                        <option value="tbs">TBS house — editorial, Fraunces + Inter, warm ground (default)</option>
                        <option value="auto">Auto — a distinct look chosen per site</option>
                        <option value="A">Editorial — Fraunces serif, cream</option>
                        <option value="B">Bold Modern — Space Grotesk, mono</option>
                        <option value="C">Clean Corporate — Archivo</option>
                        <option value="D">Warm Premium — Playfair</option>
                        <option value="I">Ink &amp; Gold — Libre Caslon (dark)</option>
                        <option value="K">Coastal — Space Grotesk, sky</option>
                    </select>
                    <label className="block text-sm font-bold text-slate-700 mb-2">Design freedom</label>
                    <select value={creativity} onChange={(e) => setCreativity(e.target.value)} disabled={generating} className={fieldCls}>
                        <option value="structured">Structured — consistent, predictable template</option>
                        <option value="balanced">Balanced — varied layouts, safe on any model</option>
                        <option value="creative">Creative — model designs freely (best with GLM)</option>
                    </select>
                    <p className="text-xs text-slate-400 mt-1 mb-6">
                        {creativity === 'creative' ? 'Maximum design freedom — pair with a strong model like GLM-5.2.'
                            : creativity === 'structured' ? 'The classic fixed template — most predictable.'
                            : 'The model chooses slide count & layouts, with guardrails kept on.'}
                    </p>
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
                </Section>

                {/* ── Notes ── */}
                <Section title="Notes / highlights" open={openSec.notes}
                    onToggle={() => setOpenSec(o => ({ ...o, notes: !o.notes }))}
                    summary={[notes.trim() ? `${notes.trim().split('\n').length} line(s)` : null,
                              brandTerms.trim() ? `${brandTerms.split(',').filter(t => t.trim()).length} brand term(s)` : null]
                              .filter(Boolean).join(' · ') || 'None'}>
                    <textarea value={notes} onChange={(e) => setNotes(e.target.value)} disabled={generating} rows={3}
                        placeholder={"Lines starting with /on <date> are added verbatim to a Key Dates slide, e.g.\n/on 26 may product launch at 9 AM\n/on 30 may final client sign-off"}
                        className={fieldCls + ' text-sm font-mono'} />

                    {mode === 'gsc' && (
                        <div className="mt-4 pt-4 border-t border-slate-200">
                            <label className="block text-sm font-semibold text-slate-700">Branded queries to exclude</label>
                            <p className="text-xs text-slate-500 mt-0.5 mb-2">
                                The client's own name is detected from the domain automatically. Add any other brand
                                spellings, nicknames or product names here — comma separated — and the deck won't
                                report on them or recommend ranking for them.
                            </p>
                            <input value={brandTerms} onChange={(e) => setBrandTerms(e.target.value)} disabled={generating}
                                placeholder="jesse and sons, jesse & son, jessies"
                                className={fieldCls + ' text-sm'} />
                        </div>
                    )}
                </Section>


                {/* Sticky CTA — stays reachable without scrolling past every option */}
                <div className="sticky bottom-0 -mx-6 md:-mx-8 -mb-6 md:-mb-8 mt-6 px-6 md:px-8 py-4 bg-white/95 backdrop-blur border-t border-slate-200 rounded-b-2xl">
                    <button onClick={generate} disabled={generating || !canGenerate}
                        className="w-full py-4 rounded-xl bg-[#26397A] text-white font-bold flex items-center justify-center gap-2 hover:bg-[#1b2a5e] transition-colors disabled:opacity-60">
                        {generating ? <><span className="w-5 h-5 border-2 border-white/40 border-t-white rounded-full animate-spin" /> Starting…</>
                            : <><SparklesIcon className="w-5 h-5" /> {compareModels.length ? `Generate ${1 + compareModels.length} decks` : 'Generate presentation'}</>}
                    </button>
                    <p className="text-xs text-slate-400 mt-2 text-center">
                        Decks generate in the background — you can start more, leave, or reload this page; each appears in Documents.</p>
                </div>
            </motion.div>

            {/* Active-job tracker: one row per in-flight/finished deck */}
            {activeJobs.length > 0 && (
                <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                    className="mt-6 bg-white border border-slate-200 rounded-2xl p-4 shadow-sm">
                    <h2 className="font-black text-slate-900 text-sm mb-3">Generating</h2>
                    <div className="space-y-2">
                        {activeJobs.map((j) => (
                            <div key={j.localId}
                                onClick={() => j.status === 'done' && j.result && applyDeckResult(j.result)}
                                className={`flex items-center gap-3 rounded-xl border px-3 py-2.5 ${j.status === 'error' ? 'border-red-200 bg-red-50/50' : j.status === 'done' ? 'border-emerald-200 bg-emerald-50/40 cursor-pointer hover:bg-emerald-50' : 'border-slate-200 bg-slate-50/60'}`}>
                                {j.status === 'running' && <span className="w-4 h-4 border-2 border-slate-300 border-t-[#26397A] rounded-full animate-spin flex-shrink-0" />}
                                {j.status === 'done' && <span className="w-4 h-4 rounded-full bg-emerald-500 flex-shrink-0" />}
                                {j.status === 'error' && <span className="w-4 h-4 rounded-full bg-red-500 flex-shrink-0" />}
                                <div className="min-w-0 flex-1">
                                    <p className="text-sm font-semibold text-slate-800 truncate">{j.label} <span className="text-slate-400 font-medium">· {providerLabel(j.provider)}</span></p>
                                    <p className="text-xs text-slate-400 truncate">{j.status === 'done' ? 'Ready — click to preview' : j.status === 'error' ? j.message : j.message}</p>
                                </div>
                                {j.status !== 'running' && (
                                    <button onClick={(e) => { e.stopPropagation(); dismissJob(j.localId); }}
                                        className="text-xs text-slate-400 hover:text-slate-700 font-semibold flex-shrink-0">Dismiss</button>
                                )}
                            </div>
                        ))}
                    </div>
                </motion.div>
            )}

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

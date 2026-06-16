import { useState, useEffect, useMemo, useRef } from 'react';
import { motion } from 'framer-motion';
import toast from 'react-hot-toast';
import { PresentationChartLineIcon, ArrowDownTrayIcon, MagnifyingGlassIcon, DocumentArrowUpIcon } from '@heroicons/react/24/outline';
import api from '../api/axios';

const prettyName = (url) => {
    if (!url) return url;
    if (url.startsWith('sc-domain:')) return url.slice('sc-domain:'.length);
    try { return new URL(url).hostname.replace(/^www\./, ''); }
    catch { return url; }
};

const Presentation = () => {
    const [mode, setMode] = useState('gsc');           // 'gsc' | 'pdf'

    // GSC site picker
    const [properties, setProperties] = useState([]);
    const [loadingProps, setLoadingProps] = useState(true);
    const [propUrl, setPropUrl] = useState('');
    const [query, setQuery] = useState('');
    const [open, setOpen] = useState(false);
    const [days, setDays] = useState(28);
    const boxRef = useRef(null);

    // PDF upload
    const [pdfFile, setPdfFile] = useState(null);

    // shared
    const [providers, setProviders] = useState([]);
    const [provider, setProvider] = useState('deepseek');
    const [format, setFormat] = useState('pdf');
    const [generating, setGenerating] = useState(false);

    // prompt library
    const [prompts, setPrompts] = useState([{ id: 'default', name: 'Default (built-in)' }]);
    const [promptId, setPromptId] = useState('default');
    const [defaultPromptText, setDefaultPromptText] = useState('');
    const [promptOpen, setPromptOpen] = useState(false);
    const [promptName, setPromptName] = useState('');
    const [promptText, setPromptText] = useState('');
    const [savingPrompt, setSavingPrompt] = useState(false);

    useEffect(() => {
        (async () => {
            try {
                const res = await api.get('/auth/gsc/properties');
                const list = res.data.properties || [];
                setProperties(list);
                if (list.length) { setPropUrl(list[0].url); setQuery(prettyName(list[0].url)); }
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
        refreshPrompts(true);
    }, []);

    useEffect(() => {
        const onClick = (e) => { if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false); };
        document.addEventListener('mousedown', onClick);
        return () => document.removeEventListener('mousedown', onClick);
    }, []);

    const refreshPrompts = async (initial = false) => {
        try {
            const res = await api.get('/api/presentation/prompts');
            setPrompts(res.data.prompts || []);
            setDefaultPromptText(res.data.default_prompt || '');
            if (initial) { setPromptText(res.data.default_prompt || ''); setPromptName(''); }
        } catch {}
    };

    // when the selected prompt changes, load its text into the editor
    const loadPromptIntoEditor = async (id) => {
        try {
            const res = await api.get(`/api/presentation/prompts/${id}`);
            setPromptText(res.data.prompt || '');
            setPromptName(res.data.builtin ? '' : (res.data.name || ''));
        } catch {}
    };
    const onSelectPrompt = (id) => { setPromptId(id); loadPromptIntoEditor(id); };

    const saveAsNew = async () => {
        if (!promptName.trim()) { toast.error('Give the prompt a name.'); return; }
        setSavingPrompt(true);
        try {
            const res = await api.post('/api/presentation/prompts', { name: promptName, prompt: promptText });
            setPrompts(res.data.prompts || []);
            setPromptId(res.data.saved.id);
            toast.success('Prompt saved.');
        } catch { toast.error('Could not save.'); }
        finally { setSavingPrompt(false); }
    };
    const updateSelected = async () => {
        setSavingPrompt(true);
        try {
            const res = await api.post('/api/presentation/prompts', { id: promptId, name: promptName, prompt: promptText });
            setPrompts(res.data.prompts || []);
            toast.success('Prompt updated.');
        } catch { toast.error('Could not update.'); }
        finally { setSavingPrompt(false); }
    };
    const deleteSelected = async () => {
        setSavingPrompt(true);
        try {
            const res = await api.delete(`/api/presentation/prompts/${promptId}`);
            setPrompts(res.data.prompts || []);
            setPromptId('default'); setPromptText(defaultPromptText); setPromptName('');
            toast.success('Prompt deleted.');
        } catch { toast.error('Could not delete.'); }
        finally { setSavingPrompt(false); }
    };

    const filtered = useMemo(() => {
        const q = query.trim().toLowerCase();
        const sel = prettyName(propUrl);
        const list = (!q || q === sel.toLowerCase()) ? properties
            : properties.filter((p) => prettyName(p.url).toLowerCase().includes(q));
        return list.slice(0, 100);
    }, [properties, query, propUrl]);

    const pick = (p) => { setPropUrl(p.url); setQuery(prettyName(p.url)); setOpen(false); };

    const download = (blob, name) => {
        const url = URL.createObjectURL(new Blob([blob]));
        const a = document.createElement('a');
        a.href = url; a.download = name;
        document.body.appendChild(a); a.click(); a.remove();
        URL.revokeObjectURL(url);
    };

    const generate = async () => {
        if (mode === 'gsc' && !propUrl) { toast.error('Pick a site first.'); return; }
        if (mode === 'pdf' && !pdfFile) { toast.error('Choose a PDF first.'); return; }
        setGenerating(true);
        const t = toast.loading('AI is designing your presentation…');
        try {
            let res, name;
            if (mode === 'gsc') {
                res = await api.post(
                    `/api/presentation/ai-deck-gsc?property=${encodeURIComponent(propUrl)}&format=${format}&days=${days}&provider=${provider}&prompt_id=${promptId}`,
                    {}, { responseType: 'blob' });
                name = `AI_Report_${prettyName(propUrl).replace(/[^a-z0-9.-]/gi, '_')}.${format}`;
            } else {
                const fd = new FormData();
                fd.append('file', pdfFile);
                fd.append('format', format);
                fd.append('provider', provider);
                fd.append('prompt_id', promptId);
                res = await api.post('/api/presentation/ai-deck-from-pdf', fd, { responseType: 'blob' });
                name = `AI_Deck_${(pdfFile.name || 'report').replace(/\.[^.]+$/, '')}.${format}`;
            }
            download(res.data, name);
            toast.success('Presentation downloaded!', { id: t });
        } catch (e) {
            let msg = 'Generation failed.';
            try { msg = JSON.parse(await e.response?.data?.text())?.detail || msg; } catch {}
            toast.error(msg, { id: t });
        } finally { setGenerating(false); }
    };

    const fieldCls = 'w-full border border-slate-300 rounded-xl px-4 py-3 text-slate-800 focus:outline-none focus:ring-2 focus:ring-[#26397A]/40 bg-white';
    const selectedIsBuiltin = promptId === 'default';

    return (
        <div className="p-6 md:p-10 max-w-3xl mx-auto">
            <div className="flex items-center gap-3 mb-2">
                <div className="w-11 h-11 rounded-xl bg-[#26397A] flex items-center justify-center">
                    <PresentationChartLineIcon className="w-6 h-6 text-white" />
                </div>
                <div>
                    <h1 className="text-2xl font-black text-slate-900 tracking-tight">AI Presentation</h1>
                    <p className="text-sm text-slate-500">A premium, uniquely-styled deck from your site data or an uploaded PDF.</p>
                </div>
            </div>

            <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
                className="mt-6 bg-white border border-slate-200 rounded-2xl p-6 md:p-8 shadow-sm">

                {/* Data source toggle */}
                <div className="flex gap-3 mb-6">
                    {[['gsc', 'From a site'], ['pdf', 'From a PDF']].map(([m, label]) => (
                        <button key={m} onClick={() => setMode(m)} disabled={generating}
                            className={`flex-1 py-2.5 rounded-xl font-bold text-sm border transition-colors ${
                                mode === m ? 'bg-[#26397A] text-white border-[#26397A]' : 'bg-white text-slate-600 border-slate-300 hover:border-[#26397A]/50'}`}>
                            {label}
                        </button>
                    ))}
                </div>

                {mode === 'gsc' ? (
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
                                    {filtered.map((p) => (
                                        <button key={p.url} onClick={() => pick(p)}
                                            className={`block w-full text-left px-4 py-2.5 text-sm hover:bg-slate-50 ${p.url === propUrl ? 'text-[#26397A] font-bold bg-slate-50' : 'text-slate-700'}`}>
                                            {prettyName(p.url)}
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>
                        <label className="block text-sm font-bold text-slate-700 mb-2">Period</label>
                        <select value={days} onChange={(e) => setDays(Number(e.target.value))} disabled={generating} className={fieldCls + ' mb-6'}>
                            <option value={28}>Last 28 days</option>
                            <option value={90}>Last 90 days</option>
                            <option value={180}>Last 6 months</option>
                        </select>
                    </>
                ) : (
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

                {/* Prompt selector */}
                <label className="block text-sm font-bold text-slate-700 mb-2">Prompt</label>
                <select value={promptId} onChange={(e) => onSelectPrompt(e.target.value)} disabled={generating} className={fieldCls + ' mb-6'}>
                    {prompts.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>

                {/* AI model */}
                <label className="block text-sm font-bold text-slate-700 mb-2">AI model</label>
                <select value={provider} onChange={(e) => setProvider(e.target.value)} disabled={generating} className={fieldCls + ' mb-6'}>
                    {providers.length === 0 && <option value="deepseek">DeepSeek</option>}
                    {providers.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
                </select>

                {/* Format */}
                <label className="block text-sm font-bold text-slate-700 mb-2">Format</label>
                <div className="flex gap-3 mb-8">
                    {['pdf', 'pptx'].map((f) => (
                        <button key={f} onClick={() => setFormat(f)} disabled={generating}
                            className={`flex-1 py-3 rounded-xl font-bold uppercase text-sm border transition-colors ${format === f ? 'bg-[#26397A] text-white border-[#26397A]' : 'bg-white text-slate-600 border-slate-300 hover:border-[#26397A]/50'}`}>{f}</button>
                    ))}
                </div>

                <button onClick={generate} disabled={generating || (mode === 'gsc' ? !propUrl : !pdfFile)}
                    className="w-full py-4 rounded-xl bg-[#26397A] text-white font-bold flex items-center justify-center gap-2 hover:bg-[#1b2a5e] transition-colors disabled:opacity-60">
                    {generating ? <><span className="w-5 h-5 border-2 border-white/40 border-t-white rounded-full animate-spin" /> Generating… (~40s)</>
                        : <><ArrowDownTrayIcon className="w-5 h-5" /> Generate {format.toUpperCase()}</>}
                </button>
            </motion.div>

            {/* Prompt editor */}
            <div className="mt-6 bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
                <button onClick={() => setPromptOpen((o) => !o)} className="w-full flex items-center justify-between px-6 py-4 text-left hover:bg-slate-50">
                    <span className="font-bold text-slate-700">Customize &amp; save prompts</span>
                    <span className="text-sm font-semibold text-[#26397A]">{promptOpen ? 'Hide' : 'Edit'}</span>
                </button>
                {promptOpen && (
                    <div className="px-6 pb-6">
                        <p className="text-xs text-slate-400 mb-3">
                            Editing <b>{prompts.find(p => p.id === promptId)?.name || 'prompt'}</b>. Put <code className="text-slate-600">{'{data}'}</code> where the data goes — it's filled automatically, and the HTML output rules are applied for you.
                        </p>
                        <input value={promptName} onChange={(e) => setPromptName(e.target.value)} placeholder="Prompt name (for saving)"
                            disabled={savingPrompt} className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm mb-2 focus:outline-none focus:ring-2 focus:ring-[#26397A]/40" />
                        <textarea value={promptText} onChange={(e) => setPromptText(e.target.value)} rows={16} spellCheck={false}
                            className="w-full border border-slate-300 rounded-xl px-3 py-2 text-xs font-mono leading-relaxed text-slate-800 focus:outline-none focus:ring-2 focus:ring-[#26397A]/40" />
                        <div className="flex flex-wrap gap-3 mt-3">
                            <button onClick={saveAsNew} disabled={savingPrompt} className="px-5 py-2 rounded-lg bg-[#26397A] text-white font-bold text-sm hover:bg-[#1b2a5e] disabled:opacity-60">Save as new</button>
                            <button onClick={updateSelected} disabled={savingPrompt || selectedIsBuiltin} className="px-5 py-2 rounded-lg border border-slate-300 text-slate-700 font-bold text-sm hover:border-[#26397A]/50 disabled:opacity-40" title={selectedIsBuiltin ? 'The built-in default cannot be overwritten' : ''}>Update selected</button>
                            <button onClick={() => { setPromptText(defaultPromptText); }} disabled={savingPrompt} className="px-5 py-2 rounded-lg border border-slate-300 text-slate-600 font-semibold text-sm hover:border-[#26397A]/50">Load default text</button>
                            <button onClick={deleteSelected} disabled={savingPrompt || selectedIsBuiltin} className="px-5 py-2 rounded-lg border border-red-200 text-red-500 font-semibold text-sm hover:bg-red-50 disabled:opacity-40 ml-auto">Delete</button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

export default Presentation;

import { useState, useRef, useEffect, useCallback } from 'react';
import {
    SparklesIcon, PaperAirplaneIcon, CheckIcon, PlusIcon, TrashIcon,
    ChatBubbleLeftRightIcon, ChartPieIcon, MagnifyingGlassIcon, PresentationChartLineIcon,
} from '@heroicons/react/24/outline';
import useAssistantChat from '../hooks/useAssistantChat';

const CONV_KEY = 'assistant_conversations';
const MODEL_KEY = 'assistant_model';

const MODELS = [
    { id: 'minimax', label: 'MiniMax-M1' },
    { id: 'deepseek', label: 'DeepSeek' },
];

const SUGGESTIONS = [
    { icon: ChatBubbleLeftRightIcon, title: 'List my clients', sub: 'Show the accounts I can access',
      prompt: 'List the clients / properties I can access.' },
    { icon: ChartPieIcon, title: 'Traffic overview', sub: 'Pick a client to summarize',
      prompt: "Give me a traffic overview for one of my clients — ask me which one." },
    { icon: MagnifyingGlassIcon, title: 'Striking-distance keywords', sub: 'Quick page-1 wins',
      prompt: 'Show striking-distance keywords for one of my Search Console properties — ask me which one.' },
    { icon: PresentationChartLineIcon, title: 'Generate a deck', sub: 'Build a report deck',
      prompt: 'Generate a report deck — ask me which client and whether Search Console or Google Ads.' },
];

const loadConvos = () => {
    try { return JSON.parse(localStorage.getItem(CONV_KEY) || '[]'); } catch { return []; }
};
const saveConvos = (list) => localStorage.setItem(CONV_KEY, JSON.stringify(list));
const fmtDate = (ts) => {
    const d = new Date(ts);
    const today = new Date();
    const y = new Date(today); y.setDate(today.getDate() - 1);
    if (d.toDateString() === today.toDateString()) return 'Today';
    if (d.toDateString() === y.toDateString()) return 'Yesterday';
    return d.toLocaleDateString();
};

const Assistant = () => {
    const [convos, setConvos] = useState(loadConvos);
    const [convId, setConvId] = useState(null);
    const [model, setModel] = useState(() => localStorage.getItem(MODEL_KEY) || 'minimax');
    const [input, setInput] = useState('');
    const scrollRef = useRef(null);
    const convIdRef = useRef(null);
    useEffect(() => { convIdRef.current = convId; }, [convId]);

    // Persist messages into the active conversation whenever they change.
    const persist = useCallback((messages) => {
        const real = messages.filter(m => m.content);
        if (real.length === 0) return;
        let id = convIdRef.current;
        if (!id) { id = `c_${Date.now()}`; convIdRef.current = id; setConvId(id); }
        const title = real.find(m => m.role === 'user')?.content?.slice(0, 60) || 'New chat';
        setConvos(prev => {
            const rest = prev.filter(c => c.id !== id);
            const next = [{ id, title, messages: real, updatedAt: Date.now() }, ...rest];
            saveConvos(next);
            return next;
        });
    }, []);

    const { messages, busy, activity, pending, choices, send, confirmAction, cancelAction, pickChoice, reset } =
        useAssistantChat({ getProvider: () => model, onMessages: persist });

    useEffect(() => {
        scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
    }, [messages, activity, pending]);

    const changeModel = (m) => { setModel(m); localStorage.setItem(MODEL_KEY, m); };

    const newChat = () => { setConvId(null); convIdRef.current = null; reset([]); setInput(''); };
    const openConvo = (c) => { setConvId(c.id); convIdRef.current = c.id; reset(c.messages || []); };
    const deleteConvo = (e, id) => {
        e.stopPropagation();
        setConvos(prev => { const next = prev.filter(c => c.id !== id); saveConvos(next); return next; });
        if (convIdRef.current === id) newChat();
    };
    const clearAll = () => { saveConvos([]); setConvos([]); newChat(); };

    const submit = () => {
        const text = input.trim();
        if (!text || busy) return;
        setInput('');
        send(text);
    };

    const visible = messages.filter(m => m.content);

    return (
        // Fill the content area: full viewport on desktop, minus the mobile top bar (h-14)
        // on small screens. A percentage height won't resolve here (the layout wrapper only
        // sets min-height), so we pin an explicit height and scroll internally.
        <div className="flex h-[calc(100dvh-3.5rem)] md:h-screen bg-slate-50 overflow-hidden">
            {/* ── Chat rail ── */}
            <aside className="hidden lg:flex flex-col w-64 flex-shrink-0 border-r border-slate-200 bg-white">
                <div className="p-3">
                    <button onClick={newChat}
                        className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-violet-600 text-white text-sm font-bold hover:bg-violet-700 transition-colors">
                        <PlusIcon className="w-4 h-4" /> New Chat
                    </button>
                </div>

                <div className="px-3 pb-2">
                    <label className="block text-[10px] font-bold uppercase tracking-wide text-slate-400 mb-1.5">AI Model</label>
                    <select value={model} onChange={e => changeModel(e.target.value)}
                        className="w-full px-3 py-2 text-[13px] bg-slate-50 border border-slate-200 rounded-lg text-slate-700 outline-none focus:ring-2 focus:ring-violet-500/20 focus:border-violet-400">
                        {MODELS.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
                    </select>
                </div>

                <div className="px-4 pt-3 pb-1 text-[10px] font-bold uppercase tracking-wide text-slate-400">Chat history</div>
                <div className="flex-1 overflow-y-auto px-2 space-y-1">
                    {convos.length === 0 && (
                        <p className="px-2 py-3 text-[12px] text-slate-400">No conversations yet.</p>
                    )}
                    {convos.map(c => (
                        <button key={c.id} onClick={() => openConvo(c)}
                            className={`w-full text-left px-3 py-2 rounded-lg group flex items-start gap-2 transition-colors ${
                                convId === c.id ? 'bg-violet-50 border border-violet-200' : 'hover:bg-slate-50'
                            }`}>
                            <div className="min-w-0 flex-1">
                                <p className="text-[13px] font-semibold text-slate-700 truncate">{c.title}</p>
                                <p className="text-[10px] text-slate-400">{fmtDate(c.updatedAt)}</p>
                            </div>
                            <TrashIcon onClick={(e) => deleteConvo(e, c.id)}
                                className="w-3.5 h-3.5 text-slate-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0 mt-0.5" />
                        </button>
                    ))}
                </div>

                {convos.length > 0 && (
                    <div className="p-3 border-t border-slate-100">
                        <button onClick={clearAll}
                            className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg border border-red-200 text-red-500 text-[12px] font-bold hover:bg-red-50 transition-colors">
                            <TrashIcon className="w-3.5 h-3.5" /> Clear All
                        </button>
                    </div>
                )}
            </aside>

            {/* ── Chat area ── */}
            <div className="flex-1 flex flex-col min-w-0 min-h-0">
                <div ref={scrollRef} className="flex-1 overflow-y-auto">
                    {visible.length === 0 ? (
                        <div className="h-full flex flex-col items-center justify-center px-6 max-w-2xl mx-auto text-center">
                            <div className="w-14 h-14 rounded-2xl flex items-center justify-center mb-5 shadow-lg shadow-violet-600/20"
                                style={{ background: 'linear-gradient(135deg, #7c3aed, #d946ef)' }}>
                                <SparklesIcon className="w-7 h-7 text-white" />
                            </div>
                            <h1 className="text-2xl font-black text-slate-800 mb-2">How can I help with your data today?</h1>
                            <p className="text-slate-500 mb-8">Ask me about traffic, keywords, ad performance, or to build a report deck.</p>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 w-full">
                                {SUGGESTIONS.map(s => (
                                    <button key={s.title} onClick={() => send(s.prompt)} disabled={busy}
                                        className="flex items-start gap-3 p-4 rounded-xl bg-white border border-slate-200 text-left hover:border-violet-300 hover:shadow-md transition-all disabled:opacity-50">
                                        <s.icon className="w-5 h-5 text-violet-500 flex-shrink-0 mt-0.5" />
                                        <div className="min-w-0">
                                            <p className="text-sm font-bold text-slate-700">{s.title}</p>
                                            <p className="text-[12px] text-slate-400">{s.sub}</p>
                                        </div>
                                    </button>
                                ))}
                            </div>
                        </div>
                    ) : (
                        <div className="max-w-3xl mx-auto px-4 py-6 space-y-4">
                            {visible.map((m, i) => (
                                <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                                    <div className={`max-w-[80%] px-4 py-2.5 rounded-2xl text-[14px] whitespace-pre-wrap leading-relaxed ${
                                        m.role === 'user'
                                            ? 'bg-violet-600 text-white rounded-br-sm'
                                            : 'bg-white border border-slate-200 text-slate-700 rounded-bl-sm'
                                    }`}>
                                        {m.content}
                                    </div>
                                </div>
                            ))}
                            {activity && (
                                <div className="flex justify-start">
                                    <div className="px-4 py-2.5 rounded-2xl bg-white border border-slate-200 text-slate-500 text-[13px] flex items-center gap-2">
                                        <span className="w-1.5 h-1.5 rounded-full bg-violet-500 animate-pulse" />
                                        {activity}
                                    </div>
                                </div>
                            )}
                            {choices && (
                                <div className="max-w-[80%] bg-white border border-violet-200 rounded-xl p-4 shadow-sm">
                                    <p className="text-[14px] font-semibold text-slate-700 mb-3">{choices.prompt}</p>
                                    <div className="flex flex-wrap gap-2 max-h-56 overflow-y-auto">
                                        {choices.options.map(opt => (
                                            <button key={opt.value} onClick={() => pickChoice(opt)} disabled={busy}
                                                className="px-3 py-1.5 rounded-lg border border-slate-200 text-slate-700 text-[13px] font-medium hover:bg-violet-50 hover:border-violet-300 hover:text-violet-700 transition-colors disabled:opacity-50">
                                                {opt.label}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {pending && (
                                <div className="max-w-[80%] bg-white border border-violet-200 rounded-xl p-4 shadow-sm">
                                    <p className="text-[14px] font-semibold text-slate-700 mb-3">{pending.summary}</p>
                                    <div className="flex gap-2">
                                        <button onClick={confirmAction} disabled={busy}
                                            className="flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg bg-violet-600 text-white text-[13px] font-bold hover:bg-violet-700 disabled:opacity-50">
                                            <CheckIcon className="w-4 h-4" /> Confirm
                                        </button>
                                        <button onClick={cancelAction} disabled={busy}
                                            className="px-4 py-2 rounded-lg border border-slate-200 text-slate-600 text-[13px] font-bold hover:bg-slate-50 disabled:opacity-50">
                                            Cancel
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>
                    )}
                </div>

                {/* Input */}
                <div className="border-t border-slate-200 bg-white px-4 py-3">
                    <div className="max-w-3xl mx-auto flex items-end gap-2">
                        <textarea
                            rows={1}
                            value={input}
                            onChange={e => setInput(e.target.value)}
                            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); } }}
                            placeholder="Message the assistant…"
                            className="flex-1 resize-none max-h-32 px-4 py-2.5 text-[14px] bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-violet-500/20 focus:border-violet-400 text-slate-700 placeholder:text-slate-400"
                        />
                        <button onClick={submit} disabled={busy || !input.trim()}
                            className="w-10 h-10 flex-shrink-0 rounded-xl bg-violet-600 text-white flex items-center justify-center hover:bg-violet-700 disabled:opacity-40 transition-colors">
                            <PaperAirplaneIcon className="w-4 h-4" />
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default Assistant;

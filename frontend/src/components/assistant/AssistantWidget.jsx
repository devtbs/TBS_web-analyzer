import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
    SparklesIcon, XMarkIcon, PaperAirplaneIcon, CheckIcon,
} from '@heroicons/react/24/outline';

/* Selected client context the assistant should be aware of (what the user has open). */
const readContext = () => ({
    selected_property: localStorage.getItem('gsc_selected_property') || null,
    selected_customer: localStorage.getItem('google_ads_selected_customer') || null,
    selected_ga4_property: localStorage.getItem('ga4_selected_property') || null,
});

const API_BASE = import.meta.env.VITE_API_BASE_URL || '';

/* Stream the assistant SSE response, invoking onEvent(type, data) per frame. */
async function streamChat(payload, onEvent, signal) {
    const res = await fetch(`${API_BASE}/api/assistant/chat`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${localStorage.getItem('access_token')}`,
            ...(localStorage.getItem('selected_account_id')
                ? { 'X-Account-Id': localStorage.getItem('selected_account_id') } : {}),
        },
        body: JSON.stringify(payload),
        signal,
    });
    if (!res.ok || !res.body) throw new Error(`Assistant request failed (${res.status})`);

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const frames = buf.split('\n\n');
        buf = frames.pop() || '';
        for (const frame of frames) {
            const evLine = frame.split('\n').find(l => l.startsWith('event:'));
            const dataLine = frame.split('\n').find(l => l.startsWith('data:'));
            if (!evLine) continue;
            const type = evLine.slice(6).trim();
            let data = {};
            try { data = dataLine ? JSON.parse(dataLine.slice(5).trim()) : {}; } catch { /* ignore */ }
            onEvent(type, data);
        }
    }
}

const AssistantWidget = () => {
    const [open, setOpen] = useState(false);
    const [messages, setMessages] = useState([]); // {role, content}
    const [input, setInput] = useState('');
    const [busy, setBusy] = useState(false);
    const [activity, setActivity] = useState('');   // current tool chip
    const [pending, setPending] = useState(null);   // {name, args, summary}
    const scrollRef = useRef(null);
    const abortRef = useRef(null);

    useEffect(() => {
        scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
    }, [messages, activity, pending]);

    /* Run one turn. `history` is the message list to send; `approvedAction` executes a
       previously-confirmed action instead of asking the model. */
    const runTurn = async (history, approvedAction = null) => {
        setBusy(true);
        setActivity('');
        setPending(null);
        // Append a fresh empty assistant message we stream into.
        setMessages([...history, { role: 'assistant', content: '' }]);
        const controller = new AbortController();
        abortRef.current = controller;
        try {
            await streamChat(
                { messages: history, context: readContext(), approved_action: approvedAction },
                (type, data) => {
                    if (type === 'tool') {
                        setActivity(data.message || 'Working…');
                    } else if (type === 'token') {
                        setActivity('');
                        setMessages(prev => {
                            const next = [...prev];
                            next[next.length - 1] = {
                                role: 'assistant',
                                content: (next[next.length - 1].content || '') + (data.text || ''),
                            };
                            return next;
                        });
                    } else if (type === 'confirm') {
                        setActivity('');
                        setPending(data);
                    } else if (type === 'error') {
                        setActivity('');
                        setMessages(prev => {
                            const next = [...prev];
                            next[next.length - 1] = { role: 'assistant', content: `⚠️ ${data.detail || 'Something went wrong.'}` };
                            return next;
                        });
                    }
                },
                controller.signal,
            );
        } catch (e) {
            if (e.name !== 'AbortError') {
                setMessages(prev => {
                    const next = [...prev];
                    if (next.length && next[next.length - 1].role === 'assistant' && !next[next.length - 1].content) {
                        next[next.length - 1] = { role: 'assistant', content: `⚠️ ${e.message}` };
                    }
                    return next;
                });
            }
        } finally {
            setBusy(false);
            setActivity('');
        }
    };

    const send = () => {
        const text = input.trim();
        if (!text || busy) return;
        setInput('');
        runTurn([...messages.filter(m => m.content), { role: 'user', content: text }]);
    };

    const confirmAction = () => {
        if (!pending) return;
        const action = { name: pending.name, args: pending.args };
        // Keep the visible history; drop the empty assistant turn that held the confirm.
        runTurn(messages.filter(m => m.content), action);
    };

    const cancelAction = () => {
        setPending(null);
        setMessages(prev => [...prev.filter(m => m.content), { role: 'assistant', content: 'Okay, cancelled.' }]);
    };

    return (
        <>
            {/* Floating launcher */}
            <button
                onClick={() => setOpen(o => !o)}
                className="fixed bottom-5 right-5 z-[60] w-14 h-14 rounded-full flex items-center justify-center shadow-lg shadow-violet-600/30 text-white transition-transform hover:scale-105 active:scale-95"
                style={{ background: 'linear-gradient(135deg, #7c3aed, #d946ef)' }}
                title="AI Assistant"
            >
                {open ? <XMarkIcon className="w-6 h-6" /> : <SparklesIcon className="w-6 h-6" />}
            </button>

            <AnimatePresence>
                {open && (
                    <motion.div
                        initial={{ opacity: 0, y: 20, scale: 0.98 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: 20, scale: 0.98 }}
                        transition={{ duration: 0.18 }}
                        className="fixed bottom-24 right-5 z-[60] w-[min(400px,calc(100vw-2.5rem))] h-[560px] max-h-[calc(100vh-8rem)] bg-white rounded-2xl shadow-2xl border border-slate-200 flex flex-col overflow-hidden"
                    >
                        {/* Header */}
                        <div className="flex items-center gap-2.5 px-4 py-3 border-b border-slate-100" style={{ background: 'linear-gradient(135deg, #7c3aed, #d946ef)' }}>
                            <SparklesIcon className="w-5 h-5 text-white" />
                            <div className="text-white">
                                <p className="text-sm font-bold leading-none">Assistant</p>
                                <p className="text-[10px] opacity-80 leading-none mt-0.5">Ask about your clients' data</p>
                            </div>
                        </div>

                        {/* Messages */}
                        <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-3 space-y-3 bg-slate-50">
                            {messages.length === 0 && (
                                <div className="text-center text-slate-400 text-[13px] mt-8 px-4">
                                    <p className="font-semibold text-slate-500 mb-2">Hi! I can help with your clients.</p>
                                    <p>Try: “How's traffic for this property?”, “Which keywords are in striking distance?”, or “Make an Ads deck for &lt;client&gt;.”</p>
                                </div>
                            )}
                            {messages.filter(m => m.content).map((m, i) => (
                                <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                                    <div className={`max-w-[85%] px-3.5 py-2 rounded-2xl text-[13px] whitespace-pre-wrap leading-relaxed ${
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
                                    <div className="px-3.5 py-2 rounded-2xl bg-white border border-slate-200 text-slate-500 text-[12px] flex items-center gap-2">
                                        <span className="w-1.5 h-1.5 rounded-full bg-violet-500 animate-pulse" />
                                        {activity}
                                    </div>
                                </div>
                            )}

                            {pending && (
                                <div className="bg-white border border-violet-200 rounded-xl p-3 shadow-sm">
                                    <p className="text-[13px] font-semibold text-slate-700 mb-2.5">{pending.summary}</p>
                                    <div className="flex gap-2">
                                        <button onClick={confirmAction} disabled={busy}
                                            className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg bg-violet-600 text-white text-[12px] font-bold hover:bg-violet-700 disabled:opacity-50">
                                            <CheckIcon className="w-3.5 h-3.5" /> Confirm
                                        </button>
                                        <button onClick={cancelAction} disabled={busy}
                                            className="flex-1 px-3 py-1.5 rounded-lg border border-slate-200 text-slate-600 text-[12px] font-bold hover:bg-slate-50 disabled:opacity-50">
                                            Cancel
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* Input */}
                        <div className="border-t border-slate-100 p-2.5 flex items-end gap-2">
                            <textarea
                                rows={1}
                                value={input}
                                onChange={e => setInput(e.target.value)}
                                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
                                placeholder="Ask about your data…"
                                className="flex-1 resize-none max-h-24 px-3 py-2 text-[13px] bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-violet-500/20 focus:border-violet-400 text-slate-700 placeholder:text-slate-400"
                            />
                            <button onClick={send} disabled={busy || !input.trim()}
                                className="w-9 h-9 flex-shrink-0 rounded-xl bg-violet-600 text-white flex items-center justify-center hover:bg-violet-700 disabled:opacity-40 transition-colors">
                                <PaperAirplaneIcon className="w-4 h-4" />
                            </button>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </>
    );
};

export default AssistantWidget;

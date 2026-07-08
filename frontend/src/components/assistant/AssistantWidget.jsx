import { useState, useRef, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
    SparklesIcon, XMarkIcon, PaperAirplaneIcon, CheckIcon, ArrowsPointingOutIcon,
} from '@heroicons/react/24/outline';
import useAssistantChat from '../../hooks/useAssistantChat';

const AssistantWidget = () => {
    const [open, setOpen] = useState(false);
    const [input, setInput] = useState('');
    const scrollRef = useRef(null);
    const { messages, busy, activity, pending, choices, send, confirmAction, cancelAction, pickChoice } = useAssistantChat();

    useEffect(() => {
        scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
    }, [messages, activity, pending]);

    const submit = () => {
        const text = input.trim();
        if (!text || busy) return;
        setInput('');
        send(text);
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
                            <div className="text-white flex-1">
                                <p className="text-sm font-bold leading-none">Assistant</p>
                                <p className="text-[10px] opacity-80 leading-none mt-0.5">Ask about your clients' data</p>
                            </div>
                            <Link to="/assistant" onClick={() => setOpen(false)} title="Open full page"
                                className="text-white/80 hover:text-white transition-colors">
                                <ArrowsPointingOutIcon className="w-4 h-4" />
                            </Link>
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

                            {choices && (
                                <div className="bg-white border border-violet-200 rounded-xl p-3 shadow-sm">
                                    <p className="text-[13px] font-semibold text-slate-700 mb-2.5">{choices.prompt}</p>
                                    <div className="flex flex-wrap gap-1.5 max-h-40 overflow-y-auto">
                                        {choices.options.map(opt => (
                                            <button key={opt.value} onClick={() => pickChoice(opt)} disabled={busy}
                                                className="px-2.5 py-1 rounded-lg border border-slate-200 text-slate-700 text-[12px] font-medium hover:bg-violet-50 hover:border-violet-300 hover:text-violet-700 transition-colors disabled:opacity-50">
                                                {opt.label}
                                            </button>
                                        ))}
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
                                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); } }}
                                placeholder="Ask about your data…"
                                className="flex-1 resize-none max-h-24 px-3 py-2 text-[13px] bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-violet-500/20 focus:border-violet-400 text-slate-700 placeholder:text-slate-400"
                            />
                            <button onClick={submit} disabled={busy || !input.trim()}
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

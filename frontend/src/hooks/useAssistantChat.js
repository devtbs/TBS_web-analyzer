import { useState, useRef, useCallback, useEffect } from 'react';

/* Selected client context the assistant should be aware of (what the user has open). */
export const readContext = () => ({
    selected_client_id: localStorage.getItem('selected_client_id') || null,
    selected_property: localStorage.getItem('gsc_selected_property') || null,
    selected_customer: localStorage.getItem('google_ads_selected_customer') || null,
    selected_ga4_property: localStorage.getItem('ga4_selected_property') || null,
    // Set by Results.jsx while a topical-map analysis is open, cleared on leaving that page — lets
    // the assistant answer "about the topical map we just did" without a manual picker.
    selected_analysis_id: localStorage.getItem('selected_analysis_id') || null,
});

const API_BASE = import.meta.env.VITE_API_BASE_URL || '';

/* The conversation is stored server-side; this is just the pointer to the current thread so a
   refresh reopens the same one instead of starting blank. */
const LS_SESSION = 'assistant_session_id';

const authHeaders = () => ({
    Authorization: `Bearer ${localStorage.getItem('access_token')}`,
    ...(localStorage.getItem('selected_account_id')
        ? { 'X-Account-Id': localStorage.getItem('selected_account_id') } : {}),
});

export async function fetchSessions() {
    const r = await fetch(`${API_BASE}/api/assistant/sessions`, { headers: authHeaders() });
    return r.ok ? (await r.json()).sessions || [] : [];
}

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

/**
 * Shared assistant chat engine — powers both the floating widget and the full page.
 *
 * @param {object} opts
 * @param {() => string} [opts.getProvider] returns the provider id to send (e.g. 'minimax').
 * @param {(messages) => void} [opts.onMessages] called whenever messages change (for persistence).
 */
export default function useAssistantChat({ getProvider, onMessages, restore = false } = {}) {
    const [messages, setMessagesState] = useState([]); // {role, content}
    const [busy, setBusy] = useState(false);
    const [activity, setActivity] = useState('');   // current tool chip
    const [pending, setPending] = useState(null);   // {name, args, summary}
    const [choices, setChoices] = useState(null);   // {kind, prompt, options:[{label,value}]}
    const abortRef = useRef(null);
    // Mirror of the latest messages so event handlers can read current state without
    // embedding side effects inside a setState updater (React StrictMode double-invokes
    // updaters, which would fire the network turn twice).
    const messagesRef = useRef([]);
    useEffect(() => { messagesRef.current = messages; }, [messages]);

    const setMessages = useCallback((updater) => {
        setMessagesState(prev => {
            const next = typeof updater === 'function' ? updater(prev) : updater;
            messagesRef.current = next;
            onMessages?.(next);
            return next;
        });
    }, [onMessages]);

    /* Run one turn. `history` is the message list to send; `approvedAction` executes a
       previously-confirmed action instead of asking the model. */
    const runTurn = useCallback(async (history, approvedAction = null) => {
        setBusy(true);
        setActivity('');
        setPending(null);
        setChoices(null);
        setMessages([...history, { role: 'assistant', content: '' }]);
        const controller = new AbortController();
        abortRef.current = controller;
        try {
            await streamChat(
                {
                    messages: history,
                    session_id: localStorage.getItem(LS_SESSION) || undefined,
                    context: readContext(),
                    approved_action: approvedAction,
                    provider: getProvider?.() || undefined,
                },
                (type, data) => {
                    if (type === 'session') {
                        if (data.session_id) localStorage.setItem(LS_SESSION, data.session_id);
                    } else if (type === 'tool') {
                        setActivity(data.message || 'Working…');
                    } else if (type === 'token') {
                        setActivity('');
                        setMessages(prev => {
                            const next = [...prev];
                            next[next.length - 1] = {
                                role: 'assistant',
                                content: (next[next.length - 1]?.content || '') + (data.text || ''),
                            };
                            return next;
                        });
                    } else if (type === 'confirm') {
                        setActivity('');
                        setPending(data);
                    } else if (type === 'select') {
                        setActivity('');
                        setChoices(data);
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
    }, [getProvider, setMessages]);

    const send = useCallback((text) => {
        const t = (text || '').trim();
        if (!t || busy) return;
        const history = [...messagesRef.current.filter(m => m.content), { role: 'user', content: t }];
        runTurn(history);
    }, [busy, runTurn]);

    const confirmAction = useCallback(() => {
        if (!pending) return;
        const action = { name: pending.name, args: pending.args };
        const history = messagesRef.current.filter(m => m.content);
        runTurn(history, action);
    }, [pending, runTurn]);

    const cancelAction = useCallback(() => {
        setPending(null);
        setMessages(prev => [...prev.filter(m => m.content), { role: 'assistant', content: 'Okay, cancelled.' }]);
    }, [setMessages]);

    /* User picked a client from the option list — send it as the next message. */
    const pickChoice = useCallback((option) => {
        setChoices(null);
        const t = `Use ${option.label} (${option.value}).`;
        const history = [...messagesRef.current.filter(m => m.content), { role: 'user', content: t }];
        runTurn(history);
    }, [runTurn]);

    const reset = useCallback((initial = []) => {
        abortRef.current?.abort();
        setPending(null);
        setChoices(null);
        setActivity('');
        setBusy(false);
        setMessagesState(initial);
    }, []);

    /* Start a fresh thread — drops the pointer so the next turn creates a new server-side session
       (the old one stays in history rather than being deleted). */
    const newChat = useCallback(() => {
        localStorage.removeItem(LS_SESSION);
        reset([]);
    }, [reset]);

    /* Reopen a past conversation by id. */
    const loadSession = useCallback(async (sessionId) => {
        if (!sessionId) return;
        try {
            const r = await fetch(`${API_BASE}/api/assistant/sessions/${sessionId}`, { headers: authHeaders() });
            if (!r.ok) return;
            const { messages: past } = await r.json();
            localStorage.setItem(LS_SESSION, sessionId);
            reset(past || []);
        } catch { /* history is a nicety — never block the chat on it */ }
    }, [reset]);

    /* Restore the last thread on mount so a refresh doesn't lose the conversation. Opt-in: the
       full Assistant page keeps its own local conversation list and restores that instead. */
    useEffect(() => {
        const sid = localStorage.getItem(LS_SESSION);
        if (!restore || !sid || messagesRef.current.length) return;
        (async () => {
            try {
                const r = await fetch(`${API_BASE}/api/assistant/sessions/${sid}`, { headers: authHeaders() });
                if (!r.ok) return;
                const { messages: past } = await r.json();
                if (past?.length) setMessagesState(past);
            } catch { /* ignore */ }
        })();
    }, [restore]);

    return { messages, busy, activity, pending, choices, send, confirmAction, cancelAction, pickChoice,
             reset, newChat, loadSession, setMessages: setMessagesState };
}

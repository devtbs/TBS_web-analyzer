/**
 * Consume a Server-Sent Events endpoint via raw fetch (so we can stream a GET with auth headers —
 * EventSource can't set headers, and fetch bypasses the axios interceptor, so we attach them here).
 * Calls onEvent(type, data) per frame. Same frame format the backend `_sse` helper emits.
 */
const API_BASE = import.meta.env.VITE_API_BASE_URL || '';

export async function sseStream(path, onEvent, { signal } = {}) {
    const res = await fetch(`${API_BASE}${path}`, {
        headers: {
            Authorization: `Bearer ${localStorage.getItem('access_token')}`,
            ...(localStorage.getItem('selected_account_id')
                ? { 'X-Account-Id': localStorage.getItem('selected_account_id') } : {}),
        },
        signal,
    });
    if (!res.ok || !res.body) throw new Error(`Stream request failed (${res.status})`);

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

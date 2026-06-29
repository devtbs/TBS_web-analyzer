import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { BellIcon } from '@heroicons/react/24/outline';
import api from '../api/axios';
import EmptyState from './ui/EmptyState';

const PANEL_W = 320;

const SEV_DOT = {
    critical: 'bg-red-500',
    warning: 'bg-amber-500',
    info: 'bg-sky-500',
};

const timeAgo = (iso) => {
    if (!iso) return '';
    const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
    if (s < 60) return 'just now';
    if (s < 3600) return `${Math.floor(s / 60)}m ago`;
    if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
    return `${Math.floor(s / 86400)}d ago`;
};

/**
 * Notification bell with unread badge + dropdown of recent alert events.
 * Polls /api/alerts periodically. Self-contained so it can drop into any layout.
 */
export default function NotificationBell() {
    const navigate = useNavigate();
    const [open, setOpen] = useState(false);
    const [alerts, setAlerts] = useState([]);
    const [unread, setUnread] = useState(0);
    const [panelStyle, setPanelStyle] = useState({});
    const ref = useRef(null);

    const load = useCallback(async () => {
        try {
            const { data } = await api.get('/api/alerts', { params: { limit: 8 } });
            setAlerts(data.alerts || []);
            setUnread(data.unread || 0);
        } catch {
            /* not connected / not logged in — stay quiet */
        }
    }, []);

    useEffect(() => {
        load();
        const id = setInterval(load, 60000); // refresh every minute
        return () => clearInterval(id);
    }, [load]);

    // Compute fixed-position coords so the panel escapes any overflow:hidden parent
    const openPanel = () => {
        if (ref.current) {
            const r = ref.current.getBoundingClientRect();
            const rightEdge = r.right;
            const left = Math.max(8, rightEdge - PANEL_W);
            setPanelStyle({ top: r.bottom + 8, left });
        }
        setOpen((o) => !o);
    };

    // Close on outside click
    useEffect(() => {
        if (!open) return;
        const onClick = (e) => {
            if (ref.current && !ref.current.contains(e.target)) setOpen(false);
        };
        window.addEventListener('click', onClick);
        return () => window.removeEventListener('click', onClick);
    }, [open]);

    const markAllRead = async () => {
        try {
            await api.post('/api/alerts/read-all');
            setUnread(0);
            setAlerts((prev) => prev.map((a) => ({ ...a, read: true })));
        } catch { /* ignore */ }
    };

    const openAlert = async (a) => {
        if (!a.read) {
            try {
                await api.post(`/api/alerts/${a.id}/read`);
                setUnread((u) => Math.max(0, u - 1));
                setAlerts((prev) => prev.map((x) => (x.id === a.id ? { ...x, read: true } : x)));
            } catch { /* ignore */ }
        }
    };

    return (
        <div className="relative" ref={ref}>
            <button
                onClick={openPanel}
                aria-label={`Notifications${unread ? `, ${unread} unread` : ''}`}
                className="relative w-9 h-9 flex items-center justify-center rounded-lg bg-white border border-slate-200 text-slate-500 hover:text-slate-700 hover:bg-slate-50 transition-colors shadow-sm"
            >
                <BellIcon className="w-5 h-5" aria-hidden="true" />
                {unread > 0 && (
                    <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 flex items-center justify-center text-[10px] font-bold text-white bg-red-500 rounded-full">
                        {unread > 9 ? '9+' : unread}
                    </span>
                )}
            </button>

            {open && (
                <div
                    className="fixed w-80 bg-white rounded-xl shadow-2xl border border-slate-100 z-[9999] overflow-hidden"
                    style={panelStyle}
                >
                    <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
                        <span className="text-sm font-bold text-slate-800">Alerts</span>
                        {unread > 0 && (
                            <button
                                onClick={markAllRead}
                                className="text-[11px] font-semibold text-indigo-600 hover:text-indigo-700"
                            >
                                Mark all read
                            </button>
                        )}
                    </div>

                    <div className="max-h-80 overflow-y-auto">
                        {alerts.length === 0 ? (
                            <EmptyState
                                icon="🔔"
                                title="No alerts"
                                description="You're all caught up. We'll flag notable changes in your traffic and rankings here."
                                className="py-10"
                            />
                        ) : (
                            alerts.map((a) => (
                                <button
                                    key={a.id}
                                    onClick={() => openAlert(a)}
                                    className={`w-full text-left px-4 py-3 flex gap-3 border-b border-slate-50 hover:bg-slate-50 transition-colors ${a.read ? 'opacity-60' : ''}`}
                                >
                                    <span className={`mt-1.5 w-2 h-2 rounded-full shrink-0 ${SEV_DOT[a.severity] || 'bg-slate-400'}`} />
                                    <span className="min-w-0">
                                        <span className="block text-[13px] text-slate-700 leading-snug">{a.message}</span>
                                        <span className="block text-[11px] text-slate-400 mt-0.5">{timeAgo(a.created_at)}</span>
                                    </span>
                                </button>
                            ))
                        )}
                    </div>

                    <button
                        onClick={() => { setOpen(false); navigate('/alerts'); }}
                        className="w-full px-4 py-2.5 text-[12px] font-semibold text-slate-600 hover:bg-slate-50 border-t border-slate-100"
                    >
                        View all & settings
                    </button>
                </div>
            )}
        </div>
    );
}

import { useState, useEffect } from 'react';
import { GoogleOAuthProvider, useGoogleLogin } from '@react-oauth/google';
import { ArrowPathIcon, CheckCircleIcon, ExclamationCircleIcon, PlusIcon } from '@heroicons/react/24/outline';
import toast from 'react-hot-toast';
import api from '../api/axios';
import { useAuth } from '../context/AuthContext';

const GOOGLE_DATA_SCOPES =
    'https://www.googleapis.com/auth/webmasters.readonly https://www.googleapis.com/auth/analytics.readonly https://www.googleapis.com/auth/adwords';

const STATUS = {
    ok:    { label: 'Connected', cls: 'text-emerald-600',  Icon: CheckCircleIcon },
    dead:  { label: 'Needs reconnect', cls: 'text-red-600', Icon: ExclamationCircleIcon },
    error: { label: 'Error', cls: 'text-amber-600',        Icon: ExclamationCircleIcon },
};

function ConnectionsInner() {
    const { connectAccount, disconnectAccount } = useAuth();
    const [rows, setRows] = useState(null);
    const [refreshing, setRefreshing] = useState(false);

    const load = async () => {
        try { setRows((await api.get('/auth/connections')).data.connections || []); }
        catch { toast.error('Could not load connections'); setRows([]); }
    };
    useEffect(() => { load(); }, []);

    const refresh = async () => { setRefreshing(true); try { await load(); } finally { setRefreshing(false); } };

    // Reconnect = the same consent OAuth flow as "Add account". Because the backend upserts on
    // google_email, re-consenting overwrites the revoked refresh token in place, flipping the row
    // green — no manual disconnect first.
    const reconnect = useGoogleLogin({
        flow: 'auth-code', scope: GOOGLE_DATA_SCOPES, prompt: 'consent',
        onSuccess: async (resp) => {
            try { await connectAccount(resp.code); toast.success('Reconnected'); await refresh(); }
            catch { toast.error('Reconnect failed'); }
        },
        onError: () => toast.error('Reconnect cancelled'),
    });

    const disconnect = async (r) => {
        if (r.provider !== 'google' || r.account_id == null) {
            toast('Manage this account from its own page.'); return;
        }
        if (!confirm(`Disconnect ${r.google_email}?`)) return;
        try { await disconnectAccount(r.account_id); toast.success('Disconnected'); await refresh(); }
        catch { toast.error('Could not disconnect'); }
    };

    const anyDead = (rows || []).some(r => r.status === 'dead');

    return (
        <div className="max-w-[900px] mx-auto px-6 py-8">
            <div className="flex items-center gap-4 mb-2 flex-wrap">
                <h1 className="text-2xl font-bold text-slate-800">Connections</h1>
                <button onClick={refresh} disabled={refreshing}
                    className="ml-auto flex items-center gap-2 px-3 py-2 border border-slate-300 rounded-lg text-[14px] font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-60">
                    <ArrowPathIcon className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} /> Recheck
                </button>
                <button onClick={() => reconnect()}
                    className="flex items-center gap-2 px-3 py-2 bg-[#26397A] text-white rounded-lg text-[14px] font-bold hover:bg-[#1d2c5e]">
                    <PlusIcon className="w-4 h-4" /> Add account
                </button>
            </div>
            <p className="text-[14px] text-slate-500 mb-6">
                Every connected Google &amp; Bing account, checked live. A red row means the token was revoked —
                reconnect to restore that client's data.
            </p>

            {anyDead && (
                <div className="mb-5 rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-[14px] text-red-700">
                    Some accounts need reconnecting — their clients' data is currently unavailable.
                </div>
            )}

            {rows === null ? (
                <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) =>
                    <div key={i} className="h-16 rounded-xl bg-slate-100 animate-pulse" style={{ animationDelay: `${i * 60}ms` }} />)}</div>
            ) : rows.length === 0 ? (
                <div className="text-center py-16 text-slate-400">No accounts connected yet.</div>
            ) : (
                <div className="bg-white border border-slate-200 rounded-2xl divide-y divide-slate-100">
                    {rows.map((r, i) => {
                        const s = STATUS[r.status] || STATUS.error;
                        return (
                            <div key={`${r.provider}-${r.account_id}-${i}`} className="flex items-center gap-4 px-5 py-4">
                                <s.Icon className={`w-6 h-6 shrink-0 ${s.cls}`} />
                                <div className="min-w-0 flex-1">
                                    <p className="font-semibold text-slate-800 text-[15px] truncate">{r.google_email}</p>
                                    <p className="text-[12px] text-slate-400">
                                        {r.provider === 'bing' ? 'Bing Webmaster' : 'Google'} ·{' '}
                                        <span className={s.cls}>{s.label}</span>
                                        {r.status === 'ok' && r.property_count != null && ` · ${r.property_count} properties`}
                                        {r.error && r.status !== 'dead' && ` · ${r.error}`}
                                    </p>
                                </div>
                                {r.status === 'dead' && (
                                    <button onClick={() => reconnect()}
                                        className="px-3 py-1.5 bg-red-600 text-white rounded-lg text-[13px] font-bold hover:bg-red-700 shrink-0">
                                        Reconnect
                                    </button>
                                )}
                                {r.provider === 'google' && r.account_id != null && (
                                    <button onClick={() => disconnect(r)}
                                        className="px-3 py-1.5 text-slate-500 rounded-lg text-[13px] font-semibold hover:bg-slate-100 shrink-0">
                                        Disconnect
                                    </button>
                                )}
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}

export default function Connections() {
    const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;
    return (
        <GoogleOAuthProvider clientId={clientId}>
            <ConnectionsInner />
        </GoogleOAuthProvider>
    );
}

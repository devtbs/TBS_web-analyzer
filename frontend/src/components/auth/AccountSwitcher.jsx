import { useState, useRef, useEffect } from 'react';
import { useGoogleLogin } from '@react-oauth/google';
import { useAuth } from '../../context/AuthContext';

const GOOGLE_DATA_SCOPES =
    'https://www.googleapis.com/auth/webmasters.readonly https://www.googleapis.com/auth/analytics.readonly https://www.googleapis.com/auth/adwords';

const AccountSwitcher = () => {
    const { connectedAccounts, selectedAccountId, switchAccount, connectAccount, disconnectAccount } = useAuth();
    const [open, setOpen] = useState(false);
    const [connecting, setConnecting] = useState(false);
    const ref = useRef(null);

    useEffect(() => {
        const onClick = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
        document.addEventListener('mousedown', onClick);
        return () => document.removeEventListener('mousedown', onClick);
    }, []);

    const active = selectedAccountId == null
        ? connectedAccounts[0]
        : connectedAccounts.find(a => a.id === selectedAccountId);

    const handleConnect = useGoogleLogin({
        flow: 'auth-code',
        scope: GOOGLE_DATA_SCOPES,
        prompt: 'consent',
        onSuccess: async (codeResponse) => {
            setConnecting(true);
            try {
                await connectAccount(codeResponse.code);
            } catch (e) {
                console.error('Failed to connect account:', e);
            } finally {
                setConnecting(false);
                setOpen(false);
            }
        },
        onError: () => setConnecting(false),
    });

    if (connectedAccounts.length === 0) return null;

    return (
        <div className="relative" ref={ref}>
            <button
                onClick={() => setOpen(o => !o)}
                className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-slate-100/80 border border-slate-200/60 hover:bg-slate-200/60 transition-all"
                title="Switch Google account"
            >
                {active?.picture ? (
                    <img src={active.picture} alt={active.display_name} className="w-6 h-6 rounded-full object-cover border border-white shadow-sm" />
                ) : (
                    <div className="w-6 h-6 rounded-full bg-gradient-to-br from-violet-500 to-fuchsia-500 flex items-center justify-center text-[10px] font-black text-white">
                        {active?.display_name?.[0] ?? '?'}
                    </div>
                )}
                <span className="hidden sm:block text-sm font-semibold text-slate-700 leading-none max-w-[120px] truncate">
                    {active?.google_email ?? 'Select account'}
                </span>
                <svg className={`w-3.5 h-3.5 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
            </button>

            {open && (
                <div className="absolute right-0 mt-2 w-72 bg-white border border-slate-200 rounded-xl shadow-xl z-50 overflow-hidden">
                    <div className="px-3 py-2 text-xs font-bold text-slate-400 uppercase tracking-wide border-b border-slate-100">
                        Google Accounts
                    </div>
                    <ul>
                        {connectedAccounts.map(acct => (
                            <li key={acct.id} className="flex items-center gap-3 px-3 py-2.5 hover:bg-slate-50 group">
                                <button
                                    className="flex items-center gap-3 flex-1 min-w-0 text-left"
                                    onClick={() => { switchAccount(acct.id); setOpen(false); }}
                                >
                                    {acct.picture ? (
                                        <img src={acct.picture} alt={acct.display_name} className="w-8 h-8 rounded-full object-cover border border-slate-200 shrink-0" />
                                    ) : (
                                        <div className="w-8 h-8 rounded-full bg-gradient-to-br from-violet-500 to-fuchsia-500 flex items-center justify-center text-xs font-black text-white shrink-0">
                                            {acct.display_name?.[0] ?? '?'}
                                        </div>
                                    )}
                                    <div className="min-w-0">
                                        <p className="text-sm font-semibold text-slate-700 truncate">{acct.display_name}</p>
                                        <p className="text-xs text-slate-400 truncate">{acct.google_email}</p>
                                    </div>
                                </button>
                                <div className="flex items-center gap-1 shrink-0">
                                    {(selectedAccountId === acct.id || (selectedAccountId == null && acct === connectedAccounts[0])) && (
                                        <svg className="w-4 h-4 text-[#26397A]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                        </svg>
                                    )}
                                    {connectedAccounts.length > 1 && (
                                        <button
                                            onClick={() => disconnectAccount(acct.id)}
                                            className="opacity-0 group-hover:opacity-100 p-1 rounded text-slate-300 hover:text-red-400 transition-all"
                                            title="Disconnect"
                                        >
                                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                            </svg>
                                        </button>
                                    )}
                                </div>
                            </li>
                        ))}
                    </ul>
                    <div className="border-t border-slate-100 p-2">
                        <button
                            onClick={() => handleConnect()}
                            disabled={connecting}
                            className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-slate-600 hover:bg-slate-50 transition-all disabled:opacity-50"
                        >
                            <svg className="w-4 h-4 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                            </svg>
                            {connecting ? 'Connecting…' : 'Add Google account'}
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
};

export default AccountSwitcher;

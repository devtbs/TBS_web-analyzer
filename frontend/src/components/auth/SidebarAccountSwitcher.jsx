import { useState, useRef, useEffect } from 'react';
import { GoogleOAuthProvider, useGoogleLogin } from '@react-oauth/google';
import { AnimatePresence, motion } from 'framer-motion';
import {
    ChevronUpDownIcon,
    PlusIcon,
    XMarkIcon,
    ArrowRightEndOnRectangleIcon,
    CheckIcon,
} from '@heroicons/react/24/outline';
import { useAuth } from '../../context/AuthContext';

const GOOGLE_DATA_SCOPES =
    'https://www.googleapis.com/auth/webmasters.readonly https://www.googleapis.com/auth/analytics.readonly https://www.googleapis.com/auth/adwords';

const initial = (s) => (s?.trim()?.[0] ?? 'U').toUpperCase();

/* When the Google account changes, the whole set of GSC/GA4 properties changes,
   so the stored property is stale. Clear it and hard-reload to /my-sites so every
   page re-derives cleanly under the new account. */
const reloadForAccount = () => {
    try { localStorage.removeItem('gsc_selected_property'); } catch { /* storage unavailable */ }
    window.location.assign('/my-sites');
};

const SwitcherInner = ({ collapsed }) => {
    const {
        user,
        connectedAccounts,
        selectedAccountId,
        switchAccount,
        connectAccount,
        disconnectAccount,
        logout,
    } = useAuth();
    const [open, setOpen] = useState(false);
    const [connecting, setConnecting] = useState(false);
    const ref = useRef(null);

    useEffect(() => {
        const onClick = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
        document.addEventListener('mousedown', onClick);
        return () => document.removeEventListener('mousedown', onClick);
    }, []);

    // The account whose data is currently shown across the app.
    const active = connectedAccounts.length === 0
        ? null
        : (selectedAccountId == null
            ? connectedAccounts[0]
            : connectedAccounts.find(a => a.id === selectedAccountId) ?? connectedAccounts[0]);

    // Fall back to the login identity before the accounts list has loaded.
    const displayName = active?.display_name ?? user?.name ?? 'Account';
    const displayEmail = active?.google_email ?? user?.email ?? '';
    const displayPic = active?.picture ?? user?.picture ?? null;

    const isActive = (acct) =>
        selectedAccountId === acct.id || (selectedAccountId == null && acct === connectedAccounts[0]);

    const handleSwitch = (id) => {
        if (active && id === active.id) { setOpen(false); return; }
        switchAccount(id);
        reloadForAccount();
    };

    const handleConnect = useGoogleLogin({
        flow: 'auth-code',
        scope: GOOGLE_DATA_SCOPES,
        prompt: 'consent',
        onSuccess: async (codeResponse) => {
            setConnecting(true);
            try {
                await connectAccount(codeResponse.code);
                reloadForAccount();
            } catch (e) {
                console.error('Failed to connect account:', e);
                setConnecting(false);
            }
        },
        onError: () => setConnecting(false),
    });

    const Avatar = ({ src, name, size = 'w-9 h-9', text = 'text-xs' }) =>
        src ? (
            <img src={src} alt={name} className={`${size} rounded-full object-cover flex-shrink-0`} style={{ border: '1.5px solid rgba(255,255,255,0.2)' }} />
        ) : (
            <div className={`${size} rounded-full flex items-center justify-center ${text} font-black text-white flex-shrink-0`} style={{ background: 'linear-gradient(135deg, #6366f1, #a855f7)' }}>
                {initial(name)}
            </div>
        );

    return (
        <div className="relative" ref={ref}>
            {/* Trigger card */}
            <button
                onClick={() => setOpen(o => !o)}
                title={collapsed ? displayEmail : 'Switch account'}
                className={`flex items-center gap-2.5 rounded-lg transition-all duration-150 outline-none w-full ${
                    collapsed ? 'justify-center px-0 py-0' : 'px-2 py-2.5 hover:bg-white/5'
                }`}
            >
                <Avatar src={displayPic} name={displayName} />
                {!collapsed && (
                    <>
                        <div className="flex-1 min-w-0 overflow-hidden text-left">
                            <p className="text-xs font-bold text-white truncate leading-tight">{displayName}</p>
                            <p className="text-[10px] font-medium truncate leading-tight" style={{ color: '#6b7280' }}>
                                {displayEmail}
                            </p>
                        </div>
                        <ChevronUpDownIcon className="w-4 h-4 text-slate-400 flex-shrink-0" />
                    </>
                )}
            </button>

            {/* Popover — opens upward */}
            <AnimatePresence>
                {open && (
                    <motion.div
                        initial={{ opacity: 0, y: 6, scale: 0.98 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: 6, scale: 0.98 }}
                        transition={{ duration: 0.15 }}
                        className={`absolute bottom-full mb-2 bg-[#0f172a] border border-slate-700/50 rounded-xl shadow-[0_12px_40px_rgb(0,0,0,0.5)] z-[100] overflow-hidden ${
                            collapsed ? 'left-0 w-64' : 'left-0 right-0 w-full'
                        }`}
                    >
                        <div className="px-3 py-2 text-[10px] font-bold text-slate-500 uppercase tracking-[0.14em] border-b border-slate-800">
                            Google Accounts
                        </div>

                        <ul className="max-h-[260px] overflow-y-auto py-1" style={{ scrollbarWidth: 'thin' }}>
                            {connectedAccounts.length === 0 ? (
                                <li className="px-3 py-3 flex items-center gap-3">
                                    <Avatar src={displayPic} name={displayName} size="w-8 h-8" />
                                    <div className="min-w-0">
                                        <p className="text-[13px] font-semibold text-slate-200 truncate">{displayName}</p>
                                        <p className="text-[11px] text-slate-500 truncate">{displayEmail}</p>
                                    </div>
                                </li>
                            ) : connectedAccounts.map(acct => (
                                <li key={acct.id} className="flex items-center gap-2 px-2 py-1.5 mx-1 rounded-lg hover:bg-white/5 group">
                                    <button
                                        onClick={() => handleSwitch(acct.id)}
                                        className="flex items-center gap-3 flex-1 min-w-0 text-left"
                                    >
                                        <Avatar src={acct.picture} name={acct.display_name} size="w-8 h-8" />
                                        <div className="min-w-0">
                                            <p className="text-[13px] font-semibold text-slate-200 truncate">{acct.display_name}</p>
                                            <p className="text-[11px] text-slate-500 truncate">{acct.google_email}</p>
                                        </div>
                                    </button>
                                    <div className="flex items-center gap-1 flex-shrink-0">
                                        {isActive(acct) && <CheckIcon className="w-4 h-4 text-emerald-400" />}
                                        {connectedAccounts.length > 1 && (
                                            <button
                                                onClick={() => disconnectAccount(acct.id)}
                                                className="opacity-0 group-hover:opacity-100 p-1 rounded text-slate-500 hover:text-red-400 transition-all"
                                                title="Disconnect"
                                            >
                                                <XMarkIcon className="w-3.5 h-3.5" />
                                            </button>
                                        )}
                                    </div>
                                </li>
                            ))}
                        </ul>

                        <div className="border-t border-slate-800 p-1.5 space-y-0.5">
                            <button
                                onClick={() => handleConnect()}
                                disabled={connecting}
                                className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-[13px] font-medium text-slate-300 hover:bg-white/5 hover:text-white transition-all disabled:opacity-50"
                            >
                                <PlusIcon className="w-4 h-4 text-slate-400" />
                                {connecting ? 'Connecting…' : 'Add Google account'}
                            </button>
                            <button
                                onClick={logout}
                                className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-[13px] font-medium text-slate-400 hover:bg-red-500/10 hover:text-red-400 transition-all"
                            >
                                <ArrowRightEndOnRectangleIcon className="w-4 h-4" />
                                Log out
                            </button>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
};

const SidebarAccountSwitcher = ({ collapsed = false }) => (
    <GoogleOAuthProvider clientId={import.meta.env.VITE_GOOGLE_CLIENT_ID}>
        <SwitcherInner collapsed={collapsed} />
    </GoogleOAuthProvider>
);

export default SidebarAccountSwitcher;

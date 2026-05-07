import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
    CheckCircleIcon,
    XCircleIcon,
    ArrowPathIcon,
    LinkIcon,
    ShieldCheckIcon,
    MagnifyingGlassIcon,
} from '@heroicons/react/24/outline';
import { CheckCircleIcon as SolidCheckCircle } from '@heroicons/react/24/solid';
import api from '../../api/axios';
import toast from 'react-hot-toast';

/* ─── Small helpers ───────────────────────────────────────────────── */
const getDomain = (url) => {
    try { return new URL(url).hostname.replace('www.', ''); }
    catch { return url; }
};

const getFaviconUrl = (url) => {
    try { return `https://www.google.com/s2/favicons?sz=32&domain_url=${encodeURIComponent(url)}`; }
    catch { return null; }
};

/* ─── Skeleton ────────────────────────────────────────────────────── */
const PropertiesSkeleton = () => (
    <div className="flex flex-col gap-3 animate-pulse w-full">
        {[...Array(3)].map((_, i) => (
            <div key={i} className="flex flex-col sm:flex-row sm:items-center justify-between py-4 px-5 rounded-2xl bg-white border border-transparent">
                <div className="flex items-center gap-4 flex-1 min-w-0">
                    <div className="w-12 h-12 rounded-xl bg-slate-50 flex-shrink-0" />
                    <div className="h-4 bg-slate-50 rounded-full w-48 sm:w-64" />
                </div>
                <div className="h-9 bg-slate-50 rounded-xl w-28 flex-shrink-0 mt-4 sm:mt-0" />
            </div>
        ))}
    </div>
);

const FullSkeleton = () => (
    <div className="w-full animate-pulse">
        <div className="h-[76px] bg-slate-50/80 rounded-2xl mb-6 w-full" />
        <PropertiesSkeleton />
    </div>
);


/* ─── Main ────────────────────────────────────────────────────────── */
const GSCPropertySelector = ({ onPropertySelect, selectedProperties = [] }) => {
    const navigate = useNavigate();
    const [isConnected, setIsConnected] = useState(false);
    const [isConnecting, setIsConnecting] = useState(false);
    const [isFetching, setIsFetching] = useState(false);
    const [isCheckingStatus, setIsCheckingStatus] = useState(true);
    const [properties, setProperties] = useState([]);
    const [searchQuery, setSearchQuery] = useState('');
    const [isGoogleLoaded, setIsGoogleLoaded] = useState(false);

    /* Load Google Identity Services */
    useEffect(() => {
        if (window.google?.accounts?.oauth2) { setIsGoogleLoaded(true); return; }
        const script = document.createElement('script');
        script.src = 'https://accounts.google.com/gsi/client';
        script.async = true;
        script.defer = true;
        script.onload = () => setIsGoogleLoaded(true);
        script.onerror = () => toast.error('Failed to load Google services');
        document.body.appendChild(script);
        return () => {
            const existing = document.querySelector('script[src="https://accounts.google.com/gsi/client"]');
            if (existing?.parentNode) existing.parentNode.removeChild(existing);
        };
    }, []);

    /* Check connection on mount */
    useEffect(() => {
        if (localStorage.getItem('access_token')) checkGSCStatus();
    }, []);

    /* monitor logout */
    useEffect(() => {
        const check = () => {
            if (localStorage.getItem('gsc_token') && !localStorage.getItem('access_token') && isConnected) {
                setIsConnected(false);
                setProperties([]);
                onPropertySelect([]);
            }
        };
        check();
        const id = setInterval(check, 1000);
        return () => clearInterval(id);
    }, [isConnected, onPropertySelect]);

    const checkGSCStatus = async () => {
        setIsCheckingStatus(true);
        try {
            const authToken = localStorage.getItem('access_token');
            const res = await api.get('/auth/gsc/properties');
            if (res.data.properties) { setIsConnected(true); setProperties(res.data.properties); }
        } catch (err) {
            if (err.response?.status !== 404) console.error('GSC status error:', err);
        } finally {
            setIsCheckingStatus(false);
        }
    };

    const handleGoogleConnect = async () => {
        if (!isGoogleLoaded || !window.google?.accounts?.oauth2) {
            toast.error('Google services not loaded yet. Please try again.'); return;
        }
        setIsConnecting(true);
        try {
            // Use Authorization Code flow to get a refresh token (not just an access token)
            // This ensures GSC stays connected permanently, not just for 1 hour
            const client = window.google.accounts.oauth2.initCodeClient({
                client_id: import.meta.env.VITE_GOOGLE_CLIENT_ID,
                scope: 'https://www.googleapis.com/auth/webmasters.readonly',
                ux_mode: 'popup',
                callback: async (response) => {
                    if (response.code) {
                        try {
                            const authToken = localStorage.getItem('access_token');
                            await api.post('/auth/gsc/connect',
                                { gsc_code: response.code }
                            );
                            setIsConnected(true);
                            toast.success('Connected to Google Search Console!');
                            await fetchProperties();
                        } catch (err) {
                            toast.error(err.response?.data?.detail || 'Failed to connect to Search Console');
                        }
                    } else if (response.error) {
                        toast.error(`Google error: ${response.error}`);
                    }
                    setIsConnecting(false);
                },
                error_callback: () => {
                    setIsConnecting(false);
                }
            });
            client.requestCode();
        } catch { toast.error('Failed to initialize Google connection'); setIsConnecting(false); }
    };

    const fetchProperties = async () => {
        setIsFetching(true);
        try {
            const authToken = localStorage.getItem('access_token');
            const res = await api.get('/auth/gsc/properties');
            setProperties(res.data.properties || []);
            if (!res.data.properties?.length) toast('No Search Console properties found.', { duration: 6000 });
        } catch (err) {
            toast.error(err.response?.data?.detail || 'Failed to fetch properties');
            setIsConnected(false);
        } finally { setIsFetching(false); }
    };

    const handleDisconnect = async () => {
        try {
            const authToken = localStorage.getItem('access_token');
            await api.post('/auth/gsc/disconnect', {});
            localStorage.removeItem('gsc_selected_property');
            sessionStorage.clear();
            setIsConnected(false);
            setProperties([]);
            onPropertySelect([]);
            toast.success('Disconnected from Search Console');
        } catch { toast.error('Failed to disconnect'); }
    };

    const handlePropertyToggle = (property) => {
        const selected = selectedProperties.some(p => p.url === property.url);
        if (selected) {
            onPropertySelect(selectedProperties.filter(p => p.url !== property.url));
        } else {
            if (selectedProperties.length >= 5) { toast.error('Maximum 5 properties'); return; }
            onPropertySelect([...selectedProperties, property]);
        }
    };

    const handleSelectPages = (property, e) => {
        e.stopPropagation();
        navigate(`/select-pages?property=${encodeURIComponent(property.url)}`);
    };

    const filtered = properties.filter(p => p.url.toLowerCase().includes(searchQuery.toLowerCase()));

    /* ── Loading ── */
    if (isCheckingStatus) return <FullSkeleton />;

    /* ── Not connected ── */
    if (!isConnected) {
        return (
            <motion.div
                initial={{ opacity: 0, scale: 0.98 }}
                animate={{ opacity: 1, scale: 1 }}
                className="flex flex-col items-center py-10 px-6 text-center rounded-2xl border-2 border-dashed border-emerald-100 bg-emerald-50/30"
            >
                <div className="w-14 h-14 bg-emerald-600 rounded-2xl flex items-center justify-center mb-4 shadow-lg shadow-emerald-600/20 border border-emerald-500">
                    <ShieldCheckIcon className="w-7 h-7 text-white" />
                </div>
                <h3 className="text-xl font-bold text-slate-800 mb-2">Connect Google Search Console</h3>
                <p className="text-base text-slate-500 mb-8 max-w-sm">
                    Connect your GSC account to select properties and pages for analysis
                </p>
                <button
                    onClick={handleGoogleConnect}
                    disabled={isConnecting || !isGoogleLoaded}
                    className={`flex items-center gap-2.5 px-8 py-3.5 rounded-xl text-white text-base font-bold transition-all
                        ${isConnecting || !isGoogleLoaded
                            ? 'text-white/50 bg-emerald-600/50 cursor-not-allowed shadow-none'
                            : 'bg-emerald-600 shadow-md shadow-emerald-600/20 hover:bg-emerald-700 hover:shadow-lg hover:shadow-emerald-600/30 border border-emerald-500/50 active:scale-[0.98]'
                        }`}
                >
                    <LinkIcon className="w-4 h-4" />
                    {!isGoogleLoaded ? 'Loading...' : isConnecting ? 'Connecting...' : 'Connect Search Console'}
                </button>
            </motion.div>
        );
    }

    /* ── Connected ── */
    return (
        <div className="w-full">
            {/* Connection status bar */}
            <div className="flex items-center justify-between px-6 py-5 bg-slate-50/80 border border-slate-100 rounded-2xl mb-6 sm:mb-8">
                <div className="flex items-center gap-3">
                    <SolidCheckCircle className="w-7 h-7 text-emerald-500" />
                    <span className="text-base font-bold text-slate-800">Search Console Connected</span>
                </div>
                <div className="flex items-center gap-3">
                    <button
                        onClick={() => fetchProperties()}
                        disabled={isFetching}
                        className="p-2.5 rounded-xl text-slate-400 hover:bg-white hover:text-slate-600 hover:shadow-sm transition-all"
                        title="Refresh"
                    >
                        <ArrowPathIcon className={`w-5 h-5 ${isFetching ? 'animate-spin' : ''}`} />
                    </button>
                    <button
                        onClick={handleDisconnect}
                        className="px-5 py-2 text-sm font-bold text-slate-600 border border-slate-200 rounded-xl bg-white hover:bg-slate-50 hover:text-slate-800 transition-all shadow-sm"
                    >
                        Disconnect
                    </button>
                </div>
            </div>

            {/* Search — always visible when properties exist */}
            {properties.length > 0 && (
                <div className="relative mb-4">
                    <MagnifyingGlassIcon className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
                    <input
                        type="text"
                        placeholder="Search properties..."
                        value={searchQuery}
                        onChange={e => setSearchQuery(e.target.value)}
                        className="w-full pl-10 pr-10 py-2.5 border border-slate-200 rounded-xl text-sm text-slate-700 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-all bg-slate-50"
                    />
                    {searchQuery && (
                        <button
                            onClick={() => setSearchQuery('')}
                            className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors"
                        >
                            <XCircleIcon className="w-4 h-4" />
                        </button>
                    )}
                </div>
            )}

            {/* Result count when searching */}
            {searchQuery && (
                <p className="text-xs text-slate-400 font-medium mb-3 px-1">
                    {filtered.length === 0
                        ? 'No properties match your search'
                        : `${filtered.length} of ${properties.length} properties`}
                </p>
            )}

            {/* Properties list */}
            <div className="flex flex-col">
                {isFetching && properties.length === 0 ? (
                    <PropertiesSkeleton />
                ) : filtered.length === 0 ? (
                    <div className="flex flex-col items-center py-10 text-center bg-slate-50 rounded-xl border border-slate-100">
                        <XCircleIcon className="w-10 h-10 text-slate-300 mb-2" />
                        <p className="text-sm font-semibold text-slate-500 mb-1">
                            {searchQuery ? `No results for "${searchQuery}"` : 'No properties found'}
                        </p>
                        {searchQuery && (
                            <button
                                onClick={() => setSearchQuery('')}
                                className="mt-2 text-xs text-emerald-600 font-bold hover:underline"
                            >
                                Clear search
                            </button>
                        )}
                    </div>
                ) : (
                    <div className="border-t border-slate-100/80 max-h-[480px] overflow-y-auto pr-1" style={{ scrollbarWidth: 'thin' }}>
                        <AnimatePresence>
                            {filtered.map((property, idx) => {
                                const isSelected = selectedProperties.some(p => p.url === property.url);
                                const domain = getDomain(property.url);
                                const faviconUrl = getFaviconUrl(property.url);
                                const permLabel = property.permission_level?.replace(/_/g, ' ');

                                return (
                                    <motion.div
                                        key={property.url}
                                        initial={{ opacity: 0, y: 5 }}
                                        animate={{ opacity: 1, y: 0 }}
                                        transition={{ delay: idx * 0.05 }}
                                        onClick={() => handlePropertyToggle(property)}
                                        className={`flex flex-col sm:flex-row sm:items-center justify-between py-4 mb-3 border cursor-pointer transition-all duration-300 gap-4 group px-5 rounded-2xl
                                            ${isSelected 
                                                ? 'bg-emerald-50/50 border-emerald-400 shadow-sm ring-1 ring-emerald-500/20' 
                                                : 'bg-white border-slate-200 shadow-sm hover:border-emerald-300 hover:shadow-md hover:bg-emerald-50/30 hover:-translate-y-0.5'}`}
                                    >
                                        <div className="flex items-center gap-4 flex-1 min-w-0">
                                            {/* Favicon / Icon */}
                                            <div className="w-12 h-12 rounded-xl bg-slate-50 border border-slate-100/60 flex flex-shrink-0 items-center justify-center">
                                                {faviconUrl ? (
                                                    <img src={faviconUrl} alt={domain} className="w-6 h-6 object-contain opacity-90"
                                                        onError={e => { e.currentTarget.style.display = 'none'; e.currentTarget.nextSibling.style.display = 'block'; }}
                                                    />
                                                ) : null}
                                                <LinkIcon className={`w-6 h-6 text-slate-400 ${faviconUrl ? 'hidden' : ''}`} />
                                            </div>

                                            {/* Domain & Permission */}
                                            <div className="flex-1 min-w-0 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 items-center">
                                                <p className="text-base font-bold text-slate-800 truncate">{domain}</p>
                                                <p className="text-sm font-medium text-slate-500 capitalize hidden sm:block truncate">{permLabel}</p>
                                                
                                                <div className="hidden lg:flex items-center gap-2 text-emerald-500 font-bold text-sm">
                                                    <SolidCheckCircle className="w-5 h-5" />
                                                    <span>Connected</span>
                                                </div>
                                            </div>
                                        </div>

                                        {/* Actions */}
                                        <div className="flex items-center justify-end gap-4 flex-shrink-0">
                                            <div className="mr-3 h-5 w-5">
                                                {isSelected && <CheckCircleIcon className="w-6 h-6 text-emerald-600" />}
                                            </div>
                                            <button
                                                onClick={e => handleSelectPages(property, e)}
                                                className="px-5 py-2 text-sm font-bold border border-slate-200 text-slate-600 rounded-xl bg-white hover:bg-emerald-50 hover:text-emerald-700 hover:border-emerald-200 transition-colors shadow-sm"
                                            >
                                                Select Pages
                                            </button>
                                        </div>
                                    </motion.div>
                                );
                            })}
                        </AnimatePresence>
                    </div>
                )}
            </div>

        </div>
    );
};

export default GSCPropertySelector;

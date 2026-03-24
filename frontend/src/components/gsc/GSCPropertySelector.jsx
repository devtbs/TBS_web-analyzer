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
import axios from 'axios';
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
const Skeleton = () => (
    <div className="space-y-4 animate-pulse">
        <div className="h-14 bg-slate-100 rounded-xl w-full" />
        {[...Array(3)].map((_, i) => (
            <div key={i} className="flex items-center gap-4 py-4 border-b border-slate-100">
                <div className="w-10 h-10 bg-slate-100 rounded-xl" />
                <div className="flex-1 space-y-2">
                    <div className="h-4 bg-slate-100 rounded w-48" />
                </div>
                <div className="h-8 w-28 bg-slate-100 rounded-lg" />
            </div>
        ))}
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
            const res = await axios.get('/auth/gsc/properties', { headers: { Authorization: `Bearer ${authToken}` } });
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
            const client = window.google.accounts.oauth2.initTokenClient({
                client_id: import.meta.env.VITE_GOOGLE_CLIENT_ID,
                scope: 'https://www.googleapis.com/auth/webmasters.readonly',
                callback: async (response) => {
                    if (response.access_token) {
                        try {
                            const authToken = localStorage.getItem('access_token');
                            await axios.post('/auth/gsc/connect',
                                { gsc_token: response.access_token },
                                { headers: { Authorization: `Bearer ${authToken}` } }
                            );
                            setIsConnected(true);
                            toast.success('Connected to Google Search Console!');
                            await fetchProperties();
                        } catch { toast.error('Failed to connect to Search Console'); }
                    }
                    setIsConnecting(false);
                },
            });
            client.requestAccessToken();
        } catch { toast.error('Failed to initialize Google connection'); setIsConnecting(false); }
    };

    const fetchProperties = async () => {
        setIsFetching(true);
        try {
            const authToken = localStorage.getItem('access_token');
            const res = await axios.get('/auth/gsc/properties', { headers: { Authorization: `Bearer ${authToken}` } });
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
            await axios.post('/auth/gsc/disconnect', {}, { headers: { Authorization: `Bearer ${authToken}` } });
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
    if (isCheckingStatus) return <Skeleton />;

    /* ── Not connected ── */
    if (!isConnected) {
        return (
            <motion.div
                initial={{ opacity: 0, scale: 0.98 }}
                animate={{ opacity: 1, scale: 1 }}
                className="flex flex-col items-center py-6 px-6 text-center rounded-2xl border-2 border-dashed border-slate-200 bg-slate-50"
            >
                <div className="w-14 h-14 bg-gradient-to-br from-violet-500 to-purple-600 rounded-2xl flex items-center justify-center mb-4 shadow-lg shadow-purple-300/40">
                    <ShieldCheckIcon className="w-7 h-7 text-white" />
                </div>
                <h3 className="text-xl font-bold text-slate-800 mb-3">Connect Google Search Console</h3>
                <p className="text-base text-slate-500 mb-8 max-w-sm">
                    Connect your GSC account to select properties and pages for analysis
                </p>
                <button
                    onClick={handleGoogleConnect}
                    disabled={isConnecting || !isGoogleLoaded}
                    className={`flex items-center gap-2.5 px-8 py-3.5 rounded-xl text-white text-base font-bold transition-all
                        ${isConnecting || !isGoogleLoaded
                            ? 'bg-slate-300 cursor-not-allowed'
                            : 'bg-gradient-to-r from-violet-600 to-purple-600 shadow-md shadow-purple-300/40 hover:shadow-lg hover:shadow-purple-400/40'
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

            {/* Search conditionally */}
            {properties.length > 5 && (
                <div className="relative mb-4">
                    <MagnifyingGlassIcon className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
                    <input
                        type="text"
                        placeholder="Search properties..."
                        value={searchQuery}
                        onChange={e => setSearchQuery(e.target.value)}
                        className="w-full pl-10 pr-4 py-2 border border-slate-200 rounded-lg text-sm text-slate-700 placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-violet-400 focus:border-violet-400 transition-all bg-slate-50"
                    />
                </div>
            )}

            {/* Properties list */}
            <div className="flex flex-col">
                {isFetching ? (
                    <Skeleton />
                ) : filtered.length === 0 ? (
                    <div className="flex flex-col items-center py-8 text-center bg-slate-50 rounded-xl border border-slate-100">
                        <XCircleIcon className="w-10 h-10 text-slate-300 mb-2" />
                        <p className="text-sm text-slate-500">No properties found</p>
                    </div>
                ) : (
                    <div className="border-t border-slate-100/80 max-h-[400px] overflow-y-auto pr-1">
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
                                        className={`flex flex-col sm:flex-row sm:items-center justify-between py-5 border-b border-slate-100/80 cursor-pointer transition-all duration-200 gap-4 group px-3
                                            ${isSelected ? 'bg-violet-50/40 rounded-xl' : 'hover:bg-slate-50 rounded-xl'}`}
                                    >
                                        <div className="flex items-center gap-4 flex-1 min-w-0">
                                            {/* Favicon / Icon */}
                                            <div className="w-12 h-12 rounded-xl bg-violet-50 flex flex-shrink-0 items-center justify-center">
                                                {faviconUrl ? (
                                                    <img src={faviconUrl} alt={domain} className="w-6 h-6 object-contain opacity-90"
                                                        onError={e => { e.currentTarget.style.display = 'none'; e.currentTarget.nextSibling.style.display = 'block'; }}
                                                    />
                                                ) : null}
                                                <LinkIcon className={`w-6 h-6 text-violet-400 ${faviconUrl ? 'hidden' : ''}`} />
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
                                                {isSelected && <CheckCircleIcon className="w-6 h-6 text-violet-600 animate-pulse" />}
                                            </div>
                                            <button
                                                onClick={e => handleSelectPages(property, e)}
                                                className="px-5 py-2 text-sm font-bold border border-violet-400/80 text-violet-600 rounded-xl bg-white hover:bg-violet-50 hover:text-violet-700 transition-colors shadow-sm"
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

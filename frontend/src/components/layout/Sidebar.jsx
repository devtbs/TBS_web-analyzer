import { useState, useEffect } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import ConfirmDialog from '../ui/ConfirmDialog';
import NotificationBell from '../NotificationBell';
 
import { useAuth } from '../../context/AuthContext';
import { motion, AnimatePresence } from 'framer-motion';
import {
    ClockIcon,
    RocketLaunchIcon,
    Squares2X2Icon,
    DocumentTextIcon,
    ChevronDownIcon,
    XMarkIcon,
    MagnifyingGlassIcon,
    DocumentDuplicateIcon,
    GlobeAltIcon,
    ArrowTrendingUpIcon,
    ArrowsUpDownIcon,
    PresentationChartLineIcon,
    MapIcon,
    FolderOpenIcon,
    RectangleGroupIcon,
    CircleStackIcon,
    ArrowLeftIcon,
    ChartPieIcon,
    MegaphoneIcon,
    WrenchScrewdriverIcon,
    SparklesIcon,
} from '@heroicons/react/24/outline';
import { 
    FolderIcon as FolderIconSolid, 
    EllipsisHorizontalIcon 
} from '@heroicons/react/20/solid';
import Favicon from '../ui/Favicon';
import SidebarAccountSwitcher from '../auth/SidebarAccountSwitcher';
import api from '../../api/axios';

/* ── GSC Wizard-style property nav config ────────────────── */
const PROPERTY_NAV = [
    {
        section: 'ANALYTICS',
        collapsible: false,
        items: [
            { label: 'Dashboard',           path: '/seo-analytics',                    icon: Squares2X2Icon },
            { label: 'Queries',             path: '/seo-analytics/queries',        icon: MagnifyingGlassIcon },
            { label: 'Pages',               path: '/seo-analytics/pages',          icon: DocumentTextIcon },
            { label: 'Countries',           path: '/seo-analytics/countries',         icon: GlobeAltIcon },
            { label: 'New & Lost Rankings', path: '/seo-analytics/new-lost-rankings',       icon: ArrowTrendingUpIcon },
        ],
    },
    {
        section: 'OPTIMIZATION',
        collapsible: true,
        items: [
            { label: 'Striking Distance',   path: '/seo-analytics/striking-distance',  icon: ArrowTrendingUpIcon },
            { label: 'CTR Analysis',        path: '/seo-analytics/ctr-opportunities',  icon: PresentationChartLineIcon },
            { label: 'Query Decay',         path: '/seo-analytics/query-decay',        icon: ArrowsUpDownIcon },
        ],
    },
    {
        section: 'SITE ANALYSIS',
        collapsible: true,
        items: [
            { label: 'Cannibalization',     path: '/seo-analytics/cannibalization',    icon: DocumentDuplicateIcon },
            { label: 'Topic Clusters',      path: '/seo-analytics/topic-clusters',     icon: RectangleGroupIcon },
        ],
    },
];

/* ── Helper to read stored property ────────────────────────────── */
const getScheme = (url) => {
    if (!url) return 'Domain';
    if (url.startsWith('sc-domain:')) return 'Domain';
    try { return new URL(url).protocol === 'https:' ? 'HTTPS' : 'HTTP'; }
    catch { return 'Domain'; }
};
const SCHEME_PILL = {
    'HTTPS':  'bg-emerald-100 text-emerald-700',
    'HTTP':   'bg-red-100 text-red-600',
    'Domain': 'bg-amber-100 text-amber-700',
};

const getDomain = (url) => {
    try { 
        let domain = new URL(url).hostname.replace('www.', ''); 
        return domain.length > 25 ? domain.substring(0, 22) + '...' : domain;
    }
    catch { 
        return url && url.length > 25 ? url.substring(0, 22) + '...' : url; 
    }
};


const NAV_GROUPS = [
    {
        section: 'Overview',
        items: [
            { label: 'My Sites',     path: '/my-sites',    icon: Squares2X2Icon },
        ],
    },
    {
        section: 'Analyze',
        items: [
            { label: 'AI Assistant', path: '/assistant', icon: SparklesIcon },
            { label: 'New Analysis', path: '/new-analysis', icon: RocketLaunchIcon },
            { label: 'History',      path: '/history',      icon: ClockIcon },
            { label: 'GA4 Analytics', path: '/ga4-analytics', icon: ChartPieIcon },
            { label: 'Google Ads', path: '/google-ads', icon: MegaphoneIcon },
            { label: 'Technical Audit', path: '/technical-audit', icon: WrenchScrewdriverIcon },
        ],
    },
    {
        section: 'Writing',
        items: [
            { label: 'Documents',    path: '/documents',    icon: DocumentTextIcon },
            { label: 'AI Presentation', path: '/presentation', icon: PresentationChartLineIcon },
        ],
    },
];

const Sidebar = ({ mobileOpen, onMobileClose }) => {
    const navigate = useNavigate();
    const [collapsed, setCollapsed] = useState(() => {
        const saved = localStorage.getItem('sidebar_collapsed');
        return saved === 'true';
    });
    const [isFoldersOpen, setIsFoldersOpen] = useState(() => {
        const saved = localStorage.getItem('sidebar_folders_open');
        return saved !== 'false'; // default to true
    });
    const [folders, setFolders] = useState([]);

    const [isMenuTransitioning, setIsMenuTransitioning] = useState(false);
    
    // GSC Property Selector State
    const [properties, setProperties] = useState([]);
    const [isDomainPickerOpen, setIsDomainPickerOpen] = useState(false);
    const [domainSearch, setDomainSearch] = useState('');

    useEffect(() => {
        localStorage.setItem('sidebar_folders_open', isFoldersOpen);
        setIsMenuTransitioning(true);
    }, [isFoldersOpen]);


    const [activeFolderMenu, setActiveFolderMenu] = useState(null);
    const [editingFolder, setEditingFolder] = useState(null);
    const [renameValue, setRenameValue] = useState('');
    const [deleteFolderTarget, setDeleteFolderTarget] = useState(null); // folder name string

    const dispatchRefresh = () => {
        window.dispatchEvent(new CustomEvent('documents-updated'));
    };

    const fetchFolders = async () => {
        try {
            const response = await api.get('/api/documents');
            const documentFolders = response.data.map(doc => doc.folder).filter(Boolean);
            
            // Get already saved folders from localStorage
            const savedFolders = JSON.parse(localStorage.getItem('persistent_folders') || '[]');
            
            // Merge actual folders from docs with saved folders
            const allUniqueFolders = [...new Set([...documentFolders, ...savedFolders])].sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
            
            // Update state and persistence
            setFolders(allUniqueFolders);
            localStorage.setItem('persistent_folders', JSON.stringify(allUniqueFolders));
        } catch (error) {
            console.error('Failed to fetch folders:', error);
        }
    };

    useEffect(() => {
        fetchFolders();
        window.addEventListener('documents-updated', fetchFolders);
        const handleClickOutside = () => setActiveFolderMenu(null);
        window.addEventListener('click', handleClickOutside);
        return () => {
            window.removeEventListener('documents-updated', fetchFolders);
            window.removeEventListener('click', handleClickOutside);
        };
    }, []);

    const handleRenameFolder = (e, folderName) => {
        e.preventDefault();
        e.stopPropagation();
        setEditingFolder(folderName);
        setRenameValue(folderName);
        setActiveFolderMenu(null);
    };

    const saveRename = async (oldName) => {
        const newName = renameValue.trim();
        if (!newName || newName === oldName) {
            setEditingFolder(null);
            return;
        }

        try {
            await api.put(`/api/folders/${encodeURIComponent(oldName)}`, { new_name: newName });
            
            // Also update localStorage
            const savedFolders = JSON.parse(localStorage.getItem('persistent_folders') || '[]');
            const updatedPersistent = savedFolders.map(f => f === oldName ? newName : f);
            localStorage.setItem('persistent_folders', JSON.stringify(updatedPersistent));

            setFolders(prev => prev.map(f => f === oldName ? newName : f));
            dispatchRefresh();
            toast.success('Folder renamed');
        } catch (error) {
            toast.error('Failed to rename folder');
        } finally {
            setEditingFolder(null);
        }
    };

    const handleDeleteFolder = (e, folderName) => {
        e.preventDefault();
        e.stopPropagation();
        setActiveFolderMenu(null);
        setDeleteFolderTarget(folderName);
    };

    const confirmDeleteFolder = async () => {
        if (!deleteFolderTarget) return;
        try {
            await api.delete(`/api/folders/${encodeURIComponent(deleteFolderTarget)}`);
            
            // Also remove from localStorage
            const savedFolders = JSON.parse(localStorage.getItem('persistent_folders') || '[]');
            const updatedPersistent = savedFolders.filter(f => f !== deleteFolderTarget);
            localStorage.setItem('persistent_folders', JSON.stringify(updatedPersistent));

            setFolders(prev => prev.filter(f => f !== deleteFolderTarget));
            dispatchRefresh();
            toast.success('Folder deleted');
        } catch (error) {
            toast.error('Failed to delete folder');
        } finally {
            setDeleteFolderTarget(null);
        }
    };

    useEffect(() => {
        localStorage.setItem('sidebar_collapsed', collapsed);
    }, [collapsed]);

    const { user } = useAuth();
    const location = useLocation();

    /* ── Determine if we are in property/analytics mode ── */
    const isPropertyMode = location.pathname === '/seo-analytics' || location.pathname.startsWith('/seo-analytics/');
    const selectedProperty = localStorage.getItem('gsc_selected_property') || '';
    const scheme = getScheme(selectedProperty);
    const schemeStyle = SCHEME_PILL[scheme] || SCHEME_PILL['Domain'];
    const displayUrl = selectedProperty
        ? selectedProperty.replace(/^https?:\/\//, '').replace(/^sc-domain:/, '')
        : '';

    useEffect(() => {
        if (!isPropertyMode) return;
        const fetchProperties = async () => {
            try {
                const authToken = localStorage.getItem('access_token');
                if (!authToken) return;
                const res = await api.get('/auth/gsc/properties');
                setProperties(res.data.properties || []);
            } catch (err) {
                console.warn("Failed to fetch properties in sidebar", err);
            }
        };
        fetchProperties();
    }, [isPropertyMode]);

    const handleSelectProperty = (url) => {
        localStorage.setItem('gsc_selected_property', url);
        setIsDomainPickerOpen(false);
        setDomainSearch('');
        window.dispatchEvent(new Event('gsc_property_changed'));
    };

    /* ── Collapsible section state for property nav ── */
    const [openSections, setOpenSections] = useState({ 'OPTIMIZATION': true, 'SITE ANALYSIS': false });
    const toggleSection = (section) => setOpenSections(prev => ({ ...prev, [section]: !prev[section] }));

    const isActive = (path) => {
        if (path.includes('?')) {
            return location.pathname + location.search === path;
        }
        return location.pathname === path;
    };

    return (
        <>
        {/* Mobile overlay backdrop */}
        <AnimatePresence>
            {mobileOpen && (
                <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.2 }}
                    className="fixed inset-0 bg-black/50 z-40 md:hidden"
                    onClick={onMobileClose}
                />
            )}
        </AnimatePresence>

        {/* Desktop sidebar */}
        <motion.aside
            initial={false}
            animate={{ width: collapsed ? 76 : 260 }}
            transition={{ type: 'spring', stiffness: 300, damping: 35 }}
            className="hidden md:flex relative flex-col h-screen sticky top-0 flex-shrink-0 z-40 overflow-hidden border-r border-slate-700/30"
            style={{ background: '#1e293b' }}
        >
            <div className="relative flex flex-col h-full">

                {/* ── Top bar: logo ── */}
                <div className={`flex items-center h-[96px] flex-shrink-0 ${ collapsed ? 'justify-center px-0' : 'px-5' }`} style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                    {collapsed ? (
                        <img src="/TBS-Logo.webp" alt="TBS Logo" className="w-11 h-11 object-contain" />
                    ) : (
                        <div className="flex items-center w-full">
                            <img src="/TBS-Logo.webp" alt="TBS Logo" className="h-[52px] w-auto object-contain flex-shrink-0" />
                            <div className="ml-auto">
                                <NotificationBell />
                            </div>
                        </div>
                    )}
                </div>

                {/* ════════════════════════════════════════════════
                    PROPERTY MODE NAV (when on /seo-analytics)
                    ════════════════════════════════════════════════ */}
                {isPropertyMode && !collapsed ? (
                    <div className="flex flex-col flex-1 overflow-hidden">
                        {/* Back link */}
                        <button
                            onClick={() => navigate('/my-sites')}
                            className="flex items-center gap-2 px-4 py-3 text-slate-400 hover:text-slate-200 transition-colors text-[12px] font-semibold"
                            style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}
                        >
                            <ArrowLeftIcon className="w-3.5 h-3.5" />
                            All sites
                        </button>

                        {/* Sidebar Property Selector */}
                        <div className="px-3 py-3 border-b border-white/5">
                            <div className="relative">
                                <button
                                    onClick={() => setIsDomainPickerOpen(!isDomainPickerOpen)}
                                    className="w-full flex items-center justify-between gap-2 px-3 py-2.5 bg-white/5 hover:bg-white/10 border border-white/5 rounded-xl transition-all duration-150 text-left group"
                                >
                                    <div className="flex items-center gap-2.5 min-w-0">
                                        {selectedProperty ? (
                                            <Favicon url={selectedProperty} size={18} className="rounded-sm flex-shrink-0" />
                                        ) : (
                                            <GlobeAltIcon className="w-[18px] h-[18px] text-slate-400" />
                                        )}
                                        <span className="text-slate-200 font-bold text-[13px] truncate">
                                            {selectedProperty ? getDomain(selectedProperty) : 'Select Domain'}
                                        </span>
                                    </div>
                                    <ChevronDownIcon className={`w-4 h-4 text-slate-500 transition-transform duration-200 flex-shrink-0 ${isDomainPickerOpen ? 'rotate-180' : ''}`} />
                                </button>

                                <AnimatePresence>
                                    {isDomainPickerOpen && (
                                        <>
                                            <div className="fixed inset-0 z-40" onClick={() => { setIsDomainPickerOpen(false); setDomainSearch(''); }} />
                                            <motion.div
                                                initial={{ opacity: 0, y: 4, scale: 0.98 }}
                                                animate={{ opacity: 1, y: 0, scale: 1 }}
                                                exit={{ opacity: 0, y: 4, scale: 0.98 }}
                                                transition={{ duration: 0.15 }}
                                                className="absolute left-0 right-0 top-[calc(100%+8px)] w-full bg-[#0f172a] border border-slate-700/50 rounded-xl shadow-[0_12px_40px_rgb(0,0,0,0.5)] z-50 overflow-hidden"
                                            >
                                                <div className="p-2 border-b border-slate-800 sticky top-0 bg-[#0f172a] z-10">
                                                    <div className="relative">
                                                        <MagnifyingGlassIcon className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
                                                        <input
                                                            autoFocus
                                                            type="text"
                                                            placeholder="Search properties..."
                                                            className="w-full bg-[#1e293b] border-none rounded-lg pl-8 pr-7 py-2 text-[12px] text-slate-200 outline-none focus:ring-1 focus:ring-emerald-500/50 placeholder:text-slate-500 transition-colors"
                                                            value={domainSearch}
                                                            onChange={(e) => setDomainSearch(e.target.value)}
                                                        />
                                                        {domainSearch && (
                                                            <button onClick={() => setDomainSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-200">
                                                                <XMarkIcon className="w-3 h-3" />
                                                            </button>
                                                        )}
                                                    </div>
                                                </div>
                                                <div className="max-h-[280px] overflow-y-auto p-1 space-y-0.5">
                                                    {properties.length === 0 ? (
                                                        <div className="px-3 py-6 text-center text-[12px] text-slate-500">No properties</div>
                                                    ) : properties.filter(p => p.url.toLowerCase().includes(domainSearch.toLowerCase())).length === 0 ? (
                                                        <div className="px-3 py-6 text-center text-[12px] text-slate-500">No results</div>
                                                    ) : (
                                                        properties.filter(p => p.url.toLowerCase().includes(domainSearch.toLowerCase())).map(p => (
                                                            <button
                                                                key={p.url}
                                                                onClick={() => handleSelectProperty(p.url)}
                                                                className={`w-full flex items-center justify-between gap-3 px-2 py-2 rounded-lg text-left transition-colors ${
                                                                    selectedProperty === p.url ? 'bg-emerald-500/10 text-emerald-400' : 'text-slate-300 hover:bg-white/5'
                                                                }`}
                                                            >
                                                                <div className="flex items-center gap-2.5 min-w-0">
                                                                    <Favicon url={p.url} size={16} className={`rounded-sm flex-shrink-0 ${selectedProperty === p.url ? '' : 'grayscale opacity-70'}`} />
                                                                    <span className={`text-[12px] font-medium truncate ${selectedProperty === p.url ? 'text-emerald-400' : 'text-slate-300'}`}>
                                                                        {getDomain(p.url)}
                                                                    </span>
                                                                </div>
                                                                {selectedProperty === p.url && <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 flex-shrink-0" />}
                                                            </button>
                                                        ))
                                                    )}
                                                </div>
                                            </motion.div>
                                        </>
                                    )}
                                </AnimatePresence>
                            </div>
                        </div>

                        {/* Property nav groups */}
                        <nav className="flex-1 overflow-y-auto px-2 py-3 space-y-4" style={{ scrollbarWidth: 'none' }}>
                            {PROPERTY_NAV.map(({ section, collapsible, items }) => {
                                const isOpen = !collapsible || openSections[section];
                                return (
                                    <div key={section}>
                                        {/* Section header */}
                                        <div
                                            className={`flex items-center justify-between px-2 mb-1 ${ collapsible ? 'cursor-pointer' : '' }`}
                                            onClick={() => collapsible && toggleSection(section)}
                                        >
                                            <p className="text-[10px] font-bold tracking-[0.14em] uppercase text-slate-500">
                                                {section}
                                            </p>
                                            {collapsible && (
                                                <ChevronDownIcon className={`w-3 h-3 text-slate-600 transition-transform duration-200 ${ isOpen ? '' : '-rotate-90' }`} />
                                            )}
                                        </div>

                                        {/* Items */}
                                        <AnimatePresence initial={false}>
                                            {isOpen && (
                                                <motion.div
                                                    initial={{ height: 0, opacity: 0 }}
                                                    animate={{ height: 'auto', opacity: 1 }}
                                                    exit={{ height: 0, opacity: 0 }}
                                                    transition={{ duration: 0.18 }}
                                                    className="space-y-0.5 overflow-hidden"
                                                >
                                                    {items.map(({ label, path, icon: Icon }) => {
                                                        const active = isActive(path);
                                                        return (
                                                            <Link
                                                                key={path}
                                                                to={path}
                                                                className={`flex items-center gap-3 rounded-lg px-3 py-2 transition-all duration-150 outline-none`}
                                                                style={{
                                                                    color: active ? '#10b981' : '#94a3b8',
                                                                    background: active ? 'rgba(16,185,129,0.08)' : 'transparent',
                                                                }}
                                                                onMouseEnter={e => { if (!active) { e.currentTarget.style.background = 'rgba(255,255,255,0.05)'; e.currentTarget.style.color = '#e2e8f0'; } }}
                                                                onMouseLeave={e => { if (!active) { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#94a3b8'; } }}
                                                            >
                                                                <Icon className="w-4 h-4 flex-shrink-0" />
                                                                <span className={`text-[13px] whitespace-nowrap ${ active ? 'font-bold' : 'font-medium' }`}>
                                                                    {label}
                                                                </span>
                                                            </Link>
                                                        );
                                                    })}
                                                </motion.div>
                                            )}
                                        </AnimatePresence>
                                    </div>
                                );
                            })}
                        </nav>
                    </div>
                ) : isPropertyMode && collapsed ? (
                    /* Collapsed property mode — icon-only nav */
                    <nav className="flex-1 overflow-y-auto px-0 py-3 space-y-1.5" style={{ scrollbarWidth: 'none' }}>
                        {PROPERTY_NAV.flatMap(g => g.items).map(({ label, path, icon: Icon }) => {
                            const active = isActive(path);
                            return (
                                <Link
                                    key={path}
                                    to={path}
                                    title={label}
                                    className="relative flex items-center justify-center py-1.5 group outline-none"
                                    style={{ color: active ? '#10b981' : '#9ca3af' }}
                                    onMouseEnter={e => { if (!active) e.currentTarget.style.color = '#d1d5db'; }}
                                    onMouseLeave={e => { if (!active) e.currentTarget.style.color = '#9ca3af'; }}
                                >
                                    <div
                                        className={`w-10 h-10 rounded-xl flex items-center justify-center transition-all duration-150 ${ active ? '' : 'group-hover:bg-white/5' }`}
                                        style={{ 
                                            background: active ? 'rgba(16,185,129,0.12)' : 'transparent',
                                            boxShadow: active ? '0 0 15px rgba(16, 185, 129, 0.1)' : 'none'
                                        }}
                                    >
                                        <Icon className="flex-shrink-0 transition-colors" style={{ width: 20, height: 20, color: active ? '#10b981' : 'inherit' }} />
                                    </div>
                                </Link>
                            );
                        })}
                    </nav>
                ) : (
                /* ════════════════════════════════════════════════
                    NORMAL NAV (all other routes)
                    ════════════════════════════════════════════════ */
                    <nav className={`flex-1 overflow-y-auto overflow-x-hidden ${ collapsed ? 'px-0 space-y-1.5 pt-4' : 'px-2 py-2 space-y-6' } scrollbar-hide`} style={{ scrollbarWidth: 'none' }}>
                    {NAV_GROUPS.map(({ section, items }) => (
                        <div key={section} className={collapsed ? 'space-y-0' : 'space-y-1.5'}>
                            {/* Section label */}
                            <AnimatePresence initial={false}>
                                {!collapsed && (
                                    <motion.p
                                        initial={{ opacity: 0 }}
                                        animate={{ opacity: 1 }}
                                        exit={{ opacity: 0 }}
                                        transition={{ duration: 0.14 }}
                                        className="px-3 mb-1.5 text-[11px] font-bold tracking-[0.14em] uppercase"
                                        style={{ color: '#6b7280' }}
                                    >
                                        {section}
                                    </motion.p>
                                )}
                            </AnimatePresence>

                            {/* Items */}
                            <div className={collapsed ? 'space-y-1.5' : 'space-y-0.5'}>
                                {items.map(({ label, path, icon: Icon }) => {
                                    const active = isActive(path);
                                    return (
                                        <Link
                                            key={path}
                                            to={path}
                                            title={collapsed ? label : undefined}
                                            className={`relative flex items-center gap-3.5 rounded-lg transition-all duration-150 outline-none group ${
                                                collapsed ? 'justify-center px-0 py-1.5' : 'px-3 py-2.5'
                                            }`}
                                            style={{
                                                color: active ? '#10b981' : '#9ca3af',
                                                background: (!collapsed && active) ? 'rgba(16, 185, 129, 0.08)' : 'transparent',
                                            }}
                                            onMouseEnter={e => {
                                                if (!active && !collapsed) e.currentTarget.style.background = 'rgba(255,255,255,0.06)';
                                                if (!active) e.currentTarget.style.color = '#d1d5db';
                                            }}
                                            onMouseLeave={e => {
                                                if (!active) {
                                                    e.currentTarget.style.background = 'transparent';
                                                    e.currentTarget.style.color = '#9ca3af';
                                                }
                                            }}
                                        >

                                            {collapsed ? (
                                                <div
                                                    className={`w-10 h-10 rounded-xl flex items-center justify-center transition-all duration-150 ${active ? '' : 'group-hover:bg-white/5'}`}
                                                    style={{ 
                                                        background: active ? 'rgba(16, 185, 129, 0.12)' : 'transparent',
                                                        boxShadow: active ? '0 0 15px rgba(16, 185, 129, 0.1)' : 'none'
                                                     }}
                                                >
                                                    <Icon className="flex-shrink-0" style={{ width: 20, height: 20, color: active ? '#10b981' : 'inherit' }} />
                                                </div>
                                            ) : (
                                                <>
                                                    <Icon className="flex-shrink-0 transition-colors" style={{ width: 20, height: 20 }} />
                                                    <AnimatePresence initial={false}>
                                                        <motion.span
                                                            initial={{ opacity: 0, x: -6 }}
                                                            animate={{ opacity: 1, x: 0 }}
                                                            exit={{ opacity: 0, x: -6 }}
                                                            transition={{ duration: 0.15 }}
                                                            className={`text-[15px] whitespace-nowrap ${active ? 'font-bold' : 'font-medium'}`}
                                                        >
                                                            {label}
                                                        </motion.span>
                                                    </AnimatePresence>
                                                </>
                                            )}
                                        </Link>
                                    );
                                })}
                            </div>
                        </div>
                    ))}

                    {/* ── Dynamic Folders Section ── */}
                    {folders.length > 0 && (
                        <div className={collapsed ? "space-y-1.5 pt-1.5" : "space-y-1 pt-2"}>
                            <AnimatePresence initial={false}>
                                {!collapsed && (
                                    <motion.div
                                        initial={{ opacity: 0 }}
                                        animate={{ opacity: 1 }}
                                        exit={{ opacity: 0 }}
                                        onClick={() => setIsFoldersOpen(!isFoldersOpen)}
                                        className="px-3 flex items-center justify-between mb-2 group/header cursor-pointer select-none"
                                    >
                                        <p className="text-[12px] font-medium tracking-tight text-slate-400 group-hover/header:text-slate-200 transition-colors">
                                            Your folders
                                        </p>
                                        <ChevronDownIcon className={`w-3 h-3 text-slate-500 group-hover/header:text-slate-300 transition-transform duration-200 ${isFoldersOpen ? '' : '-rotate-90'}`} />
                                    </motion.div>
                                )}
                            </AnimatePresence>

                            <AnimatePresence>
                                {isFoldersOpen && (
                                    <motion.div 
                                        initial={collapsed ? { opacity: 1 } : { height: 0, opacity: 0 }}
                                        animate={{ height: 'auto', opacity: 1 }}
                                        exit={{ height: 0, opacity: 0 }}
                                        transition={{ duration: 0.2 }}
                                        onAnimationComplete={() => setIsMenuTransitioning(false)}
                                        className={collapsed ? "space-y-1.5" : "space-y-0.5"}
                                        style={{ overflow: isFoldersOpen && !isMenuTransitioning ? 'visible' : 'hidden' }}
                                    >
                                        {folders.map((folder) => {
                                            const folderPath = `/documents?folder=${encodeURIComponent(folder)}`;
                                            const active = isActive(folderPath);

                                            if (collapsed) {
                                                return (
                                                    <Link
                                                        key={folder}
                                                        to={folderPath}
                                                        title={folder}
                                                        className="flex items-center justify-center py-1.5 group"
                                                    >
                                                        <div
                                                            className={`w-10 h-10 rounded-xl flex items-center justify-center transition-all duration-150 ${active ? '' : 'group-hover:bg-white/5'}`}
                                                            style={{ 
                                                                background: active ? 'rgba(16, 185, 129, 0.12)' : 'transparent',
                                                                boxShadow: active ? '0 0 15px rgba(16, 185, 129, 0.1)' : 'none'
                                                            }}
                                                        >
                                                            <FolderIconSolid 
                                                                className={`flex-shrink-0 transition-colors ${active ? 'text-emerald-500' : 'text-slate-500 group-hover:text-slate-300'}`} 
                                                                style={{ width: 19, height: 19 }} 
                                                            />
                                                        </div>
                                                    </Link>
                                                );
                                            }

                                            return (
                                                <div 
                                                    key={folder}
                                                    className={`relative group/item ${activeFolderMenu === folder ? 'z-[50]' : 'z-[10]'}`}
                                                >
                                                    {editingFolder === folder ? (
                                                        <div className="flex items-center gap-3 px-3 py-1.5 rounded-md bg-white/10 border border-emerald-500/30 mx-1">
                                                            <FolderIconSolid className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                                                            <input 
                                                                autoFocus
                                                                type="text"
                                                                value={renameValue}
                                                                onChange={(e) => setRenameValue(e.target.value)}
                                                                onKeyDown={(e) => {
                                                                    if (e.key === 'Enter') saveRename(folder);
                                                                    if (e.key === 'Escape') setEditingFolder(null);
                                                                    e.stopPropagation();
                                                                }}
                                                                onBlur={() => saveRename(folder)}
                                                                onClick={(e) => e.stopPropagation()}
                                                                className="bg-transparent border-none p-0 text-[13px] text-white w-full outline-none"
                                                            />
                                                        </div>
                                                    ) : (
                                                        <>
                                                            <Link
                                                                to={folderPath}
                                                                className={`flex items-center justify-between rounded-md transition-all duration-150 outline-none px-3 py-1.5`}
                                                                style={{
                                                                    color: active ? '#10b981' : '#94a3b8',
                                                                    background: active ? 'rgba(16, 185, 129, 0.08)' : 'transparent',
                                                                }}
                                                                onMouseEnter={e => {
                                                                    if (!active) e.currentTarget.style.background = 'rgba(255,255,255,0.04)';
                                                                    e.currentTarget.style.color = '#fff';
                                                                }}
                                                                onMouseLeave={e => {
                                                                    if (!active) {
                                                                        e.currentTarget.style.background = 'transparent';
                                                                        e.currentTarget.style.color = '#94a3b8';
                                                                    }
                                                                }}
                                                            >
                                                                <div className="flex items-center gap-3 min-w-0">
                                                                    {folder && (folder.startsWith('http') || folder.includes('.')) ? (
                                                                        <Favicon url={folder} size={18} className={`flex-shrink-0 ${active ? '' : 'grayscale opacity-70'}`} />
                                                                    ) : (
                                                                        <FolderIconSolid 
                                                                            className={`flex-shrink-0 transition-colors ${active ? 'text-emerald-500' : 'text-slate-500 group-hover/item:text-slate-300'}`} 
                                                                            style={{ width: 18, height: 18 }} 
                                                                        />
                                                                    )}
                                                                    <span className={`text-[13px] truncate ${active ? 'font-semibold' : 'font-medium'}`}>
                                                                        {folder}
                                                                    </span>
                                                                </div>
                                                                <div className="w-6" />
                                                            </Link>
                                                            
                                                            {/* Ellipsis menu outside of Link */}
                                                            <div className="absolute right-1 top-1/2 -translate-y-1/2 z-[20]">
                                                                <button
                                                                    className={`p-1 hover:bg-white/10 rounded transition-all ${
                                                                        activeFolderMenu === folder 
                                                                            ? 'opacity-100' 
                                                                            : (activeFolderMenu ? 'opacity-0' : 'opacity-0 group-hover/item:opacity-100')
                                                                    }`}
                                                                    onClick={(e) => {
                                                                        e.preventDefault();
                                                                        e.stopPropagation();
                                                                        setActiveFolderMenu(activeFolderMenu === folder ? null : folder);
                                                                    }}
                                                                >
                                                                    <EllipsisHorizontalIcon className="w-3.5 h-3.5 text-slate-500 hover:text-slate-300" />
                                                                </button>

                                                                <AnimatePresence>
                                                                    {activeFolderMenu === folder && (
                                                                        <motion.div
                                                                            initial={{ opacity: 0, scale: 0.95, x: 10 }}
                                                                            animate={{ opacity: 1, scale: 1, x: 0 }}
                                                                            exit={{ opacity: 0, scale: 0.95, x: 10 }}
                                                                            className="absolute right-0 top-full mt-1 w-32 bg-[#1e293b] border border-slate-700/50 rounded-lg shadow-xl py-1 z-[100]"
                                                                            onClick={e => e.stopPropagation()}
                                                                        >
                                                                            <button
                                                                                onClick={(e) => handleRenameFolder(e, folder)}
                                                                                className="w-full px-3 py-1.5 text-left text-[12px] text-slate-300 hover:bg-white/5 hover:text-white transition-colors"
                                                                            >
                                                                                Rename
                                                                            </button>
                                                                            <button
                                                                                onClick={(e) => handleDeleteFolder(e, folder)}
                                                                                className="w-full px-3 py-1.5 text-left text-[12px] text-red-400 hover:bg-red-400/10 transition-colors"
                                                                            >
                                                                                Delete
                                                                            </button>
                                                                        </motion.div>
                                                                    )}
                                                                </AnimatePresence>
                                                            </div>
                                                        </>
                                                    )}
                                                </div>
                                            );
                                        })}
                                    </motion.div>
                                )}
                            </AnimatePresence>
                        </div>
                    )}
                    </nav>
                ) /* end normal nav */ }

                {/* ── Bottom ── */}
                <div className={`flex-shrink-0 pb-4 ${collapsed ? 'px-0 space-y-3' : 'px-2 space-y-1'}`} style={{ borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: '12px' }}>
                    
                    {/* Expand/Collapse Toggle */}
                    <button
                        onClick={() => setCollapsed(!collapsed)}
                        className={`flex items-center gap-2.5 transition-all duration-150 outline-none text-[#9ca3af] hover:text-white group ${
                            collapsed ? 'justify-center w-8 h-8 rounded-lg mx-auto hover:bg-white/5' : 'w-full rounded-md px-2.5 py-2 hover:bg-white/5'
                        }`}
                        title={collapsed ? "Expand Sidebar" : "Collapse"}
                    >
                        {collapsed ? (
                            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0 transition-colors text-slate-400 group-hover:text-slate-200">
                                <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
                                <line x1="9" y1="3" x2="9" y2="21"/>
                                <path d="M13 9l3 3-3 3"/>
                            </svg>
                        ) : (
                            <>
                                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0 transition-colors">
                                    <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
                                    <line x1="9" y1="3" x2="9" y2="21"/>
                                    <path d="M15 15l-3-3 3-3"/>
                                </svg>
                                <span className="text-[13.5px] font-medium tracking-wide">Collapse</span>
                            </>
                        )}
                    </button>

                    {/* User card + account switcher */}
                    {user && <SidebarAccountSwitcher collapsed={collapsed} />}
                </div>
            </div>
        </motion.aside>

        {/* Mobile sidebar drawer */}
        <AnimatePresence>
            {mobileOpen && (
                <motion.aside
                    initial={{ x: '-100%' }}
                    animate={{ x: 0 }}
                    exit={{ x: '-100%' }}
                    transition={{ type: 'spring', stiffness: 300, damping: 35 }}
                    className="fixed top-0 left-0 w-72 flex flex-col z-50 md:hidden overflow-hidden border-r border-slate-700/30"
                    style={{ background: '#1e293b', height: '100dvh' }}
                >
                    <div className="relative flex flex-col h-full">
                        {/* Mobile top bar */}
                        <div className="flex items-center justify-between h-16 px-4 flex-shrink-0" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                            <img src="/TBS-Logo.webp" alt="TBS Logo" className="h-10 w-auto object-contain" />
                            <button
                                onClick={onMobileClose}
                                className="flex items-center justify-center w-8 h-8 rounded-lg bg-white/5 hover:bg-white/10 text-slate-400 hover:text-white transition-all"
                            >
                                <XMarkIcon className="w-5 h-5" />
                            </button>
                        </div>

                        {/* Nav groups */}
                        <nav className="flex-1 py-4 px-2 overflow-y-auto space-y-6" style={{ scrollbarWidth: 'none' }}>
                            {NAV_GROUPS.map(({ section, items }) => (
                                <div key={section} className="space-y-1.5">
                                    <p className="px-3 mb-1.5 text-[11px] font-bold tracking-[0.14em] uppercase" style={{ color: '#6b7280' }}>
                                        {section}
                                    </p>
                                    <div className="space-y-0.5">
                                        {items.map(({ label, path, icon: Icon }) => {
                                            const active = isActive(path);
                                            return (
                                                <Link
                                                    key={path}
                                                    to={path}
                                                    onClick={onMobileClose}
                                                    className="relative flex items-center gap-3.5 rounded-lg px-3 py-2.5 transition-all duration-150 outline-none"
                                                    style={{
                                                        color: active ? '#10b981' : '#9ca3af',
                                                        background: active ? 'rgba(16, 185, 129, 0.08)' : 'transparent',
                                                    }}
                                                >
                                                    <Icon style={{ width: 20, height: 20 }} className="flex-shrink-0" />
                                                    <span className={`text-[15px] whitespace-nowrap ${active ? 'font-bold' : 'font-medium'}`}>{label}</span>
                                                </Link>
                                            );
                                        })}
                                    </div>
                                </div>
                            ))}

                            {folders.length > 0 && (
                                <div className="space-y-1 pt-2">
                                    <p className="px-3 text-[11px] font-bold tracking-[0.14em] uppercase mb-2" style={{ color: '#6b7280' }}>Folders</p>
                                    {folders.map((folder) => {
                                        const folderPath = `/documents?folder=${encodeURIComponent(folder)}`;
                                        const active = isActive(folderPath);
                                        return (
                                            <Link
                                                key={folder}
                                                to={folderPath}
                                                onClick={onMobileClose}
                                                className="flex items-center gap-3 px-3 py-2 rounded-lg transition-all"
                                                style={{ color: active ? '#10b981' : '#94a3b8', background: active ? 'rgba(16, 185, 129, 0.08)' : 'transparent' }}
                                            >
                                                <FolderIconSolid style={{ width: 18, height: 18 }} className="flex-shrink-0" />
                                                <span className="text-[13px] truncate font-medium">{folder}</span>
                                            </Link>
                                        );
                                    })}
                                </div>
                            )}
                        </nav>

                        {/* Bottom user card + account switcher */}
                        {user && (
                            <div
                                className="flex-shrink-0 px-2 pt-3"
                                style={{
                                    borderTop: '1px solid rgba(255,255,255,0.06)',
                                    paddingBottom: 'max(20px, env(safe-area-inset-bottom, 20px))',
                                }}
                            >
                                <SidebarAccountSwitcher collapsed={false} />
                            </div>
                        )}
                    </div>
                </motion.aside>
            )}
        </AnimatePresence>

        <ConfirmDialog
            isOpen={!!deleteFolderTarget}
            onClose={() => setDeleteFolderTarget(null)}
            onConfirm={confirmDeleteFolder}
            title="Delete folder"
            message={`Are you sure you want to delete "${deleteFolderTarget}"? Documents inside will be kept but removed from this folder.`}
            confirmText="Delete"
            cancelText="Cancel"
        />
        </>
    );
};

export default Sidebar;

import { useState, useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { motion, AnimatePresence } from 'framer-motion';
import {
    ClockIcon,
    ArrowRightEndOnRectangleIcon,
    ChevronLeftIcon,
    RocketLaunchIcon,
    Squares2X2Icon,
    ChartBarIcon,
} from '@heroicons/react/24/outline';

const NAV_GROUPS = [
    {
        section: 'Overview',
        items: [
            { label: 'Dashboard',    path: '/dashboard',    icon: Squares2X2Icon },
        ],
    },
    {
        section: 'Analyze',
        items: [
            { label: 'New Analysis', path: '/new-analysis', icon: RocketLaunchIcon },
            { label: 'History',      path: '/history',      icon: ClockIcon },
            { label: 'SEO Analytics', path: '/seo-analytics', icon: ChartBarIcon },
        ],
    },
];

const Sidebar = () => {
    const [collapsed, setCollapsed] = useState(() => {
        const saved = localStorage.getItem('sidebar_collapsed');
        return saved === 'true';
    });

    useEffect(() => {
        localStorage.setItem('sidebar_collapsed', collapsed);
    }, [collapsed]);

    const { user, logout } = useAuth();
    const location = useLocation();
    const isActive = (path) => location.pathname === path;

    return (
        <motion.aside
            animate={{ width: collapsed ? 88 : 260 }}
            transition={{ type: 'spring', stiffness: 300, damping: 35 }}
            className="relative flex flex-col h-screen sticky top-0 flex-shrink-0 z-40 overflow-hidden"
            style={{ background: '#1a1d2e' }}
        >
            <div className="relative flex flex-col h-full">

                {/* ── Top bar: logo ── */}
                <div className={`flex items-center h-[96px] flex-shrink-0 ${ collapsed ? 'justify-center px-0' : 'px-5' }`} style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                    {collapsed ? (
                        <img
                            src="/TBS-Logo.webp"
                            alt="TBS Logo"
                            className="w-12 h-12 object-contain cursor-pointer transition-transform hover:scale-105"
                            onClick={() => setCollapsed(false)}
                            title="Expand Sidebar"
                        />
                    ) : (
                        <div className="flex items-center justify-between w-full">
                            <img
                                src="/TBS-Logo.webp"
                                alt="TBS Logo"
                                className="h-16 w-auto object-contain flex-shrink-0"
                            />
                            <button
                                onClick={() => setCollapsed(true)}
                                className="flex items-center justify-center w-8 h-8 rounded-lg bg-white/5 hover:bg-white/10 text-[#6b7280] hover:text-white transition-all outline-none"
                                title="Collapse Sidebar"
                            >
                                <ChevronLeftIcon className="w-4 h-4 stroke-[2.5px]" />
                            </button>
                        </div>
                    )}
                </div>

                {/* ── Nav groups ── */}
                <nav className={`flex-1 py-2 overflow-y-auto overflow-x-hidden space-y-2 ${ collapsed ? 'px-0' : 'px-2' }`} style={{ scrollbarWidth: 'none' }}>
                    {NAV_GROUPS.map(({ section, items }) => (
                        <div key={section}>
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
                            <div className="space-y-0.5">
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
                                                color: active ? '#fff' : '#9ca3af',
                                                background: (!collapsed && active) ? 'rgba(255,255,255,0.10)' : 'transparent',
                                            }}
                                            onMouseEnter={e => {
                                                if (!active) e.currentTarget.style.background = collapsed ? 'transparent' : 'rgba(255,255,255,0.06)';
                                                if (!active) e.currentTarget.style.color = '#d1d5db';
                                            }}
                                            onMouseLeave={e => {
                                                if (!active) e.currentTarget.style.background = 'transparent';
                                                if (!active) e.currentTarget.style.color = '#777';
                                            }}
                                        >

                                            {collapsed ? (
                                                /* Collapsed: icon inside a centred rounded container */
                                                <div
                                                    className="w-10 h-10 rounded-xl flex items-center justify-center transition-all duration-150"
                                                    style={{
                                                        background: active
                                                            ? 'rgba(255,255,255,0.1)'
                                                            : 'transparent',
                                                    }}
                                                    onMouseEnter={e => {
                                                        if (!active) e.currentTarget.style.background = 'rgba(255,255,255,0.07)';
                                                    }}
                                                    onMouseLeave={e => {
                                                        if (!active) e.currentTarget.style.background = 'transparent';
                                                    }}
                                                >
                                                    <Icon className="flex-shrink-0" style={{ width: 20, height: 20 }} />
                                                </div>
                                            ) : (
                                                /* Expanded: icon inline with label */
                                                <>
                                                    <Icon
                                                        className="flex-shrink-0 transition-colors"
                                                        style={{ width: 20, height: 20 }}
                                                    />
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
                </nav>

                {/* ── Bottom ── */}
                <div className="flex-shrink-0 px-2 pb-4 space-y-1" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>


                    {/* User card + Logout */}
                    {user && (
                        <div className={`flex items-center gap-2.5 py-2.5 rounded-sm ${ collapsed ? 'justify-center px-0' : 'px-2' }`}>

                            {/* Avatar — in collapsed mode shows logout overlay on hover */}
                            <div className="relative flex-shrink-0 group/avatar">
                                {user.picture ? (
                                    <img
                                        src={user.picture}
                                        alt={user.name}
                                        className="w-9 h-9 rounded-full object-cover"
                                         style={{ border: '1.5px solid rgba(255,255,255,0.2)' }}
                                    />
                                ) : (
                                    <div
                                        className="w-9 h-9 rounded-full flex items-center justify-center text-xs font-black text-white"
                                        style={{ background: 'linear-gradient(135deg, #6366f1, #a855f7)' }}
                                    >
                                        {user.name?.[0] ?? 'U'}
                                    </div>
                                )}

                                {/* Logout overlay — only in collapsed mode */}
                                {collapsed && (
                                    <button
                                        onClick={logout}
                                        title="Logout"
                                        className="absolute inset-0 rounded-full flex items-center justify-center opacity-0 group-hover/avatar:opacity-100 transition-opacity duration-200 outline-none"
                                        style={{ background: 'rgba(0,0,0,0.55)' }}
                                    >
                                        <ArrowRightEndOnRectangleIcon className="text-white" style={{ width: 15, height: 15 }} />
                                    </button>
                                )}
                            </div>

                            {/* Name + email — expanded only */}
                            <AnimatePresence initial={false}>
                                {!collapsed && (
                                    <motion.div
                                        initial={{ opacity: 0, x: -6 }}
                                        animate={{ opacity: 1, x: 0 }}
                                        exit={{ opacity: 0, x: -6 }}
                                        transition={{ duration: 0.15 }}
                                        className="flex-1 min-w-0 overflow-hidden"
                                    >
                                        <p className="text-xs font-bold text-white truncate leading-tight">{user.name}</p>
                                        <p className="text-[10px] font-medium truncate leading-tight" style={{ color: '#6b7280' }}>
                                            {user.email}
                                        </p>
                                    </motion.div>
                                )}
                            </AnimatePresence>

                            {/* Logout button — expanded only */}
                            <AnimatePresence initial={false}>
                                {!collapsed && (
                                    <motion.button
                                        initial={{ opacity: 0 }}
                                        animate={{ opacity: 1 }}
                                        exit={{ opacity: 0 }}
                                        onClick={logout}
                                        title="Logout"
                                        className="flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center outline-none transition-all duration-150 group/btn"
                                        style={{ background: '#252840' }}
                                        onMouseEnter={e => e.currentTarget.style.background = '#3d1f1f'}
                                        onMouseLeave={e => e.currentTarget.style.background = '#252840'}
                                    >
                                        <ArrowRightEndOnRectangleIcon
                                            className="text-[#888] group-hover/btn:text-red-400 transition-colors"
                                            style={{ width: 15, height: 15 }}
                                        />
                                    </motion.button>
                                )}
                            </AnimatePresence>
                        </div>
                    )}
                </div>
            </div>
        </motion.aside>
    );
};

export default Sidebar;

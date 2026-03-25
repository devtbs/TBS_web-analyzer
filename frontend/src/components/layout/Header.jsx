import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { ChartBarIcon } from '@heroicons/react/24/solid';
import { motion } from 'framer-motion';
import GoogleAuth from '../auth/GoogleAuth';

const NAV_LINKS = [
    { label: 'Dashboard', path: '/dashboard' },
    { label: 'History',   path: '/history'   },
];

const Header = () => {
    const { user } = useAuth();
    const location = useLocation();
    const isActive = (path) => location.pathname === path;

    return (
        <header className="w-full sticky top-0 z-50">
            {/* Frosted glass bar */}
            <div
                className="border-b border-slate-200/60 shadow-[0_1px_16px_0_rgba(139,92,246,0.07)]"
                style={{
                    background: 'rgba(255,255,255,0.82)',
                    backdropFilter: 'blur(18px)',
                    WebkitBackdropFilter: 'blur(18px)',
                }}
            >
                <div className="max-w-7xl mx-auto px-5 sm:px-8 h-[62px] flex items-center gap-6">

                    {/* ── Logo ── */}
                    <Link to="/" className="flex items-center gap-2.5 group flex-shrink-0">
                        <div className="w-9 h-9 bg-gradient-to-br from-violet-600 to-purple-600 rounded-xl flex items-center justify-center shadow-md shadow-violet-300/40 group-hover:shadow-lg group-hover:shadow-violet-400/40 transition-shadow">
                            <ChartBarIcon className="w-5 h-5 text-white" />
                        </div>
                        <span className="text-lg font-black text-slate-800 tracking-tight leading-none">
                            Web<span className="text-violet-600">Analyzer</span>
                        </span>
                    </Link>

                    {/* ── Vertical divider ── */}
                    {user && <div className="h-5 w-px bg-slate-200 flex-shrink-0" />}

                    {/* ── Nav ── */}
                    {user && (
                        <nav className="flex items-center gap-1">
                            {NAV_LINKS.map(({ label, path }) => (
                                <Link
                                    key={path}
                                    to={path}
                                    className={`relative px-4 py-1.5 rounded-lg text-sm font-semibold transition-colors duration-200 ${
                                        isActive(path)
                                            ? 'text-violet-700'
                                            : 'text-slate-500 hover:text-slate-800 hover:bg-slate-100/80'
                                    }`}
                                >
                                    {label}
                                    {isActive(path) && (
                                        <motion.div
                                            layoutId="nav-pill"
                                            className="absolute inset-0 rounded-lg bg-violet-50 -z-10"
                                            transition={{ type: 'spring', bounce: 0.25, duration: 0.45 }}
                                        />
                                    )}
                                    {isActive(path) && (
                                        <motion.div
                                            layoutId="nav-underline"
                                            className="absolute bottom-0 left-3 right-3 h-[2px] rounded-full bg-gradient-to-r from-violet-500 to-fuchsia-500"
                                            transition={{ type: 'spring', bounce: 0.25, duration: 0.45 }}
                                        />
                                    )}
                                </Link>
                            ))}
                        </nav>
                    )}

                    {/* ── Spacer ── */}
                    <div className="flex-1" />

                    {/* ── Right: auth ── */}
                    <GoogleAuth />
                </div>
            </div>
        </header>
    );
};

export default Header;

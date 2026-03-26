import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { ChartBarIcon, SparklesIcon } from '@heroicons/react/24/solid';
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
            {/* Absolute background for glass blur and gradient borders */}
            <div className="absolute inset-0 bg-white/60 backdrop-blur-2xl border-b border-white/40 shadow-[0_8px_32px_rgba(0,0,0,0.03)] pointer-events-none" />
            
            {/* Subtle glowing bottom line */}
            <div className="absolute bottom-0 left-0 right-0 h-[1px] bg-gradient-to-r from-transparent via-violet-300/60 to-transparent opacity-70" />

            <div className="max-w-7xl mx-auto px-5 sm:px-8 h-[72px] flex items-center justify-between relative z-10">

                {/* ── Left Section: Logo & Nav ── */}
                <div className="flex items-center gap-6 sm:gap-8">
                    
                    {/* Logo */}
                    <Link to="/" className="flex items-center gap-3 group flex-shrink-0 outline-none">
                        <div className="relative w-10 h-10 rounded-2xl bg-gradient-to-br from-violet-500 via-purple-500 to-fuchsia-500 p-[1.5px] shadow-lg shadow-purple-500/20 group-hover:shadow-purple-500/40 transition-all duration-300 group-hover:-translate-y-0.5">
                            <div className="absolute inset-0 bg-gradient-to-br from-white/30 to-transparent rounded-2xl opacity-0 group-hover:opacity-100 transition-opacity" />
                            <div className="w-full h-full bg-slate-900 rounded-[14px] flex items-center justify-center overflow-hidden">
                                <motion.div
                                    whileHover={{ rotate: 180, scale: 1.15 }}
                                    transition={{ type: "spring", stiffness: 200, damping: 10 }}
                                    className="relative flex items-center justify-center"
                                >
                                    <SparklesIcon className="w-5 h-5 text-violet-300 drop-shadow-[0_0_8px_rgba(192,132,252,0.8)]" />
                                </motion.div>
                            </div>
                        </div>
                        <div className="flex flex-col">
                            <span className="text-xl font-black text-slate-800 tracking-tight leading-none group-hover:text-violet-700 transition-colors">
                                Web<span className="text-transparent bg-clip-text bg-gradient-to-br from-violet-600 to-fuchsia-600">Analyzer</span>
                            </span>
                            <span className="text-[10px] font-bold tracking-widest text-slate-400 uppercase leading-none mt-1">
                                Intelligence
                            </span>
                        </div>
                    </Link>

                    {/* Vertical Divider */}
                    {user && <div className="hidden md:block h-8 w-px bg-gradient-to-b from-transparent via-slate-200 to-transparent flex-shrink-0" />}

                    {/* Nav Links */}
                    {user && (
                        <nav className="hidden md:flex items-center gap-1.5">
                            {NAV_LINKS.map(({ label, path }) => {
                                const active = isActive(path);
                                return (
                                    <Link
                                        key={path}
                                        to={path}
                                        className={`relative px-4 py-2 rounded-xl text-sm font-bold transition-all duration-300 outline-none ${
                                            active
                                                ? 'text-violet-800'
                                                : 'text-slate-500 hover:text-slate-800'
                                        }`}
                                    >
                                        <span className="relative z-10">{label}</span>
                                        {active && (
                                            <motion.div
                                                layoutId="header-active-pill"
                                                className="absolute inset-0 rounded-xl bg-violet-100/80 border border-violet-200/50 shadow-sm shadow-violet-200/50"
                                                transition={{ type: 'spring', bounce: 0.25, duration: 0.5 }}
                                            />
                                        )}
                                        {!active && (
                                            <div className="absolute inset-0 rounded-xl bg-slate-100/0 hover:bg-slate-100/80 transition-colors duration-300 -z-10" />
                                        )}
                                    </Link>
                                );
                            })}
                        </nav>
                    )}
                </div>

                {/* ── Right Section: Status & Auth ── */}
                <div className="flex items-center gap-4">
                    <GoogleAuth />
                </div>

            </div>
        </header>
    );
};

export default Header;

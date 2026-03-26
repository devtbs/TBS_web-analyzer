import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { SparklesIcon } from '@heroicons/react/24/solid';
import GoogleAuth from '../auth/GoogleAuth';

const Header = () => {
    return (
        <header className="w-full sticky top-0 z-50">
            {/* Frosted glass background */}
            <div className="absolute inset-0 bg-white/70 backdrop-blur-2xl border-b border-white/50 shadow-[0_4px_24px_rgba(0,0,0,0.04)] pointer-events-none" />
            {/* Bottom glow line */}
            <div className="absolute bottom-0 left-0 right-0 h-[1px] bg-gradient-to-r from-transparent via-violet-300/50 to-transparent" />

            <div className="max-w-7xl mx-auto px-5 sm:px-8 h-[68px] flex items-center justify-between relative z-10">
                {/* Logo */}
                <Link to="/" className="flex items-center gap-3 group outline-none">
                    <div className="relative w-10 h-10 rounded-2xl bg-gradient-to-br from-violet-500 via-purple-500 to-fuchsia-500 p-[1.5px] shadow-lg shadow-purple-500/20 group-hover:shadow-purple-500/40 transition-all duration-300 group-hover:-translate-y-0.5">
                        <div className="w-full h-full bg-slate-900 rounded-[14px] flex items-center justify-center">
                            <motion.div
                                whileHover={{ rotate: 180, scale: 1.15 }}
                                transition={{ type: 'spring', stiffness: 200, damping: 10 }}
                            >
                                <SparklesIcon className="text-violet-300 drop-shadow-[0_0_8px_rgba(192,132,252,0.8)]" style={{ width: 18, height: 18 }} />
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

                {/* Auth */}
                <GoogleAuth />
            </div>
        </header>
    );
};

export default Header;

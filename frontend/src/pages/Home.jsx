import { motion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useEffect } from 'react';
import GoogleAuth from '../components/auth/GoogleAuth';
import { ChartBarIcon } from '@heroicons/react/24/outline';

const Home = () => {
    const { user, loading, devLogin } = useAuth();
    const navigate = useNavigate();

    useEffect(() => {
        if (!loading && user) {
            navigate('/seo-analytics', { replace: true });
        }
    }, [user, loading, navigate]);

    return (
        <div className="flex-1 flex items-center justify-center bg-[#f5f6f8] relative overflow-hidden p-6">
            {/* Subtle background grid pattern */}
            <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjAiIGhlaWdodD0iMjAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PGNpcmNsZSBjeD0iMSIgY3k9IjEiIHI9IjEiIGZpbGw9InJnYmEoMCwwLDAsMC4wMikiLz48L3N2Zz4=')] [mask-image:linear-gradient(to_bottom,white,transparent)]" />
            
            {/* Ambient glows */}
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-emerald-500/5 rounded-full blur-[100px] pointer-events-none" />

            <motion.div 
                initial={{ opacity: 0, y: 15, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
                className="w-full max-w-[420px] bg-white border border-slate-200/80 rounded-[32px] shadow-[0_8px_40px_-12px_rgba(0,0,0,0.1)] p-10 text-center flex flex-col items-center relative z-10"
            >
                {/* Badge */}
                <div className="mb-6 inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-50 border border-emerald-100">
                    <span className="relative flex h-2 w-2">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                    </span>
                    <span className="text-[10px] font-black text-emerald-600 uppercase tracking-widest leading-none mt-0.5">
                        TBS Marketing
                    </span>
                </div>

                {/* Icon */}
                <div className="w-20 h-20 bg-gradient-to-br from-emerald-400 to-emerald-600 rounded-2xl flex items-center justify-center mb-6 shadow-xl shadow-emerald-500/30 transform rotate-3">
                    <div className="w-full h-full bg-white/20 rounded-2xl flex items-center justify-center backdrop-blur-sm -rotate-3 transition-transform hover:rotate-0 duration-300">
                        <ChartBarIcon className="w-10 h-10 text-white" />
                    </div>
                </div>
                
                <h1 className="text-[28px] font-black text-slate-900 mb-3 tracking-tight">
                    SEO Analytics
                </h1>
                
                <p className="text-[14px] font-medium text-slate-500 mb-8 leading-relaxed px-2">
                    Sign in with your Google account to securely connect your Search Console and unlock actionable insights.
                </p>

                <div className="w-full flex justify-center pb-2">
                    <GoogleAuth />
                </div>

                {import.meta.env.DEV && (
                    <button
                        onClick={async () => {
                            try { await devLogin(); navigate('/presentation', { replace: true }); }
                            catch { /* dev-login only works when backend ENVIRONMENT=development */ }
                        }}
                        className="mt-4 text-xs font-semibold text-slate-400 hover:text-[#26397A] transition-colors"
                    >
                        Dev login (localhost only)
                    </button>
                )}
            </motion.div>
        </div>
    );
};

export default Home;

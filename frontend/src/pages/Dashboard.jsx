import { useAuth } from '../context/AuthContext';
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import api from '../api/axios';
import {
    RocketLaunchIcon,
    ClockIcon,
    GlobeAltIcon,
    Squares2X2Icon,
    ArrowRightIcon,
    ArrowUpRightIcon,
    CheckCircleIcon,
    ExclamationTriangleIcon,
    ChartBarIcon,
    DocumentTextIcon,
    SparklesIcon,
} from '@heroicons/react/24/outline';
import { motion } from 'framer-motion';
import toast from 'react-hot-toast';
import ConfirmDialog from '../components/ui/ConfirmDialog';

/* ── Recent row ── */
const RecentRow = ({ analysis, onClick }) => {
    const domain = analysis.urls?.[0] ?? 'Unknown';
    const extra  = (analysis.urls?.length ?? 1) - 1;
    const statusMap = {
        completed: { color: 'text-emerald-600', bg: 'bg-emerald-50', dot: 'bg-emerald-500', ring: 'ring-emerald-500/20' },
        failed:    { color: 'text-rose-600',    bg: 'bg-rose-50',    dot: 'bg-rose-500',    ring: 'ring-rose-500/20'    },
        processing:{ color: 'text-blue-600',    bg: 'bg-blue-50',    dot: 'bg-blue-500',    ring: 'ring-blue-500/20'    },
        scraping:  { color: 'text-indigo-600',  bg: 'bg-indigo-50',  dot: 'bg-indigo-500',  ring: 'ring-indigo-500/20'  },
        fetching:  { color: 'text-violet-600',  bg: 'bg-violet-50',  dot: 'bg-violet-500',  ring: 'ring-violet-500/20'  },
        default:   { color: 'text-slate-600',   bg: 'bg-slate-50',   dot: 'bg-slate-500',   ring: 'ring-slate-500/20'   },
    };
    const s = statusMap[analysis.status] ?? statusMap.default;

    return (
        <button
            onClick={onClick}
            className="w-full flex items-center gap-4 px-5 py-4 rounded-[20px] hover:bg-white hover:shadow-xl hover:shadow-slate-200/50 border border-transparent hover:border-slate-100 transition-all duration-300 text-left group mb-1"
        >
            {/* Website Icon */}
            <div className="w-11 h-11 rounded-2xl bg-slate-50 border border-slate-100 flex items-center justify-center flex-shrink-0 group-hover:bg-emerald-50 group-hover:border-emerald-100 transition-all duration-300">
                <GlobeAltIcon className="w-5 h-5 text-slate-400 group-hover:text-emerald-500 group-hover:scale-110 transition-all duration-300" />
            </div>

            {/* Info */}
            <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                    <p className="text-[14px] font-bold text-slate-800 truncate leading-tight group-hover:text-emerald-600 transition-colors">{domain}</p>
                    {extra > 0 && (
                        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-md bg-slate-100 text-slate-500">
                            +{extra}
                        </span>
                    )}
                </div>
                <p className="text-[11px] text-slate-400 mt-1 font-medium flex items-center gap-1.5 uppercase tracking-wider">
                    <span className="w-1 h-1 rounded-full bg-slate-300" />
                    {analysis.label || 'auto analysis'}
                </p>
            </div>

            {/* Action/Status */}
            <div className="flex items-center gap-4">
                <div className={`hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-full ${s.bg} ring-1 ${s.ring} shadow-sm`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${s.dot} shadow-[0_0_8px_rgba(0,0,0,0.1)] ${analysis.status !== 'completed' && analysis.status !== 'failed' ? 'animate-pulse' : ''}`} />
                    <span className={`text-[10px] font-black uppercase tracking-wider ${s.color}`}>
                        {analysis.status}
                    </span>
                </div>
                <div className="w-8 h-8 rounded-full flex items-center justify-center border border-slate-100 group-hover:border-emerald-200 group-hover:bg-emerald-50 transition-all duration-300">
                    <ArrowRightIcon className="w-3.5 h-3.5 text-slate-300 group-hover:text-emerald-500 transition-colors" />
                </div>
            </div>
        </button>
    );
};

export default function Dashboard() {
    const { user }   = useAuth();
    const navigate   = useNavigate();
    const [analyses, setAnalyses]           = useState([]);
    const [allAnalyses, setAllAnalyses]     = useState([]);
    const [loading, setLoading]             = useState(true);
    const [deleteDialog, setDeleteDialog]   = useState({ isOpen: false, analysisId: null });
    const [isVisible, setIsVisible]         = useState(false);

    const handleDelete = async (id) => {
        try {
            await api.delete(`/api/analysis/${id}`);
            toast.success('Analysis deleted');
            setAnalyses(p => p.filter(a => a.analysis_id !== id));
            setAllAnalyses(p => p.filter(a => a.analysis_id !== id));
        } catch { toast.error('Failed to delete analysis'); }
    };

    useEffect(() => {
        (async () => {
            try {
                const { data } = await api.get('/api/history');
                const list = data.analyses || [];
                setAllAnalyses(list);
                setAnalyses(list.slice(0, 6));
            } catch { /* silently fail */ }
            finally { 
                setLoading(false); 
                setTimeout(() => setIsVisible(true), 50);
            }
        })();
    }, []);

    const total      = allAnalyses.length;
    const completed  = allAnalyses.filter(a => a.status === 'completed').length;
    const failed     = allAnalyses.filter(a => a.status === 'failed').length;
    const urlsTotal  = allAnalyses.reduce((s, a) => s + (a.urls?.length ?? 0), 0);
    const successPct = total > 0 ? Math.round((completed / total) * 100) : 0;

    const hour      = new Date().getHours();
    const greeting  = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
    const firstName = user?.name?.split(' ')[0] ?? 'there';

    const stats = [
        {
            label: 'Total Analyses', sub: 'all time', value: total,
            icon: Squares2X2Icon,
            glow: 'bg-indigo-50 border-indigo-100 text-indigo-600 shadow-indigo-200/50',
        },
        {
            label: 'Completed', sub: `${successPct}% success rate`, value: completed,
            icon: CheckCircleIcon,
            glow: 'bg-emerald-50 border-emerald-100 text-emerald-600 shadow-emerald-200/50',
        },
        {
            label: 'Failed', sub: 'need attention', value: failed,
            icon: ExclamationTriangleIcon,
            glow: 'bg-rose-50 border-rose-100 text-rose-600 shadow-rose-200/50',
        },
    ];

    const quickActions = [
        { icon: RocketLaunchIcon, label: 'New Analysis',  desc: 'Start a fresh audit',       path: '/new-analysis' },
        { icon: DocumentTextIcon, label: 'My Documents',  desc: 'View generated articles',  path: '/documents'    },
        { icon: ChartBarIcon,      label: 'SEO Analytics', desc: 'Search Console insights',   path: '/seo-analytics'},
        { icon: ClockIcon,        label: 'History',       desc: 'All past analyses',          path: '/history'      },
    ];

    return (
        <div className="flex-1 w-full min-h-screen bg-[#f8fafc] p-3 sm:p-4 lg:p-6">
            <div className={`max-w-7xl mx-auto space-y-4 transition-all duration-700 ${isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'}`}>

                {/* ── Hero card ── */}
                <motion.div
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="relative overflow-hidden bg-white/70 backdrop-blur-sm rounded-[32px] border border-white shadow-[0_8px_30px_rgb(0,0,0,0.04)] px-6 py-6"
                    style={{
                        backgroundImage: 'radial-gradient(circle at 100% 0%, #ecfdf5 0%, transparent 50%)',
                    }}
                >
                    {/* Decorative ring */}
                    <div className="pointer-events-none absolute -right-16 -top-16 w-64 h-64 rounded-full border-[40px] border-emerald-50 opacity-70" />

                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-6 relative">
                        <div>
                            <div className="flex items-center gap-2 mb-3">
                                <span className="relative flex h-2 w-2">
                                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                                    <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                                </span>
                                <span className="text-[10px] font-black uppercase tracking-[0.15em] text-slate-400">
                                    Platform Active
                                </span>
                            </div>

                            <h1 className="text-2xl sm:text-3xl font-black tracking-tight text-slate-900">
                                {greeting},{' '}
                                <span className="text-emerald-500">{firstName}</span> 
                            </h1>
                            <p className="text-slate-500 text-xs mt-1 leading-relaxed">
                                You have{' '}
                                <span className="font-bold text-slate-800">{loading ? '—' : `${total} analyses`}</span>
                                {' '}and{' '}
                                <span className="font-bold text-slate-800">{loading ? '—' : `${urlsTotal} URLs`}</span>
                                {' '}tracked across your workspace.
                            </p>
                        </div>

                        <div className="flex items-center gap-2 flex-shrink-0">
                            <button
                                onClick={() => navigate('/new-analysis')}
                                className="flex items-center gap-2 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs transition-all shadow-md shadow-emerald-600/20 hover:shadow-lg hover:-translate-y-0.5"
                            >
                                <RocketLaunchIcon className="w-3.5 h-3.5" />
                                New Analysis
                            </button>
                            <button
                                onClick={() => navigate('/history')}
                                className="flex items-center gap-2 px-4 py-2 rounded-xl border border-slate-200 bg-white/80 text-slate-700 font-bold text-xs hover:bg-slate-50 transition-all"
                            >
                                <ArrowUpRightIcon className="w-3.5 h-3.5" />
                                View History
                            </button>
                        </div>
                    </div>
                </motion.div>

                {/* ── Stat cards ── */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4">
                    {stats.map(({ label, sub, value, icon: Icon, glow }, i) => (
                        <motion.div
                            key={label}
                            initial={{ opacity: 0, y: 15 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: 0.1 + i * 0.08 }}
                            className="group relative bg-white rounded-[28px] border border-slate-200/60 p-6 shadow-sm hover:shadow-xl hover:shadow-slate-200/30 transition-all duration-500"
                        >
                            <div className="flex justify-between items-start mb-6">
                                <div className={`w-10 h-10 rounded-xl border ${glow.split(' ')[1]} ${glow.split(' ')[0]} flex items-center justify-center shadow-lg ${glow.split(' ')[3]} group-hover:scale-110 group-hover:rotate-3 transition-all duration-500`}>
                                    <Icon className={`w-5 h-5 ${glow.split(' ')[2]}`} />
                                </div>
                                <ArrowUpRightIcon className="w-4 h-4 text-slate-300 group-hover:text-emerald-500 transition-colors" />
                            </div>

                            <div className="space-y-1">
                                <h3 className="text-3xl font-black text-slate-900 tracking-tight">
                                    {value ?? '0'}
                                </h3>
                                <p className="text-sm font-bold text-slate-800 tracking-tight">
                                    {label}
                                </p>
                                <p className="text-[11px] font-medium text-slate-400">
                                    {sub}
                                </p>
                            </div>
                        </motion.div>
                    ))}
                </div>

                {/* ── Bottom grid ── */}
                <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-4">

                    {/* Recent Analyses */}
                    <motion.div
                        initial={{ opacity: 0, y: 15 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.2 }}
                        className="bg-white rounded-3xl border border-slate-200/70 shadow-sm overflow-hidden"
                    >
                        {/* Header */}
                        <div className="flex items-center justify-between px-4 sm:px-8 py-4 sm:py-6 border-b border-slate-50">
                            <div>
                                <h2 className="text-[15px] font-black text-slate-900 tracking-tight">Recent Analyses</h2>
                                <p className="text-[12px] text-slate-400 font-medium mt-0.5">Track your project growth</p>
                            </div>
                            <Link
                                to="/history"
                                className="text-[12px] font-bold text-emerald-600 hover:text-emerald-700 flex items-center gap-1.5 transition-all bg-emerald-50 hover:bg-emerald-100 px-4 py-2 rounded-xl"
                            >
                                View all History <ArrowRightIcon className="w-4 h-4" />
                            </Link>
                        </div>

                        {/* Scrolling Container */}
                        <div className="p-3">
                            {loading ? (
                                <div className="space-y-3 p-3">
                                    {[1,2,3,4].map(i => (
                                        <div key={i} className="h-16 bg-slate-50/50 rounded-[20px] animate-pulse" />
                                    ))}
                                </div>
                            ) : analyses.length === 0 ? (
                                <div className="py-20 text-center">
                                    <div className="w-16 h-16 bg-slate-50 rounded-[24px] border border-slate-100 flex items-center justify-center mx-auto mb-4">
                                        <GlobeAltIcon className="w-8 h-8 text-slate-300" />
                                    </div>
                                    <p className="text-base font-bold text-slate-800">No project activity yet</p>
                                    <p className="text-sm text-slate-400 mt-1 mb-6 max-w-[240px] mx-auto leading-relaxed">
                                        Launch your first SEO audit to start tracking performance.
                                    </p>
                                    <button
                                        onClick={() => navigate('/new-analysis')}
                                        className="px-6 py-2.5 bg-emerald-600 text-white font-bold text-sm rounded-xl hover:bg-emerald-700 transition-all shadow-lg shadow-emerald-600/20"
                                    >
                                        Start First Analysis
                                    </button>
                                </div>
                            ) : (
                                <div className="space-y-1">
                                    {analyses.map(a => (
                                        <RecentRow
                                            key={a.analysis_id}
                                            analysis={a}
                                            onClick={() => navigate(`/results/${a.analysis_id}`)}
                                        />
                                    ))}
                                </div>
                            )}
                        </div>
                    </motion.div>

                    {/* Right panel */}
                    <div className="space-y-5">

                        {/* Quick Actions */}
                        <motion.div
                            initial={{ opacity: 0, y: 15 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: 0.25 }}
                            className="bg-white rounded-3xl border border-slate-200/70 shadow-sm overflow-hidden"
                        >
                            <div className="px-6 py-4 border-b border-slate-50">
                                <h2 className="text-[14px] font-black text-slate-900 tracking-tight">Quick Actions</h2>
                                <p className="text-[11px] text-slate-400 font-medium mt-0.5">Essential tools</p>
                            </div>
                            <div className="p-2 space-y-1">
                                {quickActions.map(({ icon: Icon, label, desc, path }) => (
                                    <button
                                        key={label}
                                        onClick={() => navigate(path)}
                                        className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-slate-50 active:bg-slate-100 border border-transparent hover:border-slate-100 active:border-slate-200 transition-all duration-200 text-left group touch-manipulation"
                                    >
                                        <div className="w-9 h-9 rounded-xl bg-white border border-slate-100 shadow-sm flex items-center justify-center flex-shrink-0 group-hover:bg-emerald-600 group-hover:border-emerald-600 group-active:bg-emerald-600 group-active:border-emerald-600 transition-all duration-300">
                                            <Icon className="w-[18px] h-[18px] text-slate-500 group-hover:text-white group-active:text-white transition-all duration-300" />
                                        </div>
                                        <div className="min-w-0 flex-1">
                                            <p className="text-[13px] font-bold text-slate-800 group-hover:text-emerald-700 group-active:text-emerald-700 transition-colors leading-tight">{label}</p>
                                            <p className="text-[10px] text-slate-400 font-medium mt-0.5 truncate">{desc}</p>
                                        </div>
                                        <div className="w-6 h-6 rounded-full flex items-center justify-center bg-slate-50 group-hover:bg-emerald-100 group-active:bg-emerald-100 transition-all duration-200">
                                            <ArrowRightIcon className="w-3 h-3 text-slate-300 group-hover:text-emerald-600 group-active:text-emerald-600 transition-colors" />
                                        </div>
                                    </button>
                                ))}
                            </div>
                        </motion.div>

                    </div>
                </div>

            </div>

            <ConfirmDialog
                isOpen={deleteDialog.isOpen}
                onClose={() => setDeleteDialog({ isOpen: false, analysisId: null })}
                onConfirm={() => {
                    handleDelete(deleteDialog.analysisId);
                    setDeleteDialog({ isOpen: false, analysisId: null });
                }}
                title="Delete Analysis"
                message="Are you sure you want to delete this analysis? This action cannot be undone."
                confirmText="Delete"
                cancelText="Cancel"
            />
        </div>
    );
}

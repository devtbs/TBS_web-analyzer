import { useAuth } from '../context/AuthContext';
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import api from '../api/axios';
import {
    RocketLaunchIcon,
    ClockIcon,
    GlobeAltIcon,
    ArrowRightIcon,
    ArrowUpRightIcon,
    CheckCircleIcon,
    ExclamationCircleIcon,
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
        completed: { dot: 'bg-emerald-500', pill: 'text-emerald-700 bg-emerald-50 ring-1 ring-emerald-200/60' },
        failed:    { dot: 'bg-rose-500',    pill: 'text-rose-700 bg-rose-50 ring-1 ring-rose-200/60' },
        processing:{ dot: 'bg-indigo-500',  pill: 'text-indigo-700 bg-indigo-50 ring-1 ring-indigo-200/60 animate-pulse' },
        scraping:  { dot: 'bg-blue-500',    pill: 'text-blue-700 bg-blue-50 ring-1 ring-blue-200/60 animate-pulse' },
        fetching:  { dot: 'bg-violet-500',  pill: 'text-violet-700 bg-violet-50 ring-1 ring-violet-200/60 animate-pulse' },
        default:   { dot: 'bg-amber-500',   pill: 'text-amber-700 bg-amber-50 ring-1 ring-amber-200/60' },
    };
    const s = statusMap[analysis.status] ?? statusMap.default;

    return (
        <button
            onClick={onClick}
            className="w-full flex items-center gap-4 px-4 py-3 rounded-xl hover:bg-slate-50 border border-transparent hover:border-slate-100 transition-all text-left group"
        >
            {/* Avatar */}
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-400 to-teal-500 flex items-center justify-center flex-shrink-0 shadow-sm group-hover:shadow-md group-hover:-translate-y-0.5 transition-all">
                <GlobeAltIcon className="w-5 h-5 text-white" />
            </div>

            {/* Info */}
            <div className="min-w-0 flex-1">
                <p className="text-[13px] font-semibold text-slate-800 truncate leading-tight">{domain}</p>
                <p className="text-[11px] text-slate-400 mt-0.5 truncate">
                    {extra > 0 ? `+${extra} more URL${extra > 1 ? 's' : ''} · ` : ''}{analysis.label || 'auto'}
                </p>
            </div>

            {/* Status */}
            <span className={`text-[10px] font-bold px-2.5 py-1 rounded-full flex-shrink-0 ${s.pill}`}>
                {analysis.status}
            </span>

            <ArrowRightIcon className="w-4 h-4 text-slate-200 group-hover:text-slate-400 flex-shrink-0 transition-colors" />
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
            finally { setLoading(false); }
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
            icon: ChartBarIcon,
            from: 'from-violet-500', to: 'to-purple-600',
        },
        {
            label: 'Completed', sub: `${successPct}% success rate`, value: completed,
            icon: CheckCircleIcon,
            from: 'from-emerald-400', to: 'to-teal-500',
        },
        {
            label: 'Failed', sub: 'need attention', value: failed,
            icon: ExclamationCircleIcon,
            from: 'from-rose-400', to: 'to-red-500',
        },
    ];

    const quickActions = [
        { icon: RocketLaunchIcon, label: 'New Analysis',  desc: 'Start a fresh audit',       path: '/new-analysis' },
        { icon: DocumentTextIcon, label: 'My Documents',  desc: 'View generated articles',  path: '/documents'    },
        { icon: SparklesIcon,     label: 'SEO Analytics', desc: 'Search Console insights',   path: '/seo-analytics'},
        { icon: ClockIcon,        label: 'History',       desc: 'All past analyses',          path: '/history'      },
    ];

    return (
        <div className="flex-1 w-full min-h-screen bg-[#f5f6fa] p-4 sm:p-6">
            <div className="space-y-5">

                {/* ── Hero card ── */}
                <motion.div
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="relative overflow-hidden bg-white rounded-3xl border border-slate-200/80 shadow-sm px-8 py-8"
                    style={{
                        backgroundImage: 'radial-gradient(ellipse at top right, #d1fae5 0%, transparent 60%)',
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

                            <h1 className="text-3xl sm:text-4xl font-black tracking-tight text-slate-900">
                                {greeting},{' '}
                                <span className="text-emerald-500">{firstName}</span> 
                            </h1>
                            <p className="text-slate-500 text-sm mt-2 leading-relaxed">
                                You have{' '}
                                <span className="font-bold text-slate-800">{loading ? '—' : `${total} analyses`}</span>
                                {' '}and{' '}
                                <span className="font-bold text-slate-800">{loading ? '—' : `${urlsTotal} URLs`}</span>
                                {' '}tracked across your workspace.
                            </p>
                        </div>

                        <div className="flex items-center gap-2.5 flex-shrink-0">
                            <button
                                onClick={() => navigate('/new-analysis')}
                                className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-bold text-sm transition-all shadow-md shadow-slate-900/20 hover:shadow-lg hover:-translate-y-0.5"
                            >
                                <RocketLaunchIcon className="w-4 h-4" />
                                New Analysis
                            </button>
                            <button
                                onClick={() => navigate('/history')}
                                className="flex items-center gap-2 px-5 py-2.5 rounded-xl border border-slate-200 bg-white/80 text-slate-700 font-bold text-sm hover:bg-slate-50 transition-all"
                            >
                                <ArrowUpRightIcon className="w-4 h-4" />
                                View History
                            </button>
                        </div>
                    </div>
                </motion.div>

                {/* ── Stat cards ── */}
                <div className="grid grid-cols-3 gap-4">
                    {stats.map(({ label, sub, value, icon: Icon, from, to }, i) => (
                        <motion.div
                            key={label}
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: 0.06 + i * 0.05 }}
                            className="bg-white rounded-2xl border border-slate-200/80 shadow-sm p-6 group hover:shadow-md hover:-translate-y-0.5 transition-all cursor-default"
                        >
                            <div className="flex items-start justify-between mb-6">
                                <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${from} ${to} flex items-center justify-center shadow-sm`}>
                                    <Icon className="w-5 h-5 text-white" />
                                </div>
                                <ArrowUpRightIcon className="w-4 h-4 text-slate-200 group-hover:text-slate-400 transition-colors mt-0.5" />
                            </div>

                            {loading ? (
                                <div className="h-10 w-16 bg-slate-100 rounded-xl animate-pulse mb-2" />
                            ) : (
                                <p className="text-4xl font-black text-slate-900 tracking-tight leading-none">
                                    {value ?? '—'}
                                </p>
                            )}
                            <p className="text-sm font-semibold text-slate-700 mt-2">{label}</p>
                            <p className="text-xs text-slate-400 mt-0.5">{sub}</p>
                        </motion.div>
                    ))}
                </div>

                {/* ── Bottom grid ── */}
                <div className="grid grid-cols-1 lg:grid-cols-[1fr_380px] gap-5">

                    {/* Recent Analyses */}
                    <motion.div
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.2 }}
                        className="bg-white rounded-2xl border border-slate-200/80 shadow-sm overflow-hidden"
                    >
                        {/* Header */}
                        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
                            <div>
                                <h2 className="text-[13px] font-bold text-slate-800">Recent Analyses</h2>
                                <p className="text-[11px] text-slate-400 mt-0.5">Your latest website audits</p>
                            </div>
                            <Link
                                to="/history"
                                className="text-[12px] font-bold text-emerald-600 hover:text-emerald-700 flex items-center gap-1 transition-colors bg-emerald-50 hover:bg-emerald-100 px-3 py-1.5 rounded-lg"
                            >
                                View all <ArrowRightIcon className="w-3.5 h-3.5" />
                            </Link>
                        </div>

                        {/* Rows */}
                        <div className="p-2">
                            {loading ? (
                                <div className="space-y-1 p-2">
                                    {[1,2,3,4,5].map(i => (
                                        <div key={i} className="h-14 bg-slate-50 rounded-xl animate-pulse" />
                                    ))}
                                </div>
                            ) : analyses.length === 0 ? (
                                <div className="py-16 text-center">
                                    <div className="w-12 h-12 bg-slate-50 rounded-2xl border border-slate-100 flex items-center justify-center mx-auto mb-3">
                                        <GlobeAltIcon className="w-6 h-6 text-slate-300" />
                                    </div>
                                    <p className="text-sm font-semibold text-slate-500">No analyses yet</p>
                                    <p className="text-xs text-slate-400 mt-1 mb-4">Start your first analysis to see results here</p>
                                    <button
                                        onClick={() => navigate('/new-analysis')}
                                        className="text-xs font-bold text-emerald-600 hover:text-emerald-700"
                                    >
                                        Start your first →
                                    </button>
                                </div>
                            ) : analyses.map(a => (
                                <RecentRow
                                    key={a.analysis_id}
                                    analysis={a}
                                    onClick={() => navigate(`/results/${a.analysis_id}`)}
                                />
                            ))}
                        </div>
                    </motion.div>

                    {/* Right panel */}
                    <div className="space-y-4">

                        {/* Quick Actions */}
                        <motion.div
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: 0.25 }}
                            className="bg-white rounded-2xl border border-slate-200/80 shadow-sm overflow-hidden"
                        >
                            <div className="px-5 py-4 border-b border-slate-100">
                                <h2 className="text-[13px] font-bold text-slate-800">Quick Actions</h2>
                                <p className="text-[11px] text-slate-400 mt-0.5">Common tasks</p>
                            </div>
                            <div className="p-2 space-y-0.5">
                                {quickActions.map(({ icon: Icon, label, desc, path }) => (
                                    <button
                                        key={label}
                                        onClick={() => navigate(path)}
                                        className="w-full flex items-center gap-3 px-4 py-3 rounded-xl hover:bg-slate-50 transition-all text-left group"
                                    >
                                        <div className="w-8 h-8 rounded-xl bg-slate-50 border border-slate-100 flex items-center justify-center flex-shrink-0 group-hover:bg-emerald-50 group-hover:border-emerald-100 transition-colors">
                                            <Icon className="w-4 h-4 text-slate-400 group-hover:text-emerald-500 transition-colors" />
                                        </div>
                                        <div className="min-w-0 flex-1">
                                            <p className="text-[13px] font-semibold text-slate-700 group-hover:text-slate-900 transition-colors leading-tight">{label}</p>
                                            <p className="text-[11px] text-slate-400 mt-0.5 truncate">{desc}</p>
                                        </div>
                                        <ArrowRightIcon className="w-3.5 h-3.5 text-slate-200 group-hover:text-slate-400 flex-shrink-0 transition-colors" />
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

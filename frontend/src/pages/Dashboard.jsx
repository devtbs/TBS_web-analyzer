import { useAuth } from '../context/AuthContext';
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import api from '../api/axios';
import {
    RocketLaunchIcon,
    ClockIcon,
    ChartBarIcon,
    GlobeAltIcon,
    ArrowRightIcon,
    CheckCircleIcon,
    ExclamationCircleIcon,
    SparklesIcon,
} from '@heroicons/react/24/outline';
import { CheckCircleIcon as SolidCheck } from '@heroicons/react/24/solid';
import { motion, AnimatePresence } from 'framer-motion';
import toast from 'react-hot-toast';
import ConfirmDialog from '../components/ui/ConfirmDialog';
import AnalysisCard from '../components/ui/AnalysisCard';

const StatCard = ({ label, value, gradient, icon: Icon }) => (
    <div className={`relative overflow-hidden rounded-2xl p-5 text-white ${gradient} shadow-lg`}>
        <div className="flex items-start justify-between">
            <div>
                <p className="text-sm font-semibold text-white/70 mb-1">{label}</p>
                <p className="text-4xl font-black tracking-tight">{value ?? '—'}</p>
            </div>
            <div className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center">
                <Icon className="w-5 h-5 text-white" />
            </div>
        </div>
    </div>
);



export default function Dashboard() {
    const { user } = useAuth();
    const navigate = useNavigate();
    const [analyses, setAnalyses] = useState([]);   // recent 5 for table
    const [allAnalyses, setAllAnalyses] = useState([]); // full list for stats
    const [loading, setLoading] = useState(true);
    const [deleteDialog, setDeleteDialog] = useState({ isOpen: false, analysisId: null });

    const handleDelete = async (analysisId) => {
        try {
            const token = localStorage.getItem('access_token');
            await api.delete(`/api/analysis/${analysisId}`);
            toast.success('Analysis deleted');
            setAnalyses(prev => prev.filter(a => a.analysis_id !== analysisId));
            setAllAnalyses(prev => prev.filter(a => a.analysis_id !== analysisId));
        } catch {
            toast.error('Failed to delete analysis');
        }
    };

    const handleLabelSaved = (analysisId, newLabel) => {
        setAnalyses(prev => prev.map(a => a.analysis_id === analysisId ? { ...a, label: newLabel } : a));
        setAllAnalyses(prev => prev.map(a => a.analysis_id === analysisId ? { ...a, label: newLabel } : a));
    };

    useEffect(() => {
        const fetch = async () => {
            try {
                const token = localStorage.getItem('access_token');
                const { data } = await api.get('/api/history');
                const list = data.analyses || [];
                setAllAnalyses(list);          // full list → stats
                setAnalyses(list.slice(0, 5)); // first 5 → table
            } catch {
                // silently fail
            } finally {
                setLoading(false);
            }
        };
        fetch();
    }, []);

    const total = allAnalyses.length;
    const completed = allAnalyses.filter(a => a.status === 'completed').length;
    const failed = allAnalyses.filter(a => a.status === 'failed').length;
    const hour = new Date().getHours();
    const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
    const firstName = user?.name?.split(' ')[0] ?? 'there';

    return (
        <div className="flex-1 w-full min-h-screen py-10 px-4 sm:px-8" style={{ background: '#f5f4fa' }}>
            <div className="max-w-[1080px] mx-auto w-full space-y-8">

                {/* ── Header ── */}
                <motion.div
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                >
                    <div>
                        <h1 className="text-3xl font-black text-slate-900 tracking-tight">
                            {greeting}, {firstName}
                        </h1>
                        <p className="text-slate-500 mt-1 text-sm font-medium">
                            Here's an overview of your analysis activity.
                        </p>
                    </div>
                    <button
                        onClick={() => navigate('/new-analysis')}
                        className="self-start sm:self-auto inline-flex items-center gap-2 px-5 py-2.5 rounded-full text-white font-bold text-sm bg-gradient-to-r from-violet-600 via-purple-500 to-fuchsia-500 shadow-lg shadow-purple-300/40 hover:shadow-purple-400/50 hover:-translate-y-0.5 transition-all duration-200"
                    >
                        <RocketLaunchIcon className="w-4 h-4" />
                        New Analysis
                    </button>
                </motion.div>

                {/* ── Stat cards ── */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}>
                        <StatCard 
                            label="Total Analyses" 
                            value={loading ? <div className="h-9 w-16 bg-white/30 rounded animate-pulse mt-1" /> : total} 
                            gradient="bg-gradient-to-br from-violet-600 to-purple-700" 
                            icon={ChartBarIcon} 
                        />
                    </motion.div>
                    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
                        <StatCard 
                            label="Completed" 
                            value={loading ? <div className="h-9 w-16 bg-white/30 rounded animate-pulse mt-1" /> : completed} 
                            gradient="bg-gradient-to-br from-emerald-500 to-teal-600" 
                            icon={CheckCircleIcon} 
                        />
                    </motion.div>
                    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}>
                        <StatCard 
                            label="Failed" 
                            value={loading ? <div className="h-9 w-16 bg-white/30 rounded animate-pulse mt-1" /> : failed} 
                            gradient="bg-gradient-to-br from-rose-500 to-red-600" 
                            icon={ExclamationCircleIcon} 
                        />
                    </motion.div>
                </div>

                {/* ── Recent analyses ── */}
                <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.2 }}
                    className="flex flex-col gap-4"
                >
                    <div className="flex items-center justify-between px-1 mt-2">
                        <div className="flex items-center gap-2.5">
                            <ClockIcon className="w-[18px] h-[18px] text-slate-400 stroke-2" />
                            <h2 className="text-[16px] font-bold text-slate-800">Recent Analyses</h2>
                        </div>
                        <Link
                            to="/history"
                            className="inline-flex items-center gap-1 text-[13px] font-bold text-violet-600 hover:text-violet-700 transition-colors"
                        >
                            View all <ArrowRightIcon className="w-3.5 h-3.5 stroke-2" />
                        </Link>
                    </div>

                    {loading ? (
                        <div className="flex flex-col gap-4 mt-2">
                            {[1, 2, 3].map((i) => (
                                <div key={i} className="bg-white rounded-[20px] p-6 shadow-sm border border-slate-100 flex items-center justify-between animate-pulse">
                                    <div className="flex items-center gap-4">
                                        <div className="w-12 h-12 bg-slate-100 rounded-2xl" />
                                        <div className="space-y-2">
                                            <div className="h-4 w-48 bg-slate-100 rounded-md" />
                                            <div className="h-3 w-32 bg-slate-50 rounded-md" />
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-3">
                                        <div className="w-20 h-8 bg-slate-100 rounded-full" />
                                        <div className="w-8 h-8 bg-slate-50 rounded-full" />
                                        <div className="w-8 h-8 bg-slate-50 rounded-full" />
                                    </div>
                                </div>
                            ))}
                        </div>
                    ) : analyses.length === 0 ? (
                        <div className="bg-white rounded-[14px] shadow-[0_2px_8px_rgba(0,0,0,0.04)] border border-slate-200/60 py-16 text-center">
                            <GlobeAltIcon className="w-10 h-10 text-slate-200 mx-auto mb-3" />
                            <p className="text-sm font-semibold text-slate-400">No analyses yet</p>
                            <p className="text-xs text-slate-300 mt-1">Start your first analysis to see results here</p>
                            <button
                                onClick={() => navigate('/new-analysis')}
                                className="mt-4 inline-flex items-center gap-2 px-4 py-2 rounded-full text-white text-sm font-bold bg-gradient-to-r from-violet-600 to-fuchsia-500"
                            >
                                <RocketLaunchIcon className="w-4 h-4" /> Start Now
                            </button>
                        </div>
                    ) : (
                        <div className="space-y-4">
                            <AnimatePresence mode="popLayout">
                                {analyses.map((a, index) => (
                                    <AnalysisCard
                                        key={a.analysis_id}
                                        analysis={a}
                                        index={index}
                                        onLabelSaved={handleLabelSaved}
                                        onDelete={(id) => setDeleteDialog({ isOpen: true, analysisId: id })}
                                    />
                                ))}
                            </AnimatePresence>
                        </div>
                    )}
                </motion.div>

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
                isDestructive={true}
            />
        </div>
    );
}

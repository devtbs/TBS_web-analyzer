import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import ConfirmDialog from '../components/ui/ConfirmDialog';
import {
    ClockIcon,
    GlobeAltIcon,
    ChartBarIcon,
    ArrowRightIcon,
    TrashIcon,
    SparklesIcon,
    PencilIcon,
    CheckIcon,
    XMarkIcon,
    MagnifyingGlassIcon,
    FunnelIcon,
    RocketLaunchIcon,
} from '@heroicons/react/24/outline';
import { CheckCircleIcon as SolidCheckCircle, ExclamationCircleIcon } from '@heroicons/react/24/solid';
import axios from 'axios';
import toast from 'react-hot-toast';
import AnalysisCard from '../components/ui/AnalysisCard';



/* ── Stat card ──────────────────────────────────────────────── */
const StatCard = ({ icon, label, value, gradient, iconBg }) => (
    <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        className={`relative overflow-hidden rounded-2xl p-6 shadow-sm border border-white/60 ${gradient}`}
    >
        <div className="flex items-center justify-between">
            <div>
                <p className="text-sm font-semibold text-white/70 mb-1">{label}</p>
                <p className="text-4xl font-black text-white tracking-tight">{value}</p>
            </div>
            <div className={`w-14 h-14 rounded-2xl flex items-center justify-center ${iconBg} shadow-inner`}>
                {icon}
            </div>
        </div>
        {/* decorative glow */}
        <div className="absolute -bottom-4 -right-4 w-24 h-24 rounded-full bg-white/10 blur-2xl" />
    </motion.div>
);

/* ── Main page ──────────────────────────────────────────────── */
const History = () => {
    const navigate = useNavigate();
    const [analyses, setAnalyses] = useState([]);
    const [isLoading, setIsLoading] = useState(true);
    const [deleteDialog, setDeleteDialog] = useState({ isOpen: false, analysisId: null });
    const [editingId, setEditingId] = useState(null);
    const [search, setSearch] = useState('');
    const [filter, setFilter] = useState('all'); // all | completed | processing | failed

    useEffect(() => { fetchHistory(); }, []);

    const fetchHistory = async () => {
        try {
            const token = localStorage.getItem('access_token');
            const response = await axios.get('/api/history', {
                headers: { Authorization: `Bearer ${token}` }
            });
            setAnalyses(response.data.analyses || []);
        } catch (error) {
            console.error('Failed to fetch history:', error);
            toast.error('Failed to load history');
        } finally {
            setIsLoading(false);
        }
    };

    const handleDelete = async (analysisId) => {
        try {
            const token = localStorage.getItem('access_token');
            await axios.delete(`/api/analysis/${analysisId}`, {
                headers: { Authorization: `Bearer ${token}` }
            });
            toast.success('Analysis deleted');
            setAnalyses(prev => prev.filter(a => a.analysis_id !== analysisId));
        } catch {
            toast.error('Failed to delete analysis');
        }
    };

    const handleLabelSaved = (analysisId, newLabel) => {
        setAnalyses(prev => prev.map(a =>
            a.analysis_id === analysisId ? { ...a, label: newLabel } : a
        ));
        setEditingId(null);
    };



    const filtered = analyses.filter(a => {
        const matchesFilter = filter === 'all' || a.status === filter;
        const q = search.toLowerCase();
        const matchesSearch = !q
            || (a.label || '').toLowerCase().includes(q)
            || (a.urls || []).some(u => u.toLowerCase().includes(q));
        return matchesFilter && matchesSearch;
    });

    const completedCount = analyses.filter(a => a.status === 'completed').length;
    const urlsCount = analyses.reduce((sum, a) => sum + (a.urls?.length || 0), 0);

    /* ── Loading ── */
    if (isLoading) {
        return (
            <div className="flex-1 w-full flex items-center justify-center min-h-screen" style={{ background: '#f5f4fa' }}>
                <div className="flex flex-col items-center gap-4">
                    <div className="relative w-16 h-16">
                        <div className="absolute inset-0 rounded-full bg-gradient-to-tr from-violet-500 to-fuchsia-500 opacity-20 animate-ping" />
                        <div className="relative w-16 h-16 rounded-full bg-gradient-to-tr from-violet-500 to-fuchsia-500 flex items-center justify-center shadow-lg shadow-violet-500/30">
                            <SparklesIcon className="w-8 h-8 text-white animate-spin" />
                        </div>
                    </div>
                    <p className="text-slate-500 font-bold text-base">Loading your history…</p>
                </div>
            </div>
        );
    }

    return (
        <div className="flex-1 w-full min-h-screen py-10 px-4 sm:px-8" style={{ background: '#f5f4fa' }}>
            <div className="max-w-[1080px] mx-auto w-full space-y-8">

                {/* ── Page header ── */}
                <motion.div
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                >
                    <div>
                        <h1 className="text-3xl font-black text-slate-900 tracking-tight">Analysis History</h1>
                        <p className="text-slate-500 mt-1 text-sm font-medium">All your past website analyses in one place</p>
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
                    <StatCard
                        label="Total Analyses"
                        value={analyses.length}
                        gradient="bg-gradient-to-br from-violet-600 to-purple-700"
                        iconBg="bg-white/20"
                        icon={<ChartBarIcon className="w-7 h-7 text-white" />}
                    />
                    <StatCard
                        label="Completed"
                        value={completedCount}
                        gradient="bg-gradient-to-br from-emerald-500 to-teal-600"
                        iconBg="bg-white/20"
                        icon={<SolidCheckCircle className="w-7 h-7 text-white" />}
                    />
                    <StatCard
                        label="URLs Analyzed"
                        value={urlsCount}
                        gradient="bg-gradient-to-br from-fuchsia-500 to-pink-600"
                        iconBg="bg-white/20"
                        icon={<GlobeAltIcon className="w-7 h-7 text-white" />}
                    />
                </div>

                {/* ── Search & filter bar ── */}
                {analyses.length > 0 && (
                    <motion.div
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.15 }}
                        className="flex flex-col sm:flex-row gap-3"
                    >
                        {/* Search */}
                        <div className="relative flex-1">
                            <MagnifyingGlassIcon className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
                            <input
                                type="text"
                                value={search}
                                onChange={e => setSearch(e.target.value)}
                                placeholder="Search by URL or label…"
                                className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-white border border-slate-200 focus:border-violet-400 focus:ring-2 focus:ring-violet-100 text-sm text-slate-800 placeholder-slate-400 outline-none transition-all shadow-sm"
                            />
                            {search && (
                                <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                                    <XMarkIcon className="w-4 h-4" />
                                </button>
                            )}
                        </div>

                        {/* Filter pills */}
                        <div className="flex items-center gap-2 bg-white border border-slate-200 rounded-xl px-2 py-1.5 shadow-sm">
                            <FunnelIcon className="w-4 h-4 text-slate-400 ml-1" />
                            {['all', 'completed', 'processing', 'failed'].map(f => (
                                <button
                                    key={f}
                                    onClick={() => setFilter(f)}
                                    className={`px-3 py-1 rounded-lg text-xs font-bold capitalize transition-all ${
                                        filter === f
                                            ? 'bg-gradient-to-r from-violet-600 to-purple-600 text-white shadow-sm'
                                            : 'text-slate-500 hover:text-slate-800 hover:bg-slate-100'
                                    }`}
                                >
                                    {f}
                                </button>
                            ))}
                        </div>
                    </motion.div>
                )}

                {/* ── Empty state ── */}
                {analyses.length === 0 ? (
                    <motion.div
                        initial={{ opacity: 0, scale: 0.97 }}
                        animate={{ opacity: 1, scale: 1 }}
                        className="bg-white rounded-3xl p-16 text-center shadow-sm border border-slate-100"
                    >
                        <div className="relative w-24 h-24 mx-auto mb-6">
                            <div className="absolute inset-0 rounded-3xl bg-gradient-to-br from-violet-100 to-fuchsia-100 animate-pulse" />
                            <div className="relative w-24 h-24 rounded-3xl bg-gradient-to-br from-violet-50 to-fuchsia-50 flex items-center justify-center border border-violet-100">
                                <ClockIcon className="w-12 h-12 text-violet-300" />
                            </div>
                        </div>
                        <h3 className="text-2xl font-black text-slate-800 mb-2">No analyses yet</h3>
                        <p className="text-slate-500 mb-8 max-w-sm mx-auto">Start your first AI-powered website analysis to see comprehensive insights here.</p>
                        <button
                            onClick={() => navigate('/dashboard')}
                            className="inline-flex items-center gap-2 px-8 py-3.5 rounded-full text-white font-bold bg-gradient-to-r from-violet-600 via-purple-500 to-fuchsia-500 shadow-xl shadow-purple-300/40 hover:shadow-purple-400/50 hover:-translate-y-0.5 transition-all duration-200"
                        >
                            <RocketLaunchIcon className="w-5 h-5" />
                            Start Your First Analysis
                        </button>
                    </motion.div>
                ) : filtered.length === 0 ? (
                    /* No search results */
                    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                        className="bg-white rounded-2xl p-12 text-center border border-slate-100 shadow-sm"
                    >
                        <p className="text-slate-500 font-semibold">No results</p>
                        <button onClick={() => { setSearch(''); setFilter('all'); }} className="mt-3 text-sm text-violet-600 font-bold hover:underline">
                            Clear filters
                        </button>
                    </motion.div>
                ) : (
                    /* ── Analysis cards ── */
                    <div className="space-y-4">
                        <AnimatePresence mode="popLayout">
                            {filtered.map((analysis, index) => (
                                <AnalysisCard
                                    key={analysis.analysis_id}
                                    analysis={analysis}
                                    index={index}
                                    onLabelSaved={handleLabelSaved}
                                    onDelete={(id) => setDeleteDialog({ isOpen: true, analysisId: id })}
                                />
                            ))}
                        </AnimatePresence>

                        {/* Results count */}
                        {(search || filter !== 'all') && (
                            <p className="text-center text-xs text-slate-400 font-medium pt-2">
                                Showing {filtered.length} of {analyses.length} analyses
                            </p>
                        )}
                    </div>
                )}
            </div>

            {/* Delete Dialog */}
            <ConfirmDialog
                isOpen={deleteDialog.isOpen}
                onClose={() => setDeleteDialog({ isOpen: false, analysisId: null })}
                onConfirm={() => {
                    handleDelete(deleteDialog.analysisId);
                    setDeleteDialog({ isOpen: false, analysisId: null });
                }}
                title="Delete Analysis?"
                message="Are you sure you want to delete this analysis? This action cannot be undone and all associated data will be permanently removed."
                confirmText="Delete"
                cancelText="Cancel"
            />
        </div>
    );
};

export default History;

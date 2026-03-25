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

/* ── Favicon helper ─────────────────────────────────────────── */
const Favicon = ({ url, size = 20 }) => {
    const [err, setErr] = useState(false);
    try {
        const host = new URL(url).hostname;
        if (err) return <GlobeAltIcon style={{ width: size, height: size }} className="text-violet-300" />;
        return (
            <img
                src={`https://www.google.com/s2/favicons?domain=${host}&sz=32`}
                alt=""
                width={size}
                height={size}
                className="rounded-sm object-contain"
                onError={() => setErr(true)}
            />
        );
    } catch {
        return <GlobeAltIcon style={{ width: size, height: size }} className="text-violet-300" />;
    }
};

/* ── Inline rename ──────────────────────────────────────────── */
const RenameInput = ({ analysisId, currentLabel, onSaved, onCancel }) => {
    const [value, setValue] = useState(currentLabel || '');
    const inputRef = useRef(null);

    useEffect(() => { inputRef.current?.focus(); inputRef.current?.select(); }, []);

    const save = async () => {
        try {
            const token = localStorage.getItem('access_token');
            await axios.patch(`/api/analysis/${analysisId}/label`,
                { label: value },
                { headers: { Authorization: `Bearer ${token}` } }
            );
            onSaved(value.trim() || null);
            toast.success('Label saved');
        } catch {
            toast.error('Failed to save label');
        }
    };

    const onKey = (e) => {
        if (e.key === 'Enter') save();
        if (e.key === 'Escape') onCancel();
    };

    return (
        <div className="flex items-center gap-2 w-full">
            <input
                ref={inputRef}
                value={value}
                onChange={e => setValue(e.target.value)}
                onKeyDown={onKey}
                placeholder="Enter a label…"
                className="flex-1 min-w-0 px-3 py-1.5 rounded-lg border border-violet-300 focus:border-violet-500 focus:ring-2 focus:ring-violet-100 text-sm font-semibold text-slate-800 bg-white outline-none transition-all"
            />
            <button onClick={save} className="flex-shrink-0 p-1.5 rounded-lg bg-violet-600 text-white hover:bg-violet-700 transition-colors">
                <CheckIcon className="w-4 h-4" />
            </button>
            <button onClick={onCancel} className="flex-shrink-0 p-1.5 rounded-lg bg-white border border-slate-200 text-slate-400 hover:text-red-500 hover:border-red-200 transition-colors">
                <XMarkIcon className="w-4 h-4" />
            </button>
        </div>
    );
};

/* ── Status badge ───────────────────────────────────────────── */
const StatusBadge = ({ status }) => {
    if (status === 'completed') return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-emerald-50 text-emerald-600 rounded-full text-xs font-bold border border-emerald-100">
            <SolidCheckCircle className="w-3.5 h-3.5" /> Completed
        </span>
    );
    if (status === 'processing') return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-violet-50 text-violet-600 rounded-full text-xs font-bold border border-violet-100">
            <SparklesIcon className="w-3.5 h-3.5 animate-spin" /> Processing
        </span>
    );
    return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-red-50 text-red-500 rounded-full text-xs font-bold border border-red-100">
            <ExclamationCircleIcon className="w-3.5 h-3.5" /> Failed
        </span>
    );
};

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

    const formatDate = (dateString) => {
        const date = new Date(dateString);
        const now = new Date();
        const diffMs = now - date;
        const diffMins = Math.floor(diffMs / 60000);
        const diffHours = Math.floor(diffMs / 3600000);
        const diffDays = Math.floor(diffMs / 86400000);

        if (diffMins < 1) return 'Just now';
        if (diffMins < 60) return `${diffMins}m ago`;
        if (diffHours < 24) return `${diffHours}h ago`;
        if (diffDays < 7) return `${diffDays}d ago`;
        return new Intl.DateTimeFormat('en-US', {
            month: 'short', day: 'numeric', year: 'numeric'
        }).format(date);
    };

    const getDisplayName = (analysis) => {
        if (analysis.label) return analysis.label;
        const domains = (analysis.urls || [])
            .slice(0, 2)
            .map(u => { try { return new URL(u).hostname.replace('www.', ''); } catch { return u; } });
        return domains.join(' · ') + (analysis.urls?.length > 2 ? ` +${analysis.urls.length - 2}` : '');
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
            <div className="flex-1 w-full flex items-center justify-center min-h-[calc(100vh-160px)]" style={{ background: '#f5f4fa' }}>
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
        <div className="flex-1 w-full min-h-[calc(100vh-160px)] py-10 px-4 sm:px-8" style={{ background: '#f5f4fa' }}>
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
                        onClick={() => navigate('/dashboard')}
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
                                <motion.div
                                    key={analysis.analysis_id}
                                    layout
                                    initial={{ opacity: 0, y: 16 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    exit={{ opacity: 0, x: -20, transition: { duration: 0.15 } }}
                                    transition={{ delay: index * 0.04, duration: 0.3 }}
                                    className="group bg-white rounded-2xl border border-slate-100 shadow-sm hover:shadow-[0_8px_32px_-8px_rgba(139,92,246,0.18)] hover:border-violet-100 transition-all duration-300"
                                >
                                    <div className="flex gap-0">

                                        {/* ── Left accent strip ── */}
                                        <div className={`hidden sm:flex w-1 rounded-l-2xl flex-shrink-0 ${
                                            analysis.status === 'completed' ? 'bg-gradient-to-b from-emerald-400 to-teal-500' :
                                            analysis.status === 'processing' ? 'bg-gradient-to-b from-violet-400 to-purple-500 animate-pulse' :
                                            'bg-gradient-to-b from-red-400 to-rose-500'
                                        }`} />

                                        {/* ── Card body ── */}
                                        <div className="flex-1 px-5 py-4 min-w-0">

                                            {/* ── Top row: icon + info + actions ── */}
                                            <div className="flex items-center gap-4">

                                                {/* Icon */}
                                                <div className="relative flex-shrink-0">
                                                    <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-violet-500 to-fuchsia-500 flex items-center justify-center shadow-md shadow-violet-300/30">
                                                        <GlobeAltIcon className="w-5 h-5 text-white" />
                                                    </div>
                                                    <div className="absolute -bottom-1 -right-1 w-4 h-4 rounded-full bg-white border border-slate-100 flex items-center justify-center shadow-sm">
                                                        <span className="text-[8px] font-black text-violet-700 leading-none">{analysis.urls?.length || 0}</span>
                                                    </div>
                                                </div>

                                                {/* Title + status + timestamp */}
                                                <div className="flex-1 min-w-0">
                                                    {/* Row 1: name + status badge (inline) */}
                                                    <div className="flex items-center gap-2 min-w-0 mb-0.5">
                                                        {editingId === analysis.analysis_id ? (
                                                            <div className="flex-1 min-w-0">
                                                                <RenameInput
                                                                    analysisId={analysis.analysis_id}
                                                                    currentLabel={analysis.label}
                                                                    onSaved={(lbl) => handleLabelSaved(analysis.analysis_id, lbl)}
                                                                    onCancel={() => setEditingId(null)}
                                                                />
                                                            </div>
                                                        ) : (
                                                            <div className="flex items-center gap-1.5 group/name min-w-0 flex-1">
                                                                <h3 className="text-sm font-bold text-slate-800 truncate">
                                                                    {getDisplayName(analysis)}
                                                                </h3>
                                                                {!analysis.label && (
                                                                    <span className="text-[9px] font-bold text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded-full flex-shrink-0">auto</span>
                                                                )}
                                                                <button
                                                                    onClick={() => setEditingId(analysis.analysis_id)}
                                                                    title="Rename"
                                                                    className="opacity-0 group-hover/name:opacity-100 p-0.5 rounded text-slate-300 hover:text-violet-500 hover:bg-violet-50 transition-all flex-shrink-0"
                                                                >
                                                                    <PencilIcon className="w-3 h-3" />
                                                                </button>
                                                            </div>
                                                        )}
                                                        {/* Status badge pinned right of title */}
                                                        <StatusBadge status={analysis.status} />
                                                    </div>

                                                    {/* Row 2: timestamp */}
                                                    <div className="flex items-center gap-1 text-[11px] text-slate-400 font-medium">
                                                        <ClockIcon className="w-3 h-3 flex-shrink-0" />
                                                        {formatDate(analysis.created_at)}
                                                    </div>
                                                </div>

                                                {/* ── Actions ── */}
                                                <div className="flex items-center gap-2 flex-shrink-0 ml-2">
                                                    {analysis.status === 'completed' && (
                                                        <button
                                                            onClick={() => navigate(`/results/${analysis.analysis_id}`)}
                                                            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-bold text-white bg-gradient-to-r from-violet-600 to-purple-600 shadow-sm hover:shadow-lg hover:shadow-purple-400/30 hover:-translate-y-0.5 transition-all duration-200"
                                                        >
                                                            View Results
                                                            <ArrowRightIcon className="w-3.5 h-3.5" />
                                                        </button>
                                                    )}
                                                    {analysis.status === 'processing' && (
                                                        <button
                                                            onClick={() => navigate(`/results/${analysis.analysis_id}`)}
                                                            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-bold text-violet-600 bg-violet-50 border border-violet-200 hover:bg-violet-100 transition-all"
                                                        >
                                                            <SparklesIcon className="w-3.5 h-3.5 animate-spin" />
                                                            In Progress
                                                        </button>
                                                    )}
                                                    <button
                                                        onClick={() => setDeleteDialog({ isOpen: true, analysisId: analysis.analysis_id })}
                                                        title="Delete"
                                                        className="p-2 rounded-xl text-slate-300 hover:text-red-500 hover:bg-red-50 border border-slate-100 hover:border-red-200 transition-all"
                                                    >
                                                        <TrashIcon className="w-4 h-4" />
                                                    </button>
                                                </div>
                                            </div>

                                            {/* ── Bottom row: URL pills ── */}
                                            {(analysis.urls?.length || 0) > 0 && (
                                                <div className="flex flex-wrap gap-1.5 mt-3 pt-3 border-t border-slate-50">
                                                    {(analysis.urls || []).slice(0, 5).map((url, i) => {
                                                        let host = url;
                                                        try { host = new URL(url).hostname.replace('www.', ''); } catch {}
                                                        return (
                                                            <div key={i} className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-slate-50 border border-slate-100 rounded-lg text-xs text-slate-500 font-medium hover:bg-violet-50 hover:border-violet-100 hover:text-violet-700 transition-colors">
                                                                <Favicon url={url} size={11} />
                                                                <span className="truncate max-w-[120px]">{host}</span>
                                                            </div>
                                                        );
                                                    })}
                                                    {(analysis.urls?.length || 0) > 5 && (
                                                        <div className="inline-flex items-center px-2.5 py-1 bg-violet-50 border border-violet-100 rounded-lg text-xs text-violet-600 font-bold">
                                                            +{analysis.urls.length - 5}
                                                        </div>
                                                    )}
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </motion.div>
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

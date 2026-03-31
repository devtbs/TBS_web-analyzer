import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import ConfirmDialog from '../components/ui/ConfirmDialog';
import {
    ClockIcon,
    MagnifyingGlassIcon,
    RocketLaunchIcon,
    XMarkIcon,
} from '@heroicons/react/24/outline';
import api from '../api/axios';
import toast from 'react-hot-toast';
import AnalysisCard from '../components/ui/AnalysisCard';

const FILTERS = [
    { key: 'all',        label: 'All' },
    { key: 'completed',  label: 'Completed' },
    { key: 'processing', label: 'Processing' },
    { key: 'failed',     label: 'Failed' },
];

const History = () => {
    const navigate = useNavigate();
    const [analyses, setAnalyses] = useState([]);
    const [isLoading, setIsLoading] = useState(true);
    const [deleteDialog, setDeleteDialog] = useState({ isOpen: false, analysisId: null });
    const [search, setSearch] = useState('');
    const [filter, setFilter] = useState('all');

    useEffect(() => { fetchHistory(); }, []);

    const fetchHistory = async () => {
        try {
            const response = await api.get('/api/history');
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
            await api.delete(`/api/analysis/${analysisId}`);
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
    };

    const filtered = analyses.filter(a => {
        const matchesFilter = filter === 'all' || a.status === filter;
        const q = search.toLowerCase();
        const matchesSearch = !q
            || (a.label || '').toLowerCase().includes(q)
            || (a.urls || []).some(u => u.toLowerCase().includes(q));
        return matchesFilter && matchesSearch;
    });

    return (
        <div className="bg-white min-h-screen flex flex-col">

            {/* ── Header — same layout as Documents ── */}
            <div className="px-4 sm:px-6 py-3 sm:py-4 flex flex-col sm:flex-row sm:items-center gap-3 border-b border-slate-100">
                <h1 className="text-xl font-bold text-slate-800 flex-shrink-0">
                    Analysis History
                </h1>

                <div className="flex items-center gap-2 sm:gap-3 sm:ml-auto w-full sm:w-auto">
                    {/* Search */}
                    <div className="relative flex-1 sm:flex-initial">
                        <MagnifyingGlassIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
                        <input
                            type="text"
                            placeholder="Search analyses..."
                            className="text-sm bg-slate-50 border-none rounded-lg pl-9 pr-8 py-2 w-full sm:w-56 focus:ring-2 focus:ring-emerald-500 transition-all font-medium outline-none"
                            value={search}
                            onChange={e => setSearch(e.target.value)}
                        />
                        {search && (
                            <button
                                onClick={() => setSearch('')}
                                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                            >
                                <XMarkIcon className="w-3.5 h-3.5" />
                            </button>
                        )}
                    </div>

                    {/* New Analysis */}
                    <button
                        onClick={() => navigate('/new-analysis')}
                        className="flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white px-3 sm:px-4 py-2 rounded-lg text-sm font-bold transition-all shadow-sm whitespace-nowrap flex-shrink-0"
                    >
                        <RocketLaunchIcon className="w-4 h-4" />
                        <span className="hidden sm:inline">New Analysis</span>
                        <span className="sm:hidden">New</span>
                    </button>
                </div>
            </div>

            {/* ── Filter tabs — same style as Documents table header ── */}
            <div className="px-4 sm:px-6 pt-3 pb-0 flex items-center gap-1 border-b border-slate-100">
                {FILTERS.map(f => {
                    const count = f.key === 'all'
                        ? analyses.length
                        : analyses.filter(a => a.status === f.key).length;
                    return (
                        <button
                            key={f.key}
                            onClick={() => setFilter(f.key)}
                            className={`relative px-3 py-2 text-sm font-semibold transition-colors ${
                                filter === f.key
                                    ? 'text-slate-800'
                                    : 'text-slate-400 hover:text-slate-600'
                            }`}
                        >
                            {f.label}
                            {!isLoading && (
                                <span className={`ml-1.5 text-xs font-bold px-1.5 py-0.5 rounded-full ${
                                    filter === f.key ? 'bg-slate-100 text-slate-600' : 'text-slate-300'
                                }`}>
                                    {count}
                                </span>
                            )}
                            {/* Active underline */}
                            {filter === f.key && (
                                <motion.div
                                    layoutId="history-tab-underline"
                                    className="absolute bottom-0 left-0 right-0 h-0.5 bg-emerald-500 rounded-full"
                                />
                            )}
                        </button>
                    );
                })}

                {/* Result count when searching */}
                {search && !isLoading && (
                    <span className="ml-auto text-xs text-slate-400 font-medium pb-2">
                        {filtered.length} result{filtered.length !== 1 ? 's' : ''}
                    </span>
                )}
            </div>

            {/* ── Content ── */}
            <div className="flex-1 px-4 sm:px-6 py-4">
                {isLoading ? (
                    <div className="space-y-3 pt-2">
                        {[1, 2, 3, 4].map(i => (
                            <div key={i} className="h-20 bg-slate-50 border border-slate-100 rounded-2xl animate-pulse" />
                        ))}
                    </div>

                ) : analyses.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-24 text-center">
                        <div className="w-14 h-14 sm:w-16 sm:h-16 bg-slate-50 text-slate-300 flex items-center justify-center rounded-2xl mb-4">
                            <ClockIcon className="w-7 h-7 sm:w-8 sm:h-8" />
                        </div>
                        <h3 className="text-base sm:text-lg font-bold text-slate-800 mb-1">No analyses yet</h3>
                        <p className="text-slate-500 text-sm max-w-xs sm:max-w-sm mb-6">
                            Start your first AI-powered website analysis to see results here.
                        </p>
                        <button
                            onClick={() => navigate('/new-analysis')}
                            className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-lg text-sm font-bold transition-all shadow-sm"
                        >
                            <RocketLaunchIcon className="w-4 h-4" />
                            Start Your First Analysis
                        </button>
                    </div>

                ) : filtered.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-20 text-center">
                        <div className="w-14 h-14 bg-slate-50 text-slate-300 flex items-center justify-center rounded-2xl mb-4">
                            <MagnifyingGlassIcon className="w-7 h-7" />
                        </div>
                        <h3 className="text-base font-bold text-slate-800 mb-1">No results found</h3>
                        <p className="text-slate-500 text-sm">
                            {search ? 'Try adjusting your search query.' : 'No analyses match the selected filter.'}
                        </p>
                        <button
                            onClick={() => { setSearch(''); setFilter('all'); }}
                            className="mt-4 text-sm text-emerald-600 font-bold hover:underline"
                        >
                            Clear filters
                        </button>
                    </div>

                ) : (
                    <div className="space-y-3 pt-2">
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
                    </div>
                )}
            </div>

            {/* ── Delete Dialog ── */}
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

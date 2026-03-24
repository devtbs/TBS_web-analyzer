import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import ConfirmDialog from '../components/ui/ConfirmDialog';
import {
    ClockIcon,
    GlobeAltIcon,
    ChartBarIcon,
    ArrowRightIcon,
    TrashIcon,
    CheckCircleIcon,
    SparklesIcon
} from '@heroicons/react/24/outline';
import { CheckCircleIcon as SolidCheckCircle } from '@heroicons/react/24/solid';
import axios from 'axios';
import toast from 'react-hot-toast';

const History = () => {
    const navigate = useNavigate();
    const [analyses, setAnalyses] = useState([]);
    const [isLoading, setIsLoading] = useState(true);
    const [deleteDialog, setDeleteDialog] = useState({ isOpen: false, analysisId: null });

    useEffect(() => {
        fetchHistory();
    }, []);

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
            toast.success('Analysis deleted successfully');
            fetchHistory();
        } catch (error) {
            console.error('Failed to delete analysis:', error);
            toast.error('Failed to delete analysis');
        }
    };

    const formatDate = (dateString) => {
        const date = new Date(dateString);
        return new Intl.DateTimeFormat('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            hour12: true
        }).format(date);
    };

    if (isLoading) {
        return (
            <div className="flex-1 w-full flex items-center justify-center min-h-[calc(100vh-160px)]" style={{ background: '#f5f4fa' }}>
                <div className="flex flex-col items-center">
                    <SparklesIcon className="w-10 h-10 text-violet-500 animate-spin mb-4" />
                    <p className="text-slate-500 font-bold text-base">Loading history...</p>
                </div>
            </div>
        );
    }

    const completedCount = analyses.filter(a => a.status === 'completed').length;
    const urlsCount = analyses.reduce((sum, a) => sum + (a.urls?.length || 0), 0);

    return (
        <div className="flex-1 w-full min-h-[calc(100vh-160px)] py-8 sm:py-12 px-4 sm:px-8" style={{ background: '#f5f4fa' }}>
            <div className="max-w-[1024px] mx-auto w-full">
                
                {/* ── Header ── */}
                <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.3 }}
                    className="flex flex-col sm:flex-row sm:items-end justify-between gap-6 mb-10"
                >
                    <div>
                        <h1 className="text-3xl font-bold text-slate-800 mb-2">Analysis History</h1>
                        <p className="text-base font-medium text-slate-500">View and manage your past website analyses</p>
                    </div>
                    <button
                        onClick={() => navigate('/dashboard')}
                        className="px-6 py-3 rounded-full text-white font-bold text-sm transition-all duration-300 shadow-lg flex items-center justify-center gap-2 bg-gradient-to-r from-violet-600 via-purple-500 to-fuchsia-500 hover:shadow-purple-500/40 hover:-translate-y-0.5"
                    >
                        <ChartBarIcon className="w-5 h-5" />
                        New Analysis
                    </button>
                </motion.div>

                {/* ── Stats Row ── */}
                <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.3, delay: 0.1 }}
                    className="grid grid-cols-1 md:grid-cols-3 gap-5 mb-10"
                >
                    <div className="bg-white rounded-[24px] p-6 shadow-[0_10px_30px_-10px_rgba(0,0,0,0.03)] border border-slate-100 flex items-center gap-5">
                        <div className="w-14 h-14 bg-violet-50 rounded-2xl flex items-center justify-center flex-shrink-0">
                            <ChartBarIcon className="w-7 h-7 text-violet-600" />
                        </div>
                        <div>
                            <div className="text-3xl font-bold text-slate-800">{analyses.length}</div>
                            <div className="text-sm font-bold text-slate-500">Total Analyses</div>
                        </div>
                    </div>
                    
                    <div className="bg-white rounded-[24px] p-6 shadow-[0_10px_30px_-10px_rgba(0,0,0,0.03)] border border-slate-100 flex items-center gap-5">
                        <div className="w-14 h-14 bg-emerald-50 rounded-2xl flex items-center justify-center flex-shrink-0">
                            <SolidCheckCircle className="w-7 h-7 text-emerald-500" />
                        </div>
                        <div>
                            <div className="text-3xl font-bold text-slate-800">{completedCount}</div>
                            <div className="text-sm font-bold text-slate-500">Completed</div>
                        </div>
                    </div>

                    <div className="bg-white rounded-[24px] p-6 shadow-[0_10px_30px_-10px_rgba(0,0,0,0.03)] border border-slate-100 flex items-center gap-5">
                        <div className="w-14 h-14 bg-fuchsia-50 rounded-2xl flex items-center justify-center flex-shrink-0">
                            <GlobeAltIcon className="w-7 h-7 text-fuchsia-600" />
                        </div>
                        <div>
                            <div className="text-3xl font-bold text-slate-800">{urlsCount}</div>
                            <div className="text-sm font-bold text-slate-500">URLs Analyzed</div>
                        </div>
                    </div>
                </motion.div>

                {/* ── Analysis List ── */}
                {analyses.length === 0 ? (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        className="bg-white rounded-[32px] p-12 text-center shadow-[0_20px_50px_-15px_rgba(0,0,0,0.05)] border border-slate-100"
                    >
                        <div className="w-20 h-20 bg-slate-50 rounded-3xl flex items-center justify-center mx-auto mb-6">
                            <ClockIcon className="w-10 h-10 text-slate-300" />
                        </div>
                        <h3 className="text-xl font-bold text-slate-800 mb-2">No analyses yet</h3>
                        <p className="text-base text-slate-500 mb-8">Start your first website analysis to see results here</p>
                        <button
                            onClick={() => navigate('/dashboard')}
                            className="px-8 py-3.5 rounded-full text-white font-bold text-base transition-all duration-300 shadow-xl bg-gradient-to-r from-violet-600 via-purple-500 to-fuchsia-500 hover:shadow-purple-500/40 hover:-translate-y-0.5"
                        >
                            Start Analyzing
                        </button>
                    </motion.div>
                ) : (
                    <div className="space-y-5">
                        <AnimatePresence>
                            {analyses.map((analysis, index) => (
                                <motion.div
                                    key={analysis.analysis_id}
                                    initial={{ opacity: 0, y: 15 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    exit={{ opacity: 0, scale: 0.98, transition: { duration: 0.2 } }}
                                    transition={{ delay: index * 0.05 }}
                                    className="bg-white rounded-[24px] p-6 sm:p-8 shadow-[0_10px_30px_-10px_rgba(0,0,0,0.03)] border border-slate-100 hover:shadow-[0_20px_40px_-15px_rgba(139,92,246,0.15)] transition-shadow duration-300 flex flex-col sm:flex-row gap-6 justify-between items-start sm:items-center group"
                                >
                                    {/* Left Side: Info */}
                                    <div className="flex-1 min-w-0 flex items-start sm:items-center gap-5">
                                        <div className="w-14 h-14 bg-gradient-to-br from-violet-500 to-fuchsia-500 rounded-2xl flex items-center justify-center flex-shrink-0 shadow-md shadow-purple-200">
                                            <GlobeAltIcon className="w-7 h-7 text-white" />
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center gap-3 mb-1.5 flex-wrap">
                                                <h3 className="text-lg font-bold text-slate-800">
                                                    {analysis.urls?.length || 0} Website{(analysis.urls?.length || 0) !== 1 ? 's' : ''}
                                                </h3>
                                                {analysis.status === 'completed' && (
                                                    <span className="px-3 py-1 bg-emerald-50 text-emerald-600 rounded-full text-xs font-bold flex items-center gap-1.5 border border-emerald-100">
                                                        <SolidCheckCircle className="w-3.5 h-3.5" />
                                                        Completed
                                                    </span>
                                                )}
                                                {analysis.status === 'processing' && (
                                                    <span className="px-3 py-1 bg-violet-50 text-violet-600 rounded-full text-xs font-bold flex items-center gap-1.5 border border-violet-100">
                                                        <SparklesIcon className="w-3.5 h-3.5 animate-spin" />
                                                        Processing
                                                    </span>
                                                )}
                                                {analysis.status === 'failed' && (
                                                    <span className="px-3 py-1 bg-red-50 text-red-600 rounded-full text-xs font-bold flex items-center gap-1.5 border border-red-100">
                                                        Failed
                                                    </span>
                                                )}
                                            </div>
                                            <div className="flex items-center gap-2 text-sm font-medium text-slate-400 mb-3">
                                                <ClockIcon className="w-4 h-4" />
                                                {formatDate(analysis.created_at)}
                                            </div>
                                            <div className="flex flex-col gap-1.5">
                                                {analysis.urls?.slice(0, 3).map((url, urlIndex) => (
                                                    <div key={urlIndex} className="flex items-center gap-2 text-sm">
                                                        <div className="w-1.5 h-1.5 rounded-full bg-violet-300 flex-shrink-0"></div>
                                                        <span className="text-slate-500 truncate" title={url}>{url}</span>
                                                    </div>
                                                ))}
                                                {(analysis.urls?.length || 0) > 3 && (
                                                    <div className="text-xs font-bold text-violet-400 pl-3.5">
                                                        + {analysis.urls.length - 3} more URLs
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    </div>

                                    {/* Right Side: Actions */}
                                    <div className="flex items-center gap-3 w-full sm:w-auto pt-4 sm:pt-0 border-t border-slate-100 sm:border-0 justify-end">
                                        {(analysis.status === 'completed' || analysis.status === 'processing') && (
                                            <button
                                                onClick={() => navigate(`/results/${analysis.analysis_id}`)}
                                                className={`px-5 py-2.5 rounded-xl text-sm font-bold transition-all shadow-sm flex items-center gap-2
                                                    ${analysis.status === 'completed' 
                                                        ? 'bg-gradient-to-r from-violet-600 to-purple-600 text-white hover:shadow-md hover:shadow-purple-500/30' 
                                                        : 'bg-white border border-violet-200 text-violet-600 hover:bg-violet-50'
                                                    }`}
                                            >
                                                {analysis.status === 'completed' ? 'View Results' : 'Check Status'}
                                                {analysis.status === 'completed' && <ArrowRightIcon className="w-4 h-4" />}
                                            </button>
                                        )}
                                        <button
                                            onClick={() => setDeleteDialog({ isOpen: true, analysisId: analysis.analysis_id })}
                                            className="p-2.5 rounded-xl text-slate-400 bg-white border border-slate-200 hover:text-red-500 hover:border-red-200 hover:bg-red-50 transition-all shadow-sm"
                                            title="Delete Analysis"
                                        >
                                            <TrashIcon className="w-5 h-5" />
                                        </button>
                                    </div>
                                </motion.div>
                            ))}
                        </AnimatePresence>
                    </div>
                )}
            </div>

            {/* Delete Dialog */}
            <ConfirmDialog
                isOpen={deleteDialog.isOpen}
                onClose={() => setDeleteDialog({ isOpen: false, analysisId: null })}
                onConfirm={() => handleDelete(deleteDialog.analysisId)}
                title="Delete Analysis?"
                message="Are you sure you want to delete this analysis? This action cannot be undone and all associated data will be permanently removed."
                confirmText="Delete"
                cancelText="Cancel"
            />
        </div>
    );
};

export default History;

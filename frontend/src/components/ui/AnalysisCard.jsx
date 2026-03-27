import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
    ClockIcon,
    GlobeAltIcon,
    ArrowRightIcon,
    TrashIcon,
    SparklesIcon,
    PencilIcon,
    CheckIcon,
    XMarkIcon,
} from '@heroicons/react/24/outline';
import { CheckCircleIcon as SolidCheckCircle, ExclamationCircleIcon } from '@heroicons/react/24/solid';
import api from '../../api/axios';
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
            await api.patch(`/api/analysis/${analysisId}/label`,
                { label: value }
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
        <span className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-emerald-50 text-emerald-600 rounded-full text-[12px] font-bold border border-emerald-100/50">
            <SolidCheckCircle className="w-3.5 h-3.5" /> Completed
        </span>
    );
    if (status === 'processing') return (
        <span className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-violet-50 text-violet-600 rounded-full text-[12px] font-bold border border-violet-100">
            <SparklesIcon className="w-3.5 h-3.5 animate-spin" /> Processing
        </span>
    );
    return (
        <span className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-red-50 text-red-500 rounded-full text-[12px] font-bold border border-red-100">
            <ExclamationCircleIcon className="w-3.5 h-3.5" /> Failed
        </span>
    );
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

const AnalysisCard = ({ analysis, onLabelSaved, onDelete, index }) => {
    const navigate = useNavigate();
    const [isEditing, setIsEditing] = useState(false);

    return (
        <motion.div
            layout
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, x: -20, transition: { duration: 0.15 } }}
            transition={{ delay: (index || 0) * 0.04, duration: 0.3 }}
            className="group bg-white rounded-[14px] border border-slate-200/60 shadow-[0_2px_8px_rgba(0,0,0,0.04)] hover:shadow-[0_8px_32px_-8px_rgba(139,92,246,0.18)] hover:border-violet-200 transition-all duration-300 overflow-hidden flex flex-col p-4 sm:p-5 gap-3 w-full"
        >
            {/* ── Top row: icon + info + actions ── */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="flex items-center gap-4 min-w-0">
                    {/* Icon */}
                    <div className="relative flex-shrink-0">
                        <div className="w-[46px] h-[46px] bg-[#a855f7] rounded-[14px] flex items-center justify-center shadow-sm">
                            <GlobeAltIcon className="w-[22px] h-[22px] text-white" />
                        </div>
                        <div className="absolute -bottom-1 -right-1 w-5 h-5 rounded-full bg-white border border-slate-100 flex items-center justify-center shadow-sm">
                            <span className="text-[10px] font-bold text-[#8b5cf6] leading-none">{analysis.urls?.length || 0}</span>
                        </div>
                    </div>

                    {/* Title + timestamp */}
                    <div className="flex flex-col gap-1.5 min-w-0">
                        <div className="flex items-center gap-2 min-w-0 group/name">
                            {isEditing ? (
                                <div className="flex-1 min-w-0">
                                    <RenameInput
                                        analysisId={analysis.analysis_id}
                                        currentLabel={analysis.label}
                                        onSaved={(lbl) => {
                                            if (onLabelSaved) onLabelSaved(analysis.analysis_id, lbl);
                                            setIsEditing(false);
                                        }}
                                        onCancel={() => setIsEditing(false)}
                                    />
                                </div>
                            ) : (
                                <>
                                    <h3 className="text-[15px] font-bold text-slate-800 truncate">
                                        {getDisplayName(analysis)}
                                    </h3>
                                    {!analysis.label && (
                                        <span className="text-[10px] font-bold text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded-[5px] flex-shrink-0 leading-none">auto</span>
                                    )}
                                    <button
                                        onClick={() => setIsEditing(true)}
                                        title="Rename"
                                        className="p-1 rounded text-slate-400 hover:text-violet-600 hover:bg-violet-50 transition-all flex-shrink-0"
                                    >
                                        <PencilIcon className="w-4 h-4" />
                                    </button>
                                </>
                            )}
                        </div>
                        <div className="flex items-center gap-1.5 text-[12px] font-medium text-slate-400">
                            <ClockIcon className="w-[14px] h-[14px] text-slate-400" />
                            {formatDate(analysis.created_at)}
                        </div>
                    </div>
                </div>

                {/* ── Actions ── */}
                <div className="flex items-center gap-3 flex-shrink-0 ml-[62px] sm:ml-0">
                    {/* Only show badge for failure; success/processing used the button below */}
                    {analysis.status === 'failed' && <StatusBadge status={analysis.status} />}

                    {analysis.status === 'completed' && (
                        <button
                            onClick={() => navigate(`/results/${analysis.analysis_id}`)}
                            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-[10px] text-[13px] font-bold text-white bg-[#8b5cf6] hover:bg-[#7c3aed] shadow-sm transition-colors"
                        >
                            <CheckIcon className="w-3.5 h-3.5 stroke-2" />
                            View Results
                        </button>
                    )}
                    {analysis.status === 'processing' && (
                        <button
                            onClick={() => navigate(`/results/${analysis.analysis_id}`)}
                            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-[10px] text-[13px] font-bold text-violet-600 bg-violet-50 border border-violet-100 hover:bg-violet-100 transition-colors"
                        >
                            <SparklesIcon className="w-3.5 h-3.5 animate-spin" />
                            Analyzing...
                        </button>
                    )}
                    <button
                        onClick={() => {
                            if (onDelete) onDelete(analysis.analysis_id);
                        }}
                        title="Delete"
                        className="p-2 border border-slate-200 rounded-[10px] text-slate-400 hover:text-red-500 hover:border-red-200 hover:bg-red-50 transition-colors bg-white"
                    >
                        <TrashIcon className="w-[18px] h-[18px]" />
                    </button>
                </div>
            </div>

            {/* ── Bottom row: URL pills ── */}
            {(analysis.urls?.length || 0) > 0 && (
                <div className="flex flex-wrap gap-2 pt-1 pl-[62px]">
                    {(analysis.urls || []).slice(0, 5).map((url, i) => {
                        let host = url;
                        try { host = new URL(url).hostname.replace('www.', ''); } catch {}
                        return (
                            <div key={i} className="inline-flex items-center gap-1.5 px-2.5 py-1.5 bg-slate-50 border border-slate-100 rounded-[8px] text-[12px] text-slate-500 font-semibold hover:bg-violet-50 hover:border-violet-100 hover:text-violet-600 transition-colors cursor-default">
                                <Favicon url={url} size={13} />
                                <span className="truncate max-w-[160px]">{host}</span>
                            </div>
                        );
                    })}
                    {(analysis.urls?.length || 0) > 5 && (
                        <div className="inline-flex items-center px-2 py-1.5 bg-violet-50 border border-violet-100 rounded-[8px] text-[12px] text-violet-600 font-bold">
                            +{analysis.urls.length - 5}
                        </div>
                    )}
                </div>
            )}
        </motion.div>
    );
};

export default AnalysisCard;

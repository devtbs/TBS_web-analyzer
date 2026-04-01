import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
    ClockIcon,
    GlobeAltIcon,
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
        if (err) return <GlobeAltIcon style={{ width: size, height: size }} className="text-slate-300" />;
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
        return <GlobeAltIcon style={{ width: size, height: size }} className="text-slate-300" />;
    }
};

/* ── Inline rename ──────────────────────────────────────────── */
const RenameInput = ({ analysisId, currentLabel, onSaved, onCancel }) => {
    const [value, setValue] = useState(currentLabel || '');
    const inputRef = useRef(null);

    useEffect(() => { inputRef.current?.focus(); inputRef.current?.select(); }, []);

    const save = async () => {
        try {
            await api.patch(`/api/analysis/${analysisId}/label`, { label: value });
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
                className="flex-1 min-w-0 px-3 py-1.5 rounded-lg border border-emerald-200 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100/50 text-sm font-semibold text-slate-800 bg-white outline-none transition-all"
            />
            <button onClick={save} className="flex-shrink-0 p-1.5 rounded-lg bg-emerald-500 text-white hover:bg-emerald-600 transition-colors">
                <CheckIcon className="w-4 h-4" />
            </button>
            <button onClick={onCancel} className="flex-shrink-0 p-1.5 rounded-lg bg-white border border-slate-200 text-slate-400 hover:text-rose-500 hover:border-rose-200 hover:bg-rose-50 transition-all">
                <XMarkIcon className="w-4 h-4" />
            </button>
        </div>
    );
};

/* ── Status badge ───────────────────────────────────────────── */
const StatusBadge = ({ status }) => {
    if (status === 'completed') return (
        <span className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-emerald-50 text-emerald-700 rounded-lg text-[12px] font-bold border border-emerald-200/60 leading-none">
            <SolidCheckCircle className="w-3.5 h-3.5" /> Completed
        </span>
    );
    if (status === 'failed') return (
        <span className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-rose-50 text-rose-700 rounded-lg text-[12px] font-bold border border-rose-200/60 leading-none">
            <ExclamationCircleIcon className="w-3.5 h-3.5" /> Failed
        </span>
    );
    // Any processing state (processing, scraping, fetching)
    return (
        <span className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-indigo-50 text-indigo-700 rounded-lg text-[12px] font-bold border border-indigo-200/60 leading-none animate-pulse">
            <SparklesIcon className="w-3.5 h-3.5" /> Analyzing...
        </span>
    );
};

const formatDate = (dateString) => {
    if (!dateString) return '';
    let normalized = dateString;
    if (dateString.includes('T') && !dateString.includes('Z') && !dateString.includes('+')) {
        normalized = dateString + 'Z';
    }
    const date = new Date(normalized);
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
            exit={{ opacity: 0, scale: 0.98, transition: { duration: 0.2 } }}
            transition={{ delay: (index || 0) * 0.04, duration: 0.3 }}
            className="group bg-white rounded-[14px] border border-slate-200/60 shadow-sm hover:shadow-md hover:border-emerald-200 transition-all duration-300 overflow-hidden flex flex-col p-4 sm:p-5 gap-3 w-full"
        >
            {/* ── Top row ── */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="flex items-start gap-4 min-w-0">
                    {/* Avatar */}
                    <div className="relative flex-shrink-0 mt-0.5">
                        <div className="w-11 h-11 bg-gradient-to-br from-emerald-400 to-teal-500 rounded-xl flex items-center justify-center shadow-sm">
                            <GlobeAltIcon className="w-5 h-5 text-white" />
                        </div>
                        <div className="absolute -bottom-1.5 -right-1.5 w-[22px] h-[22px] rounded-full bg-slate-50 border-2 border-white flex items-center justify-center shadow-sm">
                            <span className="text-[9px] font-black text-slate-600 leading-none">
                                {analysis.urls?.length || 0}
                            </span>
                        </div>
                    </div>

                    {/* Title + Timestamp */}
                    <div className="flex flex-col gap-1 min-w-0">
                        {isEditing ? (
                            <div className="flex-1 min-w-0 mb-1">
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
                            <div className="flex items-center gap-2 min-w-0 group/name">
                                <h3 className="text-[15px] font-bold text-slate-800 truncate leading-tight">
                                    {getDisplayName(analysis)}
                                </h3>
                                {!analysis.label && (
                                    <span className="text-[10px] font-bold text-slate-400 bg-slate-100/80 px-1.5 py-0.5 rounded flex-shrink-0 leading-none">
                                        auto
                                    </span>
                                )}
                                <button
                                    onClick={() => setIsEditing(true)}
                                    title="Rename"
                                    className="p-1 rounded-md text-slate-300 hover:text-emerald-600 hover:bg-emerald-50 opacity-0 group-hover/name:opacity-100 transition-all flex-shrink-0"
                                >
                                    <PencilIcon className="w-3.5 h-3.5" />
                                </button>
                            </div>
                        )}
                        <div className="flex items-center gap-1.5 text-[12px] font-medium text-slate-400 mt-0.5">
                            <ClockIcon className="w-3.5 h-3.5" />
                            {formatDate(analysis.created_at)}
                        </div>
                    </div>
                </div>

                {/* ── Actions ── */}
                <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5 flex-shrink-0 ml-[60px] sm:ml-0 mt-3 sm:mt-0">
                    {/* Only show badge for failure; success/processing used the button below */}
                    {analysis.status === 'failed' && <StatusBadge status={analysis.status} />}

                    {/* View/Processing Button */}
                    {analysis.status === 'completed' && (
                        <button
                            onClick={() => navigate(`/results/${analysis.analysis_id}`)}
                            className="inline-flex flex-1 sm:flex-none items-center justify-center gap-1.5 px-4 py-2 rounded-lg text-[13px] font-bold text-slate-800 bg-white border border-slate-200 hover:bg-slate-50 hover:border-slate-300 transition-colors shadow-sm"
                        >
                            <CheckIcon className="w-3.5 h-3.5 stroke-2 text-emerald-500" />
                            View Results
                        </button>
                    )}
                    {['processing', 'fetching', 'scraping'].includes(analysis.status) && (
                        <button
                            onClick={() => navigate(`/results/${analysis.analysis_id}`)}
                            className="inline-flex flex-1 sm:flex-none items-center justify-center gap-1.5 px-4 py-2 rounded-lg text-[13px] font-bold text-indigo-700 bg-indigo-50 border border-indigo-100 hover:bg-indigo-100 transition-colors"
                        >
                            <SparklesIcon className="w-3.5 h-3.5 animate-spin" />
                            Analyzing...
                        </button>
                    )}

                    {/* Delete Button */}
                    <button
                        onClick={() => {
                            if (onDelete) onDelete(analysis.analysis_id);
                        }}
                        title="Delete"
                        className="inline-flex flex-1 sm:flex-none items-center justify-center p-2 rounded-lg text-slate-400 hover:text-rose-500 border border-slate-200 hover:bg-rose-50 hover:border-rose-200 transition-colors shadow-sm bg-white"
                    >
                        <TrashIcon className="w-[18px] h-[18px]" />
                    </button>
                </div>
            </div>

            {/* ── Bottom row: URL pills ── */}
            {(analysis.urls?.length || 0) > 0 && (
                <div className="flex flex-wrap gap-2 pt-2 border-t border-slate-100 mt-1 pl-[60px]">
                    {(analysis.urls || []).slice(0, 4).map((url, i) => {
                        let host = url;
                        try { host = new URL(url).hostname.replace('www.', ''); } catch {}
                        return (
                            <div key={i} className="inline-flex items-center gap-1.5 px-2 py-1 bg-slate-50 border border-slate-100/80 rounded block max-w-[150px] group/pill hover:bg-emerald-50 hover:border-emerald-200/50 transition-colors cursor-default">
                                <Favicon url={url} size={12} />
                                <span className="text-[11px] text-slate-500 font-semibold group-hover/pill:text-emerald-700 truncate min-w-0">
                                    {host}
                                </span>
                            </div>
                        );
                    })}
                    {(analysis.urls?.length || 0) > 4 && (
                        <div className="inline-flex items-center px-2 py-1 bg-slate-50 border border-slate-200/50 rounded text-[11px] text-slate-500 font-bold">
                            +{analysis.urls.length - 4} URLs
                        </div>
                    )}
                </div>
            )}
        </motion.div>
    );
};

export default AnalysisCard;

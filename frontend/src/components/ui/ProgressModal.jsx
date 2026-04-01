import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
    GlobeAltIcon,
    ChartBarIcon,
    DocumentTextIcon,
    ArrowsRightLeftIcon,
    CheckIcon,
    XMarkIcon,
    ClockIcon,
    SparklesIcon,
} from '@heroicons/react/24/outline';

const ProgressModal = ({ analysisId, onComplete, onError }) => {
    const [progress, setProgress] = useState({
        current_step: 0,
        total_steps: 5,
        status: 'starting',
        message: 'Initializing analysis...',
        percentage: 0
    });
    const [isVisible, setIsVisible] = useState(true);

    useEffect(() => {
        if (!analysisId) return;
        const token = localStorage.getItem('access_token');
        let baseURL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000';
        
        // Ensure baseURL is absolute for EventSource
        if (!baseURL.startsWith('http')) {
            const isProd = !window.location.hostname.includes('localhost');
            baseURL = isProd ? 'https://api.phyominthein.com' : `http://${window.location.hostname}:8000`;
        }

        const eventSource = new EventSource(
            `${baseURL.replace(/\/$/, '')}/api/progress/${analysisId}?token=${encodeURIComponent(token)}`
        );

        eventSource.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                setProgress(data);

                if (data.status === 'complete') {
                    setTimeout(() => {
                        setIsVisible(false);
                        eventSource.close();
                        if (onComplete) onComplete();
                    }, 1500);
                }

                if (data.status === 'failed') {
                    setTimeout(() => {
                        eventSource.close();
                        if (onError) onError(data.message);
                    }, 2000);
                }
            } catch (error) {
                console.error('Error parsing progress data:', error);
            }
        };

        eventSource.onerror = (error) => {
            console.error('SSE Error:', error);
            eventSource.close();
        };

        return () => eventSource.close();
    }, [analysisId, onComplete, onError]);

    const steps = [
        { id: 1, label: 'Scraping',        icon: GlobeAltIcon,        description: 'Extracting website content' },
        { id: 2, label: 'Knowledge Graph', icon: ChartBarIcon,         description: 'Building entity relationships' },
        { id: 3, label: 'Topical Maps',    icon: DocumentTextIcon,     description: 'Creating content strategy' },
        { id: 4, label: 'Comparison',      icon: ArrowsRightLeftIcon,  description: 'Analyzing competitors' },
        { id: 5, label: 'Finalizing',      icon: CheckIcon,            description: 'Saving results' },
    ];

    if (!isVisible) return null;

    const isComplete = progress.status === 'complete';
    const isFailed   = progress.status === 'failed';

    return (
        <AnimatePresence>
            {/* ── Backdrop ── */}
            <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="fixed inset-0 z-50 flex items-center justify-center p-4"
                style={{ background: 'rgba(15,12,30,0.55)', backdropFilter: 'blur(20px)' }}
            >
                {/* ── Card ── */}
                <motion.div
                    initial={{ scale: 0.95, opacity: 0, y: 20 }}
                    animate={{ scale: 1, opacity: 1, y: 0 }}
                    exit={{ scale: 0.95, opacity: 0, y: 20 }}
                    transition={{ type: 'spring', duration: 0.5, bounce: 0.2 }}
                    className="relative w-full max-w-[460px] bg-white rounded-[28px] overflow-hidden"
                    style={{
                        boxShadow: '0 32px 80px rgba(0,0,0,0.14), 0 8px 24px rgba(0,0,0,0.08)',
                        border: '1px solid rgba(226,232,240,0.8)',
                    }}
                >
                    {/* ── Animated top progress stripe ── */}
                    <div className="relative h-1 bg-slate-100 overflow-hidden">
                        <motion.div
                            initial={{ width: 0 }}
                            animate={{ width: `${progress.percentage}%` }}
                            transition={{ duration: 0.7, ease: 'easeOut' }}
                            className="absolute inset-y-0 left-0 rounded-full"
                            style={{
                                background: isComplete
                                    ? 'linear-gradient(90deg, #10b981, #34d399)'
                                    : isFailed
                                    ? 'linear-gradient(90deg, #ef4444, #f87171)'
                                    : 'linear-gradient(90deg, #7c3aed, #a855f7, #c084fc)',
                            }}
                        >
                            {!isComplete && !isFailed && (
                                <motion.div
                                    className="absolute inset-0"
                                    style={{ background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.5), transparent)' }}
                                    animate={{ x: ['-100%', '200%'] }}
                                    transition={{ duration: 1.6, repeat: Infinity, ease: 'linear' }}
                                />
                            )}
                        </motion.div>
                    </div>

                    {/* ── Header ── */}
                    <div className="px-7 pt-6 pb-4">
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3">
                                {/* Icon */}
                                <motion.div
                                    animate={!isComplete && !isFailed ? { rotate: [0, 12, -12, 0] } : {}}
                                    transition={{ duration: 3.5, repeat: Infinity, ease: 'easeInOut' }}
                                    className="flex items-center justify-center w-10 h-10 rounded-[14px] flex-shrink-0"
                                    style={{
                                        background: isComplete
                                            ? 'linear-gradient(135deg, #d1fae5, #a7f3d0)'
                                            : isFailed
                                            ? 'linear-gradient(135deg, #fee2e2, #fecaca)'
                                            : 'linear-gradient(135deg, #ede9fe, #ddd6fe)',
                                        border: isComplete
                                            ? '1px solid #6ee7b7'
                                            : isFailed
                                            ? '1px solid #fca5a5'
                                            : '1px solid #c4b5fd',
                                    }}
                                >
                                    {isComplete ? (
                                        <CheckIcon className="w-5 h-5 text-emerald-600" />
                                    ) : isFailed ? (
                                        <XMarkIcon className="w-5 h-5 text-red-500" />
                                    ) : (
                                        <SparklesIcon className="w-5 h-5 text-violet-600" />
                                    )}
                                </motion.div>

                                <div>
                                    <h3 className="text-[17px] font-bold text-slate-800 tracking-tight leading-tight">
                                        {isComplete ? 'Analysis Complete!' : isFailed ? 'Analysis Failed' : 'AI Processing'}
                                    </h3>
                                    <p className="text-[13px] text-slate-400 mt-0.5">
                                        {isComplete
                                            ? 'Redirecting to your results…'
                                            : isFailed
                                            ? 'Something went wrong'
                                            : 'Please keep this window open'}
                                    </p>
                                </div>
                            </div>

                            {/* Percentage badge */}
                            <motion.div
                                key={progress.percentage}
                                initial={{ opacity: 0, scale: 0.85 }}
                                animate={{ opacity: 1, scale: 1 }}
                                className="text-right flex-shrink-0"
                            >
                                <div
                                    className="text-[22px] font-black tracking-tight leading-none"
                                    style={{
                                        background: isComplete
                                            ? 'linear-gradient(135deg, #10b981, #059669)'
                                            : isFailed
                                            ? 'linear-gradient(135deg, #ef4444, #dc2626)'
                                            : 'linear-gradient(135deg, #7c3aed, #a855f7)',
                                        WebkitBackgroundClip: 'text',
                                        WebkitTextFillColor: 'transparent',
                                    }}
                                >
                                    {progress.percentage}%
                                </div>
                            </motion.div>
                        </div>

                        {/* Current message */}
                        <div className="mt-4 flex items-start gap-2">
                            <div className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-100 rounded-[12px]">
                                <p className="text-[13px] text-slate-600 font-medium leading-relaxed">
                                    {progress.message}
                                </p>
                            </div>
                        </div>
                    </div>

                    {/* ── Divider ── */}
                    <div className="mx-7 h-px bg-slate-100" />

                    {/* ── Steps ── */}
                    <div className="px-5 py-4 flex flex-col gap-1">
                        {steps.map((step, index) => {
                            const Icon = step.icon;
                            const isActive     = step.id === progress.current_step;
                            const isStepDone   = step.id < progress.current_step || isComplete;
                            const isStepFailed = isFailed && step.id === progress.current_step;
                            const isPending    = !isActive && !isStepDone && !isStepFailed;

                            return (
                                <motion.div
                                    key={step.id}
                                    initial={{ opacity: 0, x: -10 }}
                                    animate={{ opacity: 1, x: 0 }}
                                    transition={{ delay: index * 0.05, type: 'spring', stiffness: 280 }}
                                    className="flex items-center gap-3 px-3 py-2.5 rounded-[14px] transition-all duration-300"
                                    style={{
                                        background: isActive
                                            ? 'rgba(124,58,237,0.06)'
                                            : isStepFailed
                                            ? 'rgba(239,68,68,0.05)'
                                            : 'transparent',
                                        border: isActive
                                            ? '1px solid rgba(124,58,237,0.14)'
                                            : isStepFailed
                                            ? '1px solid rgba(239,68,68,0.14)'
                                            : '1px solid transparent',
                                    }}
                                >
                                    {/* Step icon */}
                                    <div className="relative flex-shrink-0">
                                        <motion.div
                                            animate={isActive && !isStepFailed ? { scale: [1, 1.08, 1] } : {}}
                                            transition={{ duration: 2, repeat: Infinity }}
                                            className="w-8 h-8 rounded-[10px] flex items-center justify-center transition-all duration-300"
                                            style={{
                                                background: isPending
                                                    ? '#f8fafc'
                                                    : isStepDone
                                                    ? '#dcfce7'
                                                    : isStepFailed
                                                    ? '#fee2e2'
                                                    : '#ede9fe',
                                                border: isPending
                                                    ? '1px solid #e2e8f0'
                                                    : isStepDone
                                                    ? '1px solid #bbf7d0'
                                                    : isStepFailed
                                                    ? '1px solid #fca5a5'
                                                    : '1px solid #ddd6fe',
                                                boxShadow: isActive ? '0 0 12px rgba(124,58,237,0.2)' : isStepDone ? '0 0 8px rgba(16,185,129,0.15)' : 'none',
                                            }}
                                        >
                                            {isStepDone ? (
                                                <CheckIcon className="w-4 h-4 text-emerald-600" />
                                            ) : isStepFailed ? (
                                                <XMarkIcon className="w-4 h-4 text-red-500" />
                                            ) : (
                                                <Icon
                                                    className="w-4 h-4 transition-colors"
                                                    style={{ color: isPending ? '#cbd5e1' : '#7c3aed' }}
                                                />
                                            )}
                                        </motion.div>

                                        {/* Pulse ring for active */}
                                        {isActive && !isStepFailed && (
                                            <motion.div
                                                className="absolute inset-0 rounded-[10px]"
                                                style={{ border: '1.5px solid rgba(124,58,237,0.4)' }}
                                                initial={{ opacity: 0.7, scale: 1 }}
                                                animate={{ opacity: 0, scale: 1.5 }}
                                                transition={{ duration: 1.5, repeat: Infinity }}
                                            />
                                        )}
                                    </div>

                                    {/* Step connector line */}
                                    <div className="flex-1 min-w-0">
                                        <p
                                            className="text-[13.5px] font-semibold leading-none transition-colors duration-300"
                                            style={{ color: isPending ? '#94a3b8' : '#1e293b' }}
                                        >
                                            {step.label}
                                        </p>
                                        <p
                                            className="text-[12px] mt-1 transition-colors duration-300"
                                            style={{ color: isPending ? '#cbd5e1' : '#64748b' }}
                                        >
                                            {step.description}
                                        </p>
                                    </div>

                                    {/* Right indicator */}
                                    <div className="flex-shrink-0 flex items-center">
                                        {isActive && !isStepFailed && (
                                            <div className="flex gap-1">
                                                {[0, 1, 2].map(i => (
                                                    <motion.div
                                                        key={i}
                                                        className="w-1.5 h-1.5 rounded-full bg-violet-500"
                                                        animate={{ opacity: [0.2, 1, 0.2], scale: [0.8, 1.2, 0.8] }}
                                                        transition={{ duration: 1.2, repeat: Infinity, delay: i * 0.2 }}
                                                    />
                                                ))}
                                            </div>
                                        )}
                                        {isStepDone && !isComplete && (
                                            <motion.div
                                                initial={{ scale: 0 }}
                                                animate={{ scale: 1 }}
                                                transition={{ type: 'spring', stiffness: 450 }}
                                                className="w-5 h-5 rounded-full bg-emerald-500 flex items-center justify-center"
                                            >
                                                <CheckIcon className="w-3 h-3 text-white" />
                                            </motion.div>
                                        )}
                                        {isPending && (
                                            <div className="w-5 h-5 rounded-full border-2 border-slate-200" />
                                        )}
                                    </div>
                                </motion.div>
                            );
                        })}
                    </div>

                    {/* ── Footer status banner ── */}
                    <AnimatePresence>
                        {(isComplete || isFailed) && (
                            <motion.div
                                key="footer"
                                initial={{ opacity: 0, height: 0 }}
                                animate={{ opacity: 1, height: 'auto' }}
                                exit={{ opacity: 0, height: 0 }}
                                className="mx-5 mb-5 overflow-hidden"
                            >
                                <div
                                    className="px-4 py-3 rounded-[14px] flex items-center justify-center gap-2"
                                    style={{
                                        background: isComplete
                                            ? 'linear-gradient(135deg, #d1fae5, #ecfdf5)'
                                            : 'linear-gradient(135deg, #fee2e2, #fff1f2)',
                                        border: isComplete ? '1px solid #a7f3d0' : '1px solid #fca5a5',
                                    }}
                                >
                                    {isComplete ? (
                                        <CheckIcon className="w-4 h-4 text-emerald-600 flex-shrink-0" />
                                    ) : (
                                        <XMarkIcon className="w-4 h-4 text-red-500 flex-shrink-0" />
                                    )}
                                    <p
                                        className="text-[13px] font-semibold"
                                        style={{ color: isComplete ? '#059669' : '#dc2626' }}
                                    >
                                        {isComplete ? 'Redirecting to your results…' : progress.message}
                                    </p>
                                </div>
                            </motion.div>
                        )}
                    </AnimatePresence>
                </motion.div>
            </motion.div>
        </AnimatePresence>
    );
};

export default ProgressModal;

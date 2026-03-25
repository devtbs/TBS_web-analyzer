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
    const [startTime] = useState(Date.now());
    const [estimatedTime, setEstimatedTime] = useState(null);

    useEffect(() => {
        if (!analysisId) return;
        const token = localStorage.getItem('access_token');
        const eventSource = new EventSource(
            `/api/progress/${analysisId}?token=${encodeURIComponent(token)}`
        );

        eventSource.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                setProgress(data);

                if (data.current_step > 0 && data.current_step < data.total_steps) {
                    const elapsed = (Date.now() - startTime) / 1000;
                    const avgTimePerStep = elapsed / data.current_step;
                    const remainingSteps = data.total_steps - data.current_step;
                    setEstimatedTime(Math.ceil(avgTimePerStep * remainingSteps));
                }

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
    }, [analysisId, onComplete, onError, startTime]);

    const steps = [
        { id: 1, label: 'Scraping',       icon: GlobeAltIcon,        description: 'Extracting website content' },
        { id: 2, label: 'Knowledge Graph', icon: ChartBarIcon,         description: 'Building entity relationships' },
        { id: 3, label: 'Topical Maps',    icon: DocumentTextIcon,     description: 'Creating content strategy' },
        { id: 4, label: 'Comparison',      icon: ArrowsRightLeftIcon,  description: 'Analyzing competitors' },
        { id: 5, label: 'Finalizing',      icon: CheckIcon,            description: 'Saving results' },
    ];

    const formatTime = (seconds) => {
        if (!seconds) return '';
        if (seconds < 60) return `~${seconds}s`;
        return `~${Math.floor(seconds / 60)}m ${seconds % 60}s`;
    };

    if (!isVisible) return null;

    const isComplete = progress.status === 'complete';
    const isFailed   = progress.status === 'failed';

    /* ── colour tokens ── */
    const accent   = isComplete ? '#10b981' : isFailed ? '#ef4444' : '#8b5cf6';
    const accentEnd = isComplete ? '#059669' : isFailed ? '#dc2626' : '#a855f7';

    return (
        <AnimatePresence>
            {/* ── Backdrop ── */}
            <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="fixed inset-0 z-50 flex items-center justify-center p-4"
                style={{ background: 'rgba(8,8,20,0.80)', backdropFilter: 'blur(18px)' }}
            >
                {/* Decorative glow blobs */}
                <div className="absolute inset-0 overflow-hidden pointer-events-none">
                    <div style={{
                        position: 'absolute', top: '20%', left: '30%',
                        width: 500, height: 500, borderRadius: '50%',
                        background: 'radial-gradient(circle, rgba(139,92,246,0.18) 0%, transparent 70%)',
                        filter: 'blur(40px)',
                    }} />
                    <div style={{
                        position: 'absolute', bottom: '15%', right: '25%',
                        width: 400, height: 400, borderRadius: '50%',
                        background: 'radial-gradient(circle, rgba(168,85,247,0.12) 0%, transparent 70%)',
                        filter: 'blur(40px)',
                    }} />
                </div>

                {/* ── Card ── */}
                <motion.div
                    initial={{ scale: 0.94, opacity: 0, y: 24 }}
                    animate={{ scale: 1, opacity: 1, y: 0 }}
                    exit={{ scale: 0.94, opacity: 0, y: 24 }}
                    transition={{ type: 'spring', duration: 0.55, bounce: 0.25 }}
                    style={{
                        background: 'rgba(15,15,30,0.85)',
                        border: '1px solid rgba(255,255,255,0.08)',
                        backdropFilter: 'blur(24px)',
                        boxShadow: `0 40px 80px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.04), inset 0 1px 0 rgba(255,255,255,0.06)`,
                    }}
                    className="relative w-full max-w-[440px] rounded-3xl overflow-hidden"
                >

                    {/* ── Top gradient bar ── */}
                    <div style={{
                        height: 3,
                        background: `linear-gradient(90deg, ${accent}, ${accentEnd}, #ec4899)`,
                        opacity: 0.9,
                    }} />

                    {/* ── Header ── */}
                    <div className="px-7 pt-7 pb-5">
                        <div className="flex items-center gap-3 mb-1">
                            <motion.div
                                animate={!isComplete && !isFailed ? { rotate: [0, 15, -15, 0] } : {}}
                                transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
                                style={{
                                    width: 38, height: 38, borderRadius: 12,
                                    background: `linear-gradient(135deg, ${accent}33, ${accentEnd}22)`,
                                    border: `1px solid ${accent}44`,
                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    flexShrink: 0,
                                }}
                            >
                                {isComplete ? (
                                    <CheckIcon style={{ width: 20, height: 20, color: accent }} />
                                ) : isFailed ? (
                                    <XMarkIcon style={{ width: 20, height: 20, color: accent }} />
                                ) : (
                                    <SparklesIcon style={{ width: 20, height: 20, color: accent }} />
                                )}
                            </motion.div>
                            <div>
                                <h3 style={{ fontSize: 18, fontWeight: 700, color: '#f1f5f9', lineHeight: 1.2, letterSpacing: '-0.3px' }}>
                                    {isComplete ? 'Analysis Complete' : isFailed ? 'Analysis Failed' : 'AI Processing'}
                                </h3>
                            </div>
                        </div>

                        <p style={{ fontSize: 13.5, color: '#94a3b8', marginTop: 10, lineHeight: 1.5 }}>
                            {progress.message}
                        </p>

                        {/* Time estimate pill */}
                        {!isComplete && !isFailed && estimatedTime && (
                            <motion.div
                                initial={{ opacity: 0, y: -6 }}
                                animate={{ opacity: 1, y: 0 }}
                                style={{
                                    display: 'inline-flex', alignItems: 'center', gap: 6,
                                    marginTop: 12, padding: '4px 10px', borderRadius: 999,
                                    background: 'rgba(255,255,255,0.05)',
                                    border: '1px solid rgba(255,255,255,0.08)',
                                }}
                            >
                                <ClockIcon style={{ width: 13, height: 13, color: '#64748b' }} />
                                <span style={{ fontSize: 12, color: '#64748b', fontWeight: 500 }}>
                                    {formatTime(estimatedTime)} remaining
                                </span>
                            </motion.div>
                        )}
                    </div>

                    {/* ── Progress bar ── */}
                    <div className="px-7 pb-5">
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                            <span style={{ fontSize: 11.5, fontWeight: 600, color: '#475569', letterSpacing: '0.06em', textTransform: 'uppercase' }}>Progress</span>
                            <motion.span
                                key={progress.percentage}
                                initial={{ opacity: 0, y: -4 }}
                                animate={{ opacity: 1, y: 0 }}
                                style={{ fontSize: 13, fontWeight: 700, color: accent }}
                            >
                                {progress.percentage}%
                            </motion.span>
                        </div>
                        <div style={{ height: 6, background: 'rgba(255,255,255,0.07)', borderRadius: 999, overflow: 'hidden', position: 'relative' }}>
                            <motion.div
                                initial={{ width: 0 }}
                                animate={{ width: `${progress.percentage}%` }}
                                transition={{ duration: 0.6, ease: 'easeOut' }}
                                style={{
                                    height: '100%', borderRadius: 999, position: 'relative',
                                    background: `linear-gradient(90deg, ${accent}, ${accentEnd})`,
                                    boxShadow: `0 0 12px ${accent}88`,
                                }}
                            >
                                {!isComplete && !isFailed && (
                                    <motion.div
                                        style={{
                                            position: 'absolute', inset: 0,
                                            background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.35), transparent)',
                                        }}
                                        animate={{ x: ['-100%', '200%'] }}
                                        transition={{ duration: 1.8, repeat: Infinity, ease: 'linear' }}
                                    />
                                )}
                            </motion.div>
                        </div>
                    </div>

                    {/* ── Divider ── */}
                    <div style={{ height: 1, background: 'rgba(255,255,255,0.05)', marginInline: 28 }} />

                    {/* ── Steps ── */}
                    <div style={{ padding: '20px 28px 24px' }}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                            {steps.map((step, index) => {
                                const Icon = step.icon;
                                const isActive      = step.id === progress.current_step;
                                const isStepDone    = step.id < progress.current_step || isComplete;
                                const isStepFailed  = isFailed && step.id === progress.current_step;
                                const isPending     = !isActive && !isStepDone && !isStepFailed;

                                const stepAccent = isStepFailed ? '#ef4444' : isStepDone ? '#10b981' : '#8b5cf6';

                                return (
                                    <motion.div
                                        key={step.id}
                                        initial={{ opacity: 0, x: -16 }}
                                        animate={{ opacity: 1, x: 0 }}
                                        transition={{ delay: index * 0.06, type: 'spring', stiffness: 260 }}
                                        style={{
                                            display: 'flex', alignItems: 'center', gap: 14,
                                            padding: '10px 12px',
                                            borderRadius: 14,
                                            background: isActive ? 'rgba(139,92,246,0.08)' : 'transparent',
                                            border: isActive ? '1px solid rgba(139,92,246,0.18)' : '1px solid transparent',
                                            transition: 'background 0.3s, border 0.3s',
                                        }}
                                    >
                                        {/* Icon bubble */}
                                        <div style={{ position: 'relative', flexShrink: 0 }}>
                                            <motion.div
                                                animate={isActive && !isStepFailed ? { scale: [1, 1.06, 1] } : {}}
                                                transition={{ duration: 2.5, repeat: Infinity }}
                                                style={{
                                                    width: 36, height: 36, borderRadius: 10,
                                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                    background: isPending
                                                        ? 'rgba(255,255,255,0.04)'
                                                        : `linear-gradient(135deg, ${stepAccent}30, ${stepAccent}18)`,
                                                    border: isPending
                                                        ? '1px solid rgba(255,255,255,0.07)'
                                                        : `1px solid ${stepAccent}40`,
                                                    boxShadow: (isActive || isStepDone) ? `0 0 14px ${stepAccent}30` : 'none',
                                                    transition: 'all 0.4s',
                                                }}
                                            >
                                                {isStepDone ? (
                                                    <CheckIcon style={{ width: 16, height: 16, color: stepAccent }} />
                                                ) : isStepFailed ? (
                                                    <XMarkIcon style={{ width: 16, height: 16, color: stepAccent }} />
                                                ) : (
                                                    <Icon style={{ width: 16, height: 16, color: isPending ? '#334155' : stepAccent }} />
                                                )}
                                            </motion.div>

                                            {/* Pulse ring for active */}
                                            {isActive && !isStepFailed && (
                                                <motion.div
                                                    style={{
                                                        position: 'absolute', inset: -3, borderRadius: 13,
                                                        border: '1.5px solid rgba(139,92,246,0.5)',
                                                    }}
                                                    initial={{ opacity: 0.6, scale: 1 }}
                                                    animate={{ opacity: 0, scale: 1.45 }}
                                                    transition={{ duration: 1.6, repeat: Infinity }}
                                                />
                                            )}
                                        </div>

                                        {/* Text */}
                                        <div style={{ flex: 1, minWidth: 0 }}>
                                            <p style={{
                                                fontSize: 13.5, fontWeight: 600, lineHeight: 1,
                                                color: isPending ? '#475569' : '#e2e8f0',
                                                transition: 'color 0.3s',
                                            }}>
                                                {step.label}
                                            </p>
                                            <p style={{
                                                fontSize: 12, marginTop: 3, lineHeight: 1,
                                                color: isPending ? '#334155' : '#64748b',
                                                transition: 'color 0.3s',
                                            }}>
                                                {step.description}
                                            </p>
                                        </div>

                                        {/* Active dots */}
                                        {isActive && !isStepFailed && (
                                            <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                                                {[0, 1, 2].map(i => (
                                                    <motion.div
                                                        key={i}
                                                        style={{ width: 5, height: 5, borderRadius: '50%', background: accent }}
                                                        animate={{ opacity: [0.2, 1, 0.2], scale: [0.8, 1.2, 0.8] }}
                                                        transition={{ duration: 1.4, repeat: Infinity, delay: i * 0.22 }}
                                                    />
                                                ))}
                                            </div>
                                        )}

                                        {/* Done check badge */}
                                        {isStepDone && !isComplete && (
                                            <motion.div
                                                initial={{ scale: 0 }}
                                                animate={{ scale: 1 }}
                                                transition={{ type: 'spring', stiffness: 400 }}
                                                style={{
                                                    width: 18, height: 18, borderRadius: '50%',
                                                    background: '#10b981',
                                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                    flexShrink: 0,
                                                }}
                                            >
                                                <CheckIcon style={{ width: 10, height: 10, color: '#fff' }} />
                                            </motion.div>
                                        )}
                                    </motion.div>
                                );
                            })}
                        </div>
                    </div>

                    {/* ── Footer banners ── */}
                    <AnimatePresence>
                        {(isComplete || isFailed) && (
                            <motion.div
                                key="footer"
                                initial={{ opacity: 0, height: 0 }}
                                animate={{ opacity: 1, height: 'auto' }}
                                exit={{ opacity: 0, height: 0 }}
                                style={{
                                    background: isComplete
                                        ? 'linear-gradient(90deg, rgba(16,185,129,0.12), rgba(5,150,105,0.08))'
                                        : 'linear-gradient(90deg, rgba(239,68,68,0.12), rgba(220,38,38,0.08))',
                                    borderTop: `1px solid ${isComplete ? 'rgba(16,185,129,0.2)' : 'rgba(239,68,68,0.2)'}`,
                                    padding: '14px 28px',
                                }}
                            >
                                <p style={{
                                    fontSize: 13, fontWeight: 600,
                                    color: isComplete ? '#34d399' : '#f87171',
                                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                                }}>
                                    {isComplete
                                        ? <><CheckIcon style={{ width: 15, height: 15 }} /> Redirecting to your results…</>
                                        : <><XMarkIcon style={{ width: 15, height: 15 }} />{progress.message}</>
                                    }
                                </p>
                            </motion.div>
                        )}
                    </AnimatePresence>
                </motion.div>
            </motion.div>
        </AnimatePresence>
    );
};

export default ProgressModal;

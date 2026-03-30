import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import api from '../api/axios';
import toast from 'react-hot-toast';
import KnowledgeGraph from '../components/visualizations/KnowledgeGraph';
import TopicalMap from '../components/visualizations/TopicalMap';
import Comparison from '../components/visualizations/Comparison';
import {
    ChartBarIcon,
    GlobeAltIcon,
    ScaleIcon,
    ArrowLeftIcon,
    SparklesIcon,
    CheckCircleIcon,
    ArrowTopRightOnSquareIcon,
    RocketLaunchIcon,
    BoltIcon,
} from '@heroicons/react/24/outline';
import { CheckCircleIcon as SolidCheck } from '@heroicons/react/24/solid';

/* ── Favicon ─────────────────────────────────────────────────── */
const Favicon = ({ url, size = 16 }) => {
    const [err, setErr] = useState(false);
    try {
        const host = new URL(url).hostname;
        if (err) return <GlobeAltIcon style={{ width: size, height: size }} className="text-violet-400" />;
        return (
            <img
                src={`https://www.google.com/s2/favicons?domain=${host}&sz=32`}
                alt="" width={size} height={size}
                className="rounded-sm object-contain flex-shrink-0"
                onError={() => setErr(true)}
            />
        );
    } catch {
        return <GlobeAltIcon style={{ width: size, height: size }} className="text-violet-400" />;
    }
};

/* ── Custom Tab Bar ──────────────────────────────────────────── */
const TabBar = ({ tabs, activeTab, onTabChange }) => (
    <div className="flex gap-1 p-1 bg-slate-100 rounded-2xl">
        {tabs.map((tab, i) => (
            <button
                key={i}
                onClick={() => onTabChange(i)}
                className={`relative flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold transition-all duration-200 ${
                    activeTab === i
                        ? 'text-white shadow-md'
                        : 'text-slate-500 hover:text-slate-800 hover:bg-white/60'
                }`}
            >
                {activeTab === i && (
                    <motion.div
                        layoutId="tab-indicator"
                        className="absolute inset-0 rounded-xl bg-gradient-to-r from-violet-600 to-purple-600"
                        transition={{ type: 'spring', bounce: 0.2, duration: 0.5 }}
                    />
                )}
                <span className="relative z-10 flex items-center gap-2">
                    {tab.icon}
                    {tab.label}
                </span>
            </button>
        ))}
    </div>
);

/* ── Stat card ───────────────────────────────────────────────── */
const StatCard = ({ icon, label, value, gradient, delay = 0 }) => (
    <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay, duration: 0.4 }}
        className={`relative overflow-hidden rounded-2xl p-5 shadow-sm ${gradient}`}
    >
        <div className="flex items-center justify-between">
            <div>
                <p className="text-xs font-bold text-white/60 uppercase tracking-wider mb-1">{label}</p>
                <p className="text-3xl font-black text-white">{value}</p>
            </div>
            <div className="w-12 h-12 rounded-xl bg-white/15 flex items-center justify-center">
                {icon}
            </div>
        </div>
        <div className="absolute -bottom-3 -right-3 w-20 h-20 rounded-full bg-white/10 blur-xl" />
    </motion.div>
);

/* ── Loading Screen ──────────────────────────────────────────── */
const LoadingScreen = () => (
    <div className="min-h-screen flex items-center justify-center" style={{ background: '#f5f4fa' }}>
        <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            className="text-center px-8"
        >
            {/* Spinner */}
            <div className="relative w-24 h-24 mx-auto mb-8">
                <div className="absolute inset-0 rounded-full bg-gradient-to-tr from-violet-500 to-fuchsia-500 opacity-20 animate-ping" />
                <div className="absolute inset-2 rounded-full border-4 border-transparent border-t-violet-600 border-r-fuchsia-500 animate-spin" />
                <div className="absolute inset-0 rounded-full flex items-center justify-center">
                    <SparklesIcon className="w-8 h-8 text-violet-500" />
                </div>
            </div>

            <h2 className="text-2xl font-black text-slate-800 mb-2">Analyzing Websites</h2>
            <p className="text-slate-500 font-medium mb-1">AI is generating comprehensive insights…</p>
            <p className="text-slate-400 text-sm mb-8">This may take 10–30 seconds</p>

            <div className="flex items-center justify-center gap-2">
                {[0, 150, 300].map((delay, i) => (
                    <div
                        key={i}
                        className="w-2 h-2 rounded-full bg-violet-500 animate-bounce"
                        style={{ animationDelay: `${delay}ms` }}
                    />
                ))}
            </div>
        </motion.div>
    </div>
);

/* ── Main Results Page ───────────────────────────────────────── */
const Results = () => {
    const { analysisId } = useParams();
    const navigate = useNavigate();
    const [results, setResults] = useState(null);
    const [loading, setLoading] = useState(true);
    const [activeTab, setActiveTab] = useState(0);

    useEffect(() => { fetchResults(); }, [analysisId]);

    const fetchResults = async () => {
        try {
            const statusRes = await api.get(`/api/results/${analysisId}`);

            if (statusRes.data.status === 'processing') {
                setTimeout(fetchResults, 2000);
                return;
            }
            if (statusRes.data.status === 'failed') {
                toast.error('Analysis failed: ' + (statusRes.data.error || 'Unknown error'));
                navigate('/dashboard');
                return;
            }

            const [kgRes, topicalRes, comparisonRes] = await Promise.all([
                api.get(`/api/knowledge-graph/${analysisId}`),
                api.get(`/api/topical-map/${analysisId}`),
                api.get(`/api/compare/${analysisId}`)
                    .catch(() => ({ data: { status: 'not_applicable' } })),
            ]);

            if (kgRes.data.status === 'processing' || topicalRes.data.status === 'processing') {
                setTimeout(fetchResults, 2000);
                return;
            }

            let comparisonData = null;
            if (comparisonRes?.data) {
                comparisonData = comparisonRes.data.comparison || comparisonRes.data;
            }

            setResults({
                full: statusRes.data,
                knowledgeGraph: kgRes.data.knowledge_graph,
                topicalMaps: topicalRes.data.topical_maps,
                comparison: comparisonData,
            });
            setLoading(false);
        } catch (error) {
            console.error('Failed to fetch results:', error);
            toast.error('Failed to load results');
            navigate('/dashboard');
        }
    };

    if (loading) return <LoadingScreen />;
    if (!results) return null;

    const tabs = [
        {
            label: 'Knowledge Graph',
            icon: <ChartBarIcon className="w-4 h-4" />,
            content: <KnowledgeGraph graphData={results.knowledgeGraph} />,
        },
        {
            label: 'Topical Map',
            icon: <GlobeAltIcon className="w-4 h-4" />,
            content: <TopicalMap topicalMaps={results.topicalMaps} analysisId={analysisId} />,
        },
    ];

    if (results.comparison) {
        tabs.push({
            label: 'Comparison',
            icon: <ScaleIcon className="w-4 h-4" />,
            content: <Comparison comparisonData={results.comparison} />,
        });
    }

    const urlCount = results.full.urls?.length || 0;
    const nodeCount = results.knowledgeGraph?.nodes?.length || 0;

    return (
        <div className="min-h-screen" style={{ background: '#f5f4fa' }}>

            {/* ── Hero header band ── */}
            <div className="bg-gradient-to-r from-violet-700 via-purple-700 to-fuchsia-700 relative overflow-hidden">
                {/* Background decorations */}
                <div className="absolute inset-0 overflow-hidden pointer-events-none">
                    <div className="absolute -top-16 -right-16 w-72 h-72 rounded-full bg-white/5 blur-3xl" />
                    <div className="absolute -bottom-10 -left-10 w-56 h-56 rounded-full bg-white/5 blur-2xl" />
                    <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-24 bg-white/5 blur-3xl rotate-12" />
                </div>

                <div className="relative max-w-7xl mx-auto px-6 py-10">
                    {/* Back button */}
                    <motion.button
                        initial={{ opacity: 0, x: -10 }}
                        animate={{ opacity: 1, x: 0 }}
                        onClick={() => navigate('/history')}
                        className="flex items-center gap-2 text-white/70 hover:text-white mb-6 text-sm font-semibold transition-colors group"
                    >
                        <ArrowLeftIcon className="w-4 h-4 group-hover:-translate-x-0.5 transition-transform" />
                        Back to History
                    </motion.button>

                    <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-6">
                        <motion.div
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: 0.05 }}
                        >
                            {/* Completed pill */}
                            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/15 border border-white/20 text-white text-xs font-bold mb-4">
                                <SolidCheck className="w-3.5 h-3.5 text-emerald-300" />
                                Analysis Complete
                            </div>
                            <h1 className="text-3xl sm:text-4xl font-black text-white mb-2 leading-tight">
                                Analysis Results
                            </h1>
                            <p className="text-white/60 font-medium text-sm">
                                AI-powered semantic analysis • Groq + DeepSeek
                            </p>
                        </motion.div>

                        <motion.button
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: 0.1 }}
                            onClick={() => navigate('/dashboard')}
                            className="self-start sm:self-auto inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-white text-violet-700 font-bold text-sm shadow-lg hover:shadow-xl hover:-translate-y-0.5 transition-all duration-200"
                        >
                            <RocketLaunchIcon className="w-4 h-4" />
                            New Analysis
                        </motion.button>
                    </div>

                    {/* Stat cards inside hero */}
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-8">
                        <StatCard
                            label="Websites Analyzed"
                            value={urlCount}
                            gradient="bg-white/10 border border-white/20"
                            icon={<GlobeAltIcon className="w-6 h-6 text-white" />}
                            delay={0.1}
                        />
                        <StatCard
                            label="Total Insights"
                            value={`${nodeCount}+`}
                            gradient="bg-white/10 border border-white/20"
                            icon={<BoltIcon className="w-6 h-6 text-white" />}
                            delay={0.15}
                        />
                        <StatCard
                            label="Status"
                            value="Complete"
                            gradient="bg-white/10 border border-white/20"
                            icon={<CheckCircleIcon className="w-6 h-6 text-white" />}
                            delay={0.2}
                        />
                    </div>
                </div>
            </div>

            {/* ── Page body ── */}
            <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8 space-y-6">

                {/* ── Analyzed URLs card ── */}
                <motion.div
                    initial={{ opacity: 0, y: 16 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.25 }}
                    className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden"
                >
                    {/* Card header */}
                    <div className="flex items-center gap-3 px-6 py-4 border-b border-slate-50">
                        <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-violet-500 to-fuchsia-500 flex items-center justify-center shadow-sm shadow-violet-200">
                            <GlobeAltIcon className="w-4 h-4 text-white" />
                        </div>
                        <h2 className="font-bold text-slate-800 text-base">Analyzed URLs</h2>
                        <span className="ml-auto text-xs font-bold text-slate-400 bg-slate-100 px-2.5 py-1 rounded-full">
                            {urlCount} {urlCount === 1 ? 'site' : 'sites'}
                        </span>
                    </div>

                    {/* URL list */}
                    <div className="divide-y divide-slate-50">
                        {results.full.urls.map((url, index) => {
                            let domain = url;
                            try { domain = new URL(url).hostname.replace('www.', ''); } catch {}
                            return (
                                <motion.div
                                    key={index}
                                    initial={{ opacity: 0, x: -8 }}
                                    animate={{ opacity: 1, x: 0 }}
                                    transition={{ delay: 0.28 + index * 0.05 }}
                                    className="group flex items-center gap-4 px-6 py-3.5 hover:bg-violet-50/50 transition-colors"
                                >
                                    {/* Index badge */}
                                    <div className="w-6 h-6 rounded-lg bg-slate-100 group-hover:bg-violet-100 flex items-center justify-center flex-shrink-0 transition-colors">
                                        <span className="text-[11px] font-black text-slate-500 group-hover:text-violet-600 transition-colors">{index + 1}</span>
                                    </div>

                                    {/* Favicon + domain */}
                                    <Favicon url={url} size={16} />
                                    <div className="flex-1 min-w-0">
                                        <p className="text-xs font-bold text-slate-500 mb-0.5">{domain}</p>
                                        <a
                                            href={url}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="text-sm text-violet-600 hover:text-violet-700 font-medium truncate block"
                                        >
                                            {url}
                                        </a>
                                    </div>

                                    {/* Open link icon */}
                                    <ArrowTopRightOnSquareIcon className="w-4 h-4 text-slate-300 group-hover:text-violet-400 flex-shrink-0 transition-colors" />
                                </motion.div>
                            );
                        })}
                    </div>
                </motion.div>

                {/* ── Tabs panel ── */}
                <motion.div
                    initial={{ opacity: 0, y: 16 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.35 }}
                    className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden"
                >
                    {/* Tab header */}
                    <div className="px-6 pt-5 pb-4 border-b border-slate-50">
                        <TabBar tabs={tabs} activeTab={activeTab} onTabChange={setActiveTab} />
                    </div>

                    {/* Tab content */}
                    <div className="p-6">
                        <AnimatePresence mode="wait">
                            <motion.div
                                key={activeTab}
                                initial={{ opacity: 0, y: 8 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0, y: -8 }}
                                transition={{ duration: 0.25 }}
                            >
                                {tabs[activeTab].content}
                            </motion.div>
                        </AnimatePresence>
                    </div>
                </motion.div>

                {/* ── Footer badge ── */}
                <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: 0.5 }}
                    className="flex justify-center pb-4"
                >
                    <div className="inline-flex items-center gap-3 px-5 py-2.5 bg-white border border-slate-100 rounded-full shadow-sm">
                        <div className="w-6 h-6 rounded-full bg-gradient-to-br from-violet-500 to-fuchsia-500 flex items-center justify-center">
                            <SparklesIcon className="w-3.5 h-3.5 text-white" />
                        </div>
                        <p className="text-sm">
                            <span className="font-bold text-violet-700">AI-Powered Analysis</span>
                            <span className="text-slate-400 mx-2">·</span>
                            <span className="text-slate-500 font-medium">Groq &amp; DeepSeek</span>
                        </p>
                    </div>
                </motion.div>
            </div>
        </div>
    );
};

export default Results;

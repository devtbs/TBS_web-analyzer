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

import Favicon from '../components/ui/Favicon';

/* ── Custom Tab Bar ──────────────────────────────────────────── */
const TabBar = ({ tabs, activeTab, onTabChange }) => (
    <div className="flex w-full gap-1 p-1 sm:p-1.5 bg-slate-100 rounded-xl sm:rounded-2xl">
        {tabs.map((tab, i) => {
            const isActive = activeTab === i;
            return (
                <button
                    key={i}
                    onClick={() => onTabChange(i)}
                    className={`relative flex-1 flex items-center justify-center gap-1.5 sm:gap-2.5 px-2 sm:px-4 py-2 sm:py-3 rounded-lg sm:rounded-xl text-[11px] sm:text-[15px] font-bold transition-all duration-200 ${
                        isActive
                            ? 'text-white shadow-md'
                            : 'text-slate-500 hover:text-slate-800 hover:bg-slate-200/50'
                    }`}
                >
                    {isActive && (
                        <motion.div
                            layoutId="tab-indicator-results"
                            className="absolute inset-0 rounded-lg sm:rounded-xl bg-emerald-600"
                            transition={{ type: 'spring', bounce: 0.2, duration: 0.5 }}
                        />
                    )}
                    <span className="relative z-10 flex items-center gap-1.5 sm:gap-2.5">
                        <span className="hidden sm:block">{tab.icon}</span>
                        <span className="truncate">{tab.label}</span>
                    </span>
                </button>
            );
        })}
    </div>
);

/* ── Stat card ───────────────────────────────────────────────── */
const StatCard = ({ icon, label, value, delay = 0 }) => (
    <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay, duration: 0.4 }}
        className="bg-white rounded-xl sm:rounded-2xl border border-slate-200/80 shadow-sm p-3 sm:p-6 group hover:shadow-md hover:-translate-y-0.5 transition-all"
    >
        <div className="flex items-start justify-between mb-2 sm:mb-5">
            <div className="w-7 h-7 sm:w-10 sm:h-10 rounded-lg sm:rounded-xl bg-gradient-to-br from-emerald-400 to-teal-500 flex items-center justify-center shadow-sm [&>svg]:w-3.5 [&>svg]:h-3.5 sm:[&>svg]:w-5 sm:[&>svg]:h-5">
                {icon}
            </div>
        </div>
        <div>
            <p className="text-xl sm:text-3xl font-black text-slate-900 leading-none">{value}</p>
            <p className="text-[10px] sm:text-sm font-semibold text-slate-500 mt-1 sm:mt-2 leading-tight">{label}</p>
        </div>
    </motion.div>
);

/* ── Loading Screen ──────────────────────────────────────────── */
const LoadingScreen = () => (
    <div className="min-h-screen flex items-center justify-center bg-[#f5f6fa]">
        <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            className="text-center px-8"
        >
            <div className="relative w-20 h-20 mx-auto mb-8">
                <div className="absolute inset-0 rounded-full bg-emerald-500 opacity-20 animate-ping" />
                <div className="absolute inset-1.5 rounded-full border-4 border-transparent border-t-emerald-500 border-r-teal-500 animate-spin" />
                <div className="absolute inset-0 rounded-full flex items-center justify-center">
                    <SparklesIcon className="w-7 h-7 text-emerald-500" />
                </div>
            </div>

            <h2 className="text-2xl font-black text-slate-900 mb-2">Analyzing Websites</h2>
            <p className="text-slate-500 font-medium mb-1">AI is generating comprehensive insights…</p>
            <p className="text-slate-400 text-sm mb-8">This may take 10–30 seconds</p>

            <div className="flex items-center justify-center gap-2">
                {[0, 150, 300].map((delay, i) => (
                    <div
                        key={i}
                        className="w-2 h-2 rounded-full bg-emerald-500 animate-bounce"
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
            icon: <ChartBarIcon className="w-5 h-5" />,
            content: <KnowledgeGraph graphData={results.knowledgeGraph} />,
        },
        {
            label: 'Topical Map',
            icon: <GlobeAltIcon className="w-5 h-5" />,
            content: <TopicalMap topicalMaps={results.topicalMaps} analysisId={analysisId} />,
        },
    ];

    if (results.comparison) {
        tabs.push({
            label: 'Comparison',
            icon: <ScaleIcon className="w-5 h-5" />,
            content: <Comparison comparisonData={results.comparison} />,
        });
    }

    const urlCount = results.full.urls?.length || 0;
    const nodeCount = results.knowledgeGraph?.nodes?.length || 0;

    return (
        <div className="flex-1 w-full min-h-screen bg-slate-50">

            {/* ── Top Header Strip (Dark Premium) ── */}
            <div className="relative bg-[#1e293b] pt-6 sm:pt-8 pb-24 sm:pb-32 overflow-hidden">
                {/* Decorative background elements */}
                <div className="absolute inset-0 opacity-[0.12] mix-blend-soft-light pointer-events-none" style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.65' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)'/%3E%3C/svg%3E")` }}></div>
                <div className="absolute inset-x-0 top-0 h-px bg-white/10" />
                <div className="absolute -top-40 -right-40 w-96 h-96 bg-emerald-500/20 rounded-full blur-[100px] pointer-events-none" />
                <div className="absolute bottom-0 left-20 w-72 h-72 bg-blue-500/10 rounded-full blur-[80px] pointer-events-none" />
                
                {/* Subtle Grid */}
                <div className="absolute inset-0 bg-[linear-gradient(to_right,#ffffff0a_1px,transparent_1px),linear-gradient(to_bottom,#ffffff0a_1px,transparent_1px)] bg-[size:24px_24px] pointer-events-none" />

                <div className="relative max-w-[1400px] mx-auto px-4 sm:px-6">
                    {/* Back button */}
                    <motion.button
                        initial={{ opacity: 0, x: -10 }}
                        animate={{ opacity: 1, x: 0 }}
                        onClick={() => navigate('/history')}
                        className="flex items-center gap-2 text-slate-400 hover:text-white mb-5 sm:mb-8 text-sm font-semibold transition-colors group px-1 w-fit"
                    >
                        <div className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center group-hover:bg-white/20 transition-colors">
                            <ArrowLeftIcon className="w-4 h-4 group-hover:-translate-x-0.5 transition-transform" />
                        </div>
                        Back to History
                    </motion.button>

                    <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 sm:gap-6 px-1">
                        <motion.div
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: 0.05 }}
                        >
                            <div className="flex items-center gap-3 mb-3 sm:mb-5">
                                <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-[11px] font-black tracking-widest uppercase shadow-sm">
                                    <span className="relative flex h-2 w-2">
                                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                                        <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                                    </span>
                                    Analysis Complete
                                </div>
                            </div>
                            
                            <h1 className="text-2xl sm:text-4xl lg:text-5xl font-black text-white mb-2 sm:mb-3 tracking-tight">
                                Analysis Results
                            </h1>
                            <p className="text-slate-400 font-medium text-sm sm:text-base flex flex-wrap items-center gap-2">
                                <span>AI-powered semantic analysis</span>
                                <span className="text-slate-600">•</span>
                                <span className="inline-flex items-center gap-1 text-slate-300 bg-white/10 border border-white/5 shadow-sm px-2.5 py-1 rounded-lg text-sm">
                                    <SparklesIcon className="w-4 h-4 text-emerald-400" />
                                    Groq + DeepSeek
                                </span>
                            </p>
                        </motion.div>

                        <motion.button
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: 0.1 }}
                            onClick={() => navigate('/new-analysis')}
                            className="self-start sm:self-auto inline-flex items-center gap-2 px-4 sm:px-6 py-2.5 sm:py-3 rounded-xl bg-white text-slate-900 font-bold text-sm shadow-[0_0_20px_rgba(255,255,255,0.1)] hover:-translate-y-0.5 hover:shadow-[0_0_25px_rgba(255,255,255,0.2)] transition-all"
                        >
                            <RocketLaunchIcon className="w-4 h-4" />
                            <span className="hidden sm:inline">New Analysis</span>
                            <span className="sm:hidden">New</span>
                        </motion.button>
                    </div>
                </div>
            </div>

            {/* ── Page body with overlapping cards ── */}
            <div className="max-w-[1400px] mx-auto px-3 sm:px-6 pb-12 space-y-4 sm:space-y-6 relative -mt-16 sm:-mt-20">
                
                {/* Stat cards overlapping the header */}
                <div className="grid grid-cols-3 gap-2 sm:gap-5">
                        <StatCard
                            label="Websites Analyzed"
                            value={urlCount}
                            icon={<GlobeAltIcon className="w-5 h-5 text-white" />}
                            delay={0.1}
                        />
                        <StatCard
                            label="Total Insights"
                            value={`${nodeCount}+`}
                            icon={<BoltIcon className="w-5 h-5 text-white" />}
                            delay={0.15}
                        />
                        <StatCard
                            label="Status"
                            value="Complete"
                            icon={<CheckCircleIcon className="w-5 h-5 text-white" />}
                            delay={0.2}
                        />
                </div>

                {/* Spacer to separate overlapping cards from body cards */}
                <div className="h-2" />

                {/* ── Analyzed URLs card ── */}
                <motion.div
                    initial={{ opacity: 0, y: 16 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.25 }}
                    className="bg-white rounded-2xl border border-slate-200/80 shadow-sm overflow-hidden"
                >
                    {/* Card header */}
                    <div className="flex items-center gap-3 px-4 sm:px-6 py-4 sm:py-5 border-b border-slate-100">
                        <div className="w-9 h-9 rounded-xl bg-slate-50 border border-slate-100 flex items-center justify-center shadow-sm">
                            <GlobeAltIcon className="w-[18px] h-[18px] text-emerald-500" />
                        </div>
                        <h2 className="font-bold text-slate-800 text-base">Analyzed URLs</h2>
                        <span className="ml-auto text-[11px] font-black uppercase text-emerald-600 bg-emerald-50 border border-emerald-100/50 px-2.5 py-1 rounded-md tracking-wider">
                            {urlCount} {urlCount === 1 ? 'Site' : 'Sites'}
                        </span>
                    </div>

                    {/* URL list */}
                    <div className="divide-y divide-slate-50">
                        {results.full.urls.map((url, index) => {
                            let domain = url;
                            try { domain = new URL(url).hostname.replace('www.', ''); } catch {}
                            return (
                                <motion.a
                                    key={index}
                                    href={url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    initial={{ opacity: 0, x: -8 }}
                                    animate={{ opacity: 1, x: 0 }}
                                    transition={{ delay: 0.28 + index * 0.05 }}
                                    className="group flex items-center gap-3 sm:gap-4 px-4 sm:px-6 py-3 sm:py-4 hover:bg-slate-50 active:bg-slate-100 transition-colors touch-manipulation"
                                >
                                    {/* Index badge */}
                                    <div className="w-6 h-6 sm:w-7 sm:h-7 rounded-lg bg-slate-50 border border-slate-100 group-hover:bg-white group-hover:border-emerald-200 group-active:bg-white group-active:border-emerald-200 flex items-center justify-center flex-shrink-0 transition-all">
                                        <span className="text-[10px] sm:text-[11px] font-black text-slate-400 group-hover:text-emerald-600 group-active:text-emerald-600 transition-colors">{index + 1}</span>
                                    </div>

                                    {/* Favicon + domain */}
                                    <Favicon url={url} size={16} />
                                    <div className="flex-1 min-w-0">
                                        <p className="text-[11px] sm:text-xs font-bold text-slate-500 mb-0.5 truncate">{domain}</p>
                                        <p className="text-xs sm:text-sm text-slate-700 group-hover:text-emerald-600 group-active:text-emerald-600 font-medium truncate block transition-colors">
                                            {url}
                                        </p>
                                    </div>

                                    {/* Open link icon — always visible on mobile */}
                                    <ArrowTopRightOnSquareIcon className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-slate-400 group-hover:text-emerald-500 group-active:text-emerald-500 flex-shrink-0 transition-colors" />
                                </motion.a>
                            );
                        })}
                    </div>
                </motion.div>

                {/* ── Tabs panel ── */}
                <motion.div
                    initial={{ opacity: 0, y: 16 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.35 }}
                    className="bg-white rounded-2xl border border-slate-200/80 shadow-sm overflow-hidden"
                >
                    {/* Tab header */}
                    <div className="px-4 sm:px-6 py-4 sm:py-5 border-b border-slate-100 flex items-center gap-4">
                        <TabBar tabs={tabs} activeTab={activeTab} onTabChange={setActiveTab} />
                    </div>

                    {/* Tab content */}
                    <div className="p-3 sm:p-6">
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
            </div>
        </div>
    );
};

export default Results;

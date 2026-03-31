import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import ProgressModal from '../components/ui/ProgressModal';
import GSCPropertySelector from '../components/gsc/GSCPropertySelector';
import {
    PlusIcon,
    XMarkIcon,
    GlobeAltIcon,
    SparklesIcon,
    CheckCircleIcon,
} from '@heroicons/react/24/outline';
import api from '../api/axios';
import toast from 'react-hot-toast';

/* ── Favicon helper ─────────────────────────────────────────── */
const Favicon = ({ url, size = 20 }) => {
    const [err, setErr] = useState(false);
    try {
        const host = new URL(url).hostname;
        if (err) return <GlobeAltIcon style={{ width: size, height: size }} className="text-slate-400 group-hover:text-emerald-500 transition-colors" />;
        return (
            <img
                src={`https://www.google.com/s2/favicons?domain=${host}&sz=32`}
                alt=""
                width={size}
                height={size}
                className="rounded-[4px] object-contain group-hover:scale-105 transition-transform"
                onError={() => setErr(true)}
            />
        );
    } catch {
        return <GlobeAltIcon style={{ width: size, height: size }} className="text-slate-400 group-hover:text-emerald-500 transition-colors" />;
    }
};

const NewAnalysis = () => {
    const navigate = useNavigate();
    const location = useLocation();
    const [urls, setUrls] = useState(['']);
    const [isAnalyzing, setIsAnalyzing] = useState(false);
    const [analysisId, setAnalysisId] = useState(null);
    const [useGSC, setUseGSC] = useState(true);
    const [tabLoading, setTabLoading] = useState(false);
    const tabTimerRef = useRef(null);

    const switchTab = useCallback((toGSC) => {
        if (toGSC === useGSC) return;
        setTabLoading(true);
        clearTimeout(tabTimerRef.current);
        tabTimerRef.current = setTimeout(() => {
            setUseGSC(toGSC);
            setTabLoading(false);
        }, 150);
    }, [useGSC]);

    useEffect(() => () => clearTimeout(tabTimerRef.current), []);
    const [selectedProperties, setSelectedProperties] = useState([]);

    const [selectedPages, setSelectedPages] = useState(() => {
        const saved = sessionStorage.getItem('selectedPages');
        return saved ? JSON.parse(saved) : [];
    });

    const processedStateRef = useRef(false);

    useEffect(() => {
        sessionStorage.setItem('selectedPages', JSON.stringify(selectedPages));
    }, [selectedPages]);

    useEffect(() => {
        if (location.state?.urls && location.state?.mode === 'cluster' && !processedStateRef.current) {
            processedStateRef.current = true;
            const newPages = location.state.urls;
            setSelectedPages(prev => [...new Set([...prev, ...newPages])]);
            toast.success(`${newPages.length} pages added!`);
            navigate(location.pathname, { replace: true, state: {} });
        } else if (!location.state?.urls) {
            processedStateRef.current = false;
        }
    }, [location.state, navigate]);

    const addUrlField = () => { if (urls.length + selectedPages.length < 5) setUrls([...urls, '']); };
    const removeUrlField = (index) => { if (urls.length > 1) setUrls(urls.filter((_, i) => i !== index)); };
    const updateUrl = (index, value) => { const n = [...urls]; n[index] = value; setUrls(n); };
    const normalizeUrl = (index) => {
        const raw = urls[index].trim();
        if (!raw) return;
        // Auto-add https:// if no protocol is present
        if (raw && !/^https?:\/\//i.test(raw)) {
            const n = [...urls];
            n[index] = 'https://' + raw;
            setUrls(n);
        }
    };

    const handleAnalyze = async () => {
        let validUrls = [];
        if (useGSC) {
            if (selectedProperties.length === 0 && selectedPages.length === 0) {
                toast.error('Please select at least one property or page'); return;
            }
            validUrls = selectedProperties.map(p => p.url);
        } else {
            validUrls = urls.filter(url => url.trim() !== '');
            if (validUrls.length === 0 && selectedPages.length === 0) {
                toast.error('Please enter at least one URL or select pages'); return;
            }
            // Normalize: add https:// if missing
            validUrls = validUrls.map(url => {
                const trimmed = url.trim();
                return /^https?:\/\//i.test(trimmed) ? trimmed : 'https://' + trimmed;
            });
            const urlPattern = /^https?:\/\/.+/;
            if (validUrls.some(url => !urlPattern.test(url))) {
                toast.error('Please enter valid URLs starting with http:// or https://'); return;
            }
        }
        validUrls = [...validUrls, ...selectedPages];
        if (validUrls.length > 5) {
            toast.error(`Maximum 5 URLs allowed. You have ${validUrls.length}.`); return;
        }
        setIsAnalyzing(true);
        try {
            const token = localStorage.getItem('access_token');
            const response = await api.post('/api/analyze',
                { urls: validUrls }
            );
            setAnalysisId(response.data.analysis_id);
            setSelectedPages([]);
            sessionStorage.removeItem('selectedPages');
        } catch (error) {
            toast.error(error.response?.data?.detail || 'Analysis failed');
            setIsAnalyzing(false);
        }
    };

    const handleProgressComplete = () => { if (analysisId) navigate(`/results/${analysisId}`); };
    const handleProgressError = (error) => {
        toast.error(error || 'Analysis failed');
        setIsAnalyzing(false);
        setAnalysisId(null);
    };

    const totalUrls = useGSC
        ? selectedProperties.length + selectedPages.length
        : urls.filter(u => u.trim()).length + selectedPages.length;

    const canAnalyze = totalUrls > 0 && totalUrls <= 5;

    return (
        <div className="flex flex-col items-center justify-center flex-1 min-h-full w-full py-12 bg-slate-50">
            
            {analysisId && (
                <ProgressModal
                    analysisId={analysisId}
                    onComplete={handleProgressComplete}
                    onError={handleProgressError}
                />
            )}

            <div className="relative w-full flex justify-center px-4 sm:px-6">
                <div className="w-full max-w-[1024px]">
                    <motion.div
                        initial={{ opacity: 0, scale: 0.98, y: 10 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        transition={{ duration: 0.4, ease: 'easeOut' }}
                        className="bg-white rounded-[24px] shadow-sm border border-slate-200/60 p-6 sm:p-8 relative"
                    >
                        {/* ── Mode Toggle ── */}
                        <div className="flex justify-center mb-6">
                            <div className="bg-slate-50/80 rounded-full p-2 flex relative w-full sm:w-[560px]">
                                {/* Active slider background */}
                                <motion.div
                                    layout
                                    transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                                    className="absolute top-2 bottom-2 w-[calc(50%-8px)] bg-emerald-600 rounded-full shadow-sm"
                                    style={{ left: useGSC ? '8px' : 'calc(50%)' }}
                                />
                                <button
                                    onClick={() => switchTab(true)}
                                    disabled={tabLoading}
                                    className={`flex-1 flex justify-center items-center py-3.5 rounded-full text-[15px] font-bold relative z-10 transition-colors duration-200 
                                        ${useGSC ? 'text-white' : 'text-[#64748b] hover:text-slate-800'}`}
                                >
                                    Search Console
                                </button>
                                <button
                                    onClick={() => switchTab(false)}
                                    disabled={tabLoading}
                                    className={`flex-1 flex justify-center items-center py-3.5 rounded-full text-[15px] font-bold relative z-10 transition-colors duration-200 
                                        ${!useGSC ? 'text-white' : 'text-[#64748b] hover:text-slate-800'}`}
                                >
                                    Manual Entry
                                </button>
                            </div>
                        </div>

                        {/* ── Content ── */}
                        <div className="min-h-[140px] relative">
                            {/* ── Tab Loading Overlay ── */}
                            {tabLoading && (
                                <motion.div
                                    initial={{ opacity: 0 }}
                                    animate={{ opacity: 1 }}
                                    exit={{ opacity: 0 }}
                                    className="absolute inset-0 z-20 flex items-center justify-center bg-white/70 backdrop-blur-[2px] rounded-2xl"
                                >
                                    <div className="flex flex-col items-center gap-3">
                                        <div className="w-8 h-8 rounded-full border-[3px] border-emerald-200 border-t-emerald-600 animate-spin" />
                                        <span className="text-sm font-semibold text-slate-400 tracking-wide">Switching...</span>
                                    </div>
                                </motion.div>
                            )}

                            {useGSC ? (
                                <GSCPropertySelector
                                    selectedProperties={selectedProperties}
                                    onPropertySelect={setSelectedProperties}
                                />
                            ) : (
                                <div className="space-y-4 px-2 max-w-[800px] mx-auto">
                                    {urls.map((url, index) => (
                                        <motion.div
                                            key={index}
                                            initial={{ opacity: 0, y: 8 }}
                                            animate={{ opacity: 1, y: 0 }}
                                            transition={{ delay: index * 0.05 }}
                                            className="flex gap-4 items-center rounded-2xl p-1.5 hover:bg-slate-50 transition-colors"
                                        >
                                            <div className="flex-none p-3 rounded-2xl bg-emerald-50 border border-emerald-100/50 flex items-center justify-center">
                                                <GlobeAltIcon className="w-6 h-6 text-emerald-600" />
                                            </div>
                                            <div className="flex-1 relative">
                                                <input
                                                    type="text"
                                                    value={url}
                                                    onChange={e => updateUrl(index, e.target.value)}
                                                    onBlur={() => normalizeUrl(index)}
                                                    placeholder={`https://example${index > 0 ? index + 1 : ''}.com`}
                                                    className="w-full px-5 py-3.5 bg-transparent border-b-2 border-transparent hover:border-slate-200 focus:border-emerald-500 text-base text-slate-800 placeholder-slate-400 focus:outline-none transition-all"
                                                    autoFocus={index === urls.length - 1}
                                                />
                                            </div>
                                            {urls.length > 1 && (
                                                <button
                                                    onClick={() => removeUrlField(index)}
                                                    className="p-3 bg-white border border-slate-200 rounded-xl text-slate-400 hover:text-red-500 hover:border-red-200 hover:bg-red-50 transition-colors"
                                                >
                                                    <XMarkIcon className="w-5 h-5" />
                                                </button>
                                            )}
                                        </motion.div>
                                    ))}
                                    {urls.length + selectedPages.length < 5 && (
                                        <button
                                            onClick={addUrlField}
                                            className="ml-3 mt-6 flex items-center gap-3 text-base font-bold text-emerald-600 hover:text-emerald-700 transition-colors"
                                        >
                                            <div className="flex items-center justify-center w-8 h-8 rounded-full bg-emerald-50 text-emerald-600 ring-1 ring-emerald-500/20">
                                                <PlusIcon className="w-5 h-5" />
                                            </div>
                                            Add Another Website
                                        </button>
                                    )}
                                </div>
                            )}

                            {/* ── Selected Pages ── */}
                            {selectedPages.length > 0 && (
                                <div className="mt-8 rounded-[24px] bg-slate-50/80 p-6 border border-slate-100/60 shadow-[inset_0_2px_10px_rgba(0,0,0,0.02)]">
                                    <div className="flex items-center justify-between mb-5">
                                        <div className="flex items-center gap-3">
                                            <div className="flex items-center justify-center w-8 h-8 rounded-xl bg-emerald-100/50 text-emerald-600 shadow-sm ring-1 ring-emerald-500/10">
                                                <CheckCircleIcon className="w-5 h-5 text-emerald-600 stroke-2" />
                                            </div>
                                            <span className="text-base font-bold text-slate-800 tracking-tight">
                                                {selectedPages.length} Pages Ready for Analysis
                                            </span>
                                        </div>
                                        <button
                                            onClick={() => { setSelectedPages([]); sessionStorage.removeItem('selectedPages'); }}
                                            className="text-[13px] font-bold text-slate-500 hover:text-red-600 hover:bg-red-50 px-3 py-1.5 rounded-lg transition-all"
                                        >
                                            Clear All
                                        </button>
                                    </div>
                                    <div className="max-h-60 overflow-y-auto pr-2 flex flex-col gap-2" style={{ scrollbarWidth: 'thin' }}>
                                        {selectedPages.map((pageUrl, i) => (
                                            <motion.div 
                                                initial={{ opacity: 0, y: 5 }}
                                                animate={{ opacity: 1, y: 0 }}
                                                transition={{ delay: i * 0.03 }}
                                                key={i} 
                                                className="flex items-center justify-between py-2.5 px-4 bg-white rounded-[14px] border border-slate-200/60 shadow-sm group hover:border-emerald-300 hover:shadow-md transition-all"
                                            >
                                                <div className="flex items-center gap-3 overflow-hidden">
                                                    <div className="flex-shrink-0 mt-0.5">
                                                        <Favicon url={pageUrl} size={18} />
                                                    </div>
                                                    <span className="text-[14px] text-slate-700 truncate font-semibold" title={pageUrl}>
                                                        {pageUrl.replace('https://', '').replace('http://', '').replace('www.', '')}
                                                    </span>
                                                </div>
                                                <button
                                                    onClick={() => setSelectedPages(prev => prev.filter((_, idx) => idx !== i))}
                                                    className="ml-3 p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-500 hover:border-red-200 border border-transparent rounded-[10px] transition-all flex-shrink-0"
                                                >
                                                    <XMarkIcon className="w-5 h-5 stroke-2" />
                                                </button>
                                            </motion.div>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* ── Analyze Button ── */}
                        <div className="flex justify-center mt-6">
                            <motion.button
                                whileHover={{ scale: canAnalyze && !isAnalyzing ? 1.02 : 1 }}
                                whileTap={{ scale: canAnalyze && !isAnalyzing ? 0.98 : 1 }}
                                onClick={handleAnalyze}
                                disabled={isAnalyzing || !canAnalyze}
                                className={`px-12 sm:px-16 py-4 rounded-xl font-bold text-[16px] sm:text-[17px] transition-all duration-300 flex items-center justify-center gap-3 text-white bg-slate-900 border border-slate-800
                                    ${canAnalyze && !isAnalyzing
                                        ? 'shadow-lg shadow-slate-900/20 hover:shadow-xl hover:shadow-slate-900/30 hover:-translate-y-0.5'
                                        : 'opacity-60 cursor-not-allowed shadow-none grayscale-[20%]'
                                    }`}
                            >
                                {isAnalyzing ? (
                                    <>
                                        <SparklesIcon className="w-5 h-5 animate-spin" />
                                        Analyzing...
                                    </>
                                ) : totalUrls > 5 ? (
                                    <>
                                        Too Many URLs Selected
                                        <div className="inline-flex items-center justify-center bg-white/25 rounded-full px-2.5 py-0.5 text-[14px] font-bold ml-1 ring-1 ring-white/30 backdrop-blur-sm">
                                            {totalUrls} / 5
                                        </div>
                                    </>
                                ) : (
                                    <>
                                        Start AI Analysis
                                        {totalUrls > 0 && (
                                            <div className="inline-flex items-center justify-center bg-white/25 rounded-full px-2.5 py-0.5 text-[14px] font-bold ml-1 ring-1 ring-white/30 backdrop-blur-sm">
                                                {totalUrls} {totalUrls === 1 ? 'URL' : 'URLs'}
                                            </div>
                                        )}
                                    </>
                                )}
                            </motion.button>
                        </div>
                        
                    </motion.div>
                </div>
            </div>
        </div>
    );
};

export default NewAnalysis;

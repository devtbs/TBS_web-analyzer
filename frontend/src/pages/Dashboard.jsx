import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { motion } from 'framer-motion';
import ProgressModal from '../components/ui/ProgressModal';
import GSCPropertySelector from '../components/gsc/GSCPropertySelector';
import {
    PlusIcon,
    XMarkIcon,
    GlobeAltIcon,
    SparklesIcon,
    CheckCircleIcon,
} from '@heroicons/react/24/outline';
import axios from 'axios';
import toast from 'react-hot-toast';

const Dashboard = () => {
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

    const addUrlField = () => { if (urls.length < 5) setUrls([...urls, '']); };
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
            const response = await axios.post('/api/analyze',
                { urls: validUrls },
                { headers: { Authorization: `Bearer ${token} ` } }
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

    const canAnalyze = useGSC
        ? (selectedProperties.length > 0 || selectedPages.length > 0)
        : (urls.filter(u => u.trim()).length > 0 || selectedPages.length > 0);

    return (
        <div className="flex flex-col items-center justify-center flex-1 h-full w-full py-2 sm:py-6" style={{ background: '#f5f4fa' }}>
            
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
                        className="bg-white rounded-[24px] shadow-[0_30px_60px_-15px_rgba(0,0,0,0.05)] overflow-hidden border border-white p-6 sm:p-8"
                    >
                        
                        {/* ── Mode Toggle ── */}
                        <div className="flex justify-center mb-6">
                            <div className="bg-slate-100/80 rounded-full p-1.5 flex relative w-full sm:w-[560px]">
                                {/* Active slider background */}
                                <motion.div
                                    layout
                                    transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                                    className="absolute top-1.5 bottom-1.5 w-[calc(50%-6px)] bg-gradient-to-r from-violet-600 via-purple-500 to-fuchsia-500 rounded-full shadow-md"
                                    style={{ left: useGSC ? '6px' : 'calc(50%)' }}
                                />
                                <button
                                    onClick={() => switchTab(true)}
                                    disabled={tabLoading}
                                    className={`flex-1 flex justify-center items-center py-3.5 rounded-full text-base font-bold relative z-10 transition-colors duration-200 
                                        ${useGSC ? 'text-white' : 'text-slate-500 hover:text-slate-700'}`}
                                >
                                    Search Console
                                    {useGSC && <div className="ml-3 w-5 h-5 bg-white rounded-full shadow-sm" />}
                                </button>
                                <button
                                    onClick={() => switchTab(false)}
                                    disabled={tabLoading}
                                    className={`flex-1 flex justify-center items-center py-3.5 rounded-full text-base font-bold relative z-10 transition-colors duration-200 
                                        ${!useGSC ? 'text-white' : 'text-slate-500 hover:text-slate-700'}`}
                                >
                                    Manual Entry
                                    {!useGSC && <div className="ml-3 w-5 h-5 bg-white rounded-full shadow-sm" />}
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
                                        <div className="w-8 h-8 rounded-full border-[3px] border-violet-200 border-t-violet-600 animate-spin" />
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
                                            <div className="flex-none p-3 rounded-2xl bg-violet-100/60 flex items-center justify-center">
                                                <GlobeAltIcon className="w-6 h-6 text-violet-600" />
                                            </div>
                                            <div className="flex-1 relative">
                                                <input
                                                    type="text"
                                                    value={url}
                                                    onChange={e => updateUrl(index, e.target.value)}
                                                    onBlur={() => normalizeUrl(index)}
                                                    placeholder={`https://example${index > 0 ? index + 1 : ''}.com`}
                                                    className="w-full px-5 py-3.5 bg-transparent border-b-2 border-transparent hover:border-slate-200 focus:border-violet-400 text-base text-slate-800 placeholder-slate-400 focus:outline-none transition-all"
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

                                    {urls.length < 5 && (
                                        <button
                                            onClick={addUrlField}
                                            className="ml-3 mt-6 flex items-center gap-3 text-base font-bold text-violet-600 hover:text-violet-700 transition-colors"
                                        >
                                            <div className="flex items-center justify-center w-8 h-8 rounded-full bg-violet-100 text-violet-600">
                                                <PlusIcon className="w-5 h-5" />
                                            </div>
                                            Add Another Website
                                        </button>
                                    )}
                                </div>
                            )}

                            {/* ── Selected Pages ── */}
                            {selectedPages.length > 0 && (
                                <div className="mt-8 rounded-2xl border border-slate-100 bg-slate-50 p-6 shadow-sm">
                                    <div className="flex items-center justify-between mb-4 border-b border-slate-200 pb-3">
                                        <div className="flex items-center gap-2.5">
                                            <CheckCircleIcon className="w-5 h-5 text-emerald-500" />
                                            <span className="text-base font-bold text-slate-800">
                                                {selectedPages.length} Pages Selected for Analysis
                                            </span>
                                        </div>
                                        <button
                                            onClick={() => { setSelectedPages([]); sessionStorage.removeItem('selectedPages'); }}
                                            className="text-sm font-bold text-slate-500 hover:text-red-500 transition-colors"
                                        >
                                            Clear All
                                        </button>
                                    </div>
                                    <div className="max-h-48 overflow-y-auto pr-3 space-y-1.5">
                                        {selectedPages.map((pageUrl, i) => (
                                            <div key={i} className="flex items-center justify-between py-2 text-base">
                                                <span className="text-slate-600 truncate flex-1 font-medium">{pageUrl}</span>
                                                <button onClick={() => setSelectedPages(prev => prev.filter((_, idx) => idx !== i))} className="ml-4 p-1.5 text-slate-400 hover:bg-white hover:text-red-500 hover:shadow-sm rounded transition-all flex-shrink-0">
                                                    <XMarkIcon className="w-5 h-5" />
                                                </button>
                                            </div>
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
                                className={`px-16 py-4 rounded-full font-bold text-[17px] transition-all duration-300 flex items-center justify-center gap-3 text-white bg-gradient-to-r from-violet-600 via-purple-500 to-fuchsia-500
                                    ${canAnalyze && !isAnalyzing
                                        ? 'shadow-xl hover:shadow-purple-500/40 hover:-translate-y-0.5'
                                        : 'opacity-70 cursor-not-allowed shadow-none'
                                    }`}
                            >
                                {isAnalyzing ? (
                                    <>
                                        <SparklesIcon className="w-5 h-5 animate-spin" />
                                        Analyzing...
                                    </>
                                ) : (
                                    <>
                                        Start AI Analysis
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

export default Dashboard;

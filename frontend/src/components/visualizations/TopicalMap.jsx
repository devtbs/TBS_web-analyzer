import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { toast } from 'react-hot-toast';
import api from '../../api/axios';
import {
    ChevronDownIcon,
    ChevronUpIcon,
    ChevronUpDownIcon,
    GlobeAltIcon,
    UserGroupIcon,
    LightBulbIcon,
    ChartBarIcon,
    MagnifyingGlassIcon,
    TrophyIcon,
    DocumentTextIcon,
    SparklesIcon,
    Squares2X2Icon,
    TableCellsIcon,
    WrenchScrewdriverIcon,
    ArrowDownTrayIcon,
    Cog6ToothIcon,
    XMarkIcon,
    LanguageIcon,
} from '@heroicons/react/24/outline';
import Favicon from '../ui/Favicon';
import { toPng } from 'html-to-image';
import { jsPDF } from 'jspdf';

const LS_PROMPT_EN = 'writing_prompt_en';
const LS_PROMPT_TH = 'writing_prompt_th';
const LS_LANGUAGE  = 'writing_language';

const DEFAULT_EN_HINT = `You are an expert, award-winning travel and lifestyle writer.
Write with a rich, sensory, culturally respectful tone.
Avoid generic AI intros — dive straight into a vivid hook.
Output valid Markdown starting with H1.`;

const DEFAULT_TH_HINT = `คุณคือนักเขียนท่องเที่ยวและไลฟ์สไตล์ที่เชี่ยวชาญ
เขียนด้วยน้ำเสียงที่สมจริง กระตุ้นประสาทสัมผัส และให้เกียรติวัฒนธรรม
หลีกเลี่ยงประโยคเปิดแบบ AI ทั่วไป เขียนทั้งบทความเป็นภาษาไทย
ผลลัพธ์ต้องเป็น Markdown ที่ถูกต้อง`;

const getDomain = (url) => { try { return new URL(url).hostname.replace('www.', ''); } catch { return url; } };

// Source badge colours for competitor domains (cycles through a palette)
const COMP_COLORS = [
    { bg: 'bg-violet-100', text: 'text-violet-700', border: 'border-violet-200', dot: 'bg-violet-400' },
    { bg: 'bg-rose-100',   text: 'text-rose-700',   border: 'border-rose-200',   dot: 'bg-rose-400'   },
    { bg: 'bg-sky-100',    text: 'text-sky-700',    border: 'border-sky-200',    dot: 'bg-sky-400'    },
    { bg: 'bg-orange-100', text: 'text-orange-700', border: 'border-orange-200', dot: 'bg-orange-400' },
];

const TopicalMap = ({ topicalMaps, analysisId }) => {
    const navigate = useNavigate();
    const [generatingArticle, setGeneratingArticle] = useState(null);
    const [showPromptSettings, setShowPromptSettings] = useState(false);
    const [language, setLanguage] = useState(() => localStorage.getItem(LS_LANGUAGE) || 'en');
    const [promptEn, setPromptEn] = useState(() => localStorage.getItem(LS_PROMPT_EN) || '');
    const [promptTh, setPromptTh] = useState(() => localStorage.getItem(LS_PROMPT_TH) || '');

    const savePromptSettings = () => {
        localStorage.setItem(LS_LANGUAGE, language);
        localStorage.setItem(LS_PROMPT_EN, promptEn);
        localStorage.setItem(LS_PROMPT_TH, promptTh);
        setShowPromptSettings(false);
        toast.success('Writing settings saved!');
    };

    const handleGenerateArticle = async (article) => {
        setGeneratingArticle(article.title);
        const lang = localStorage.getItem(LS_LANGUAGE) || 'en';
        const sysPrompt = lang === 'th'
            ? (localStorage.getItem(LS_PROMPT_TH) || '')
            : (localStorage.getItem(LS_PROMPT_EN) || '');
        try {
            const response = await api.post(`/api/article/${analysisId}`, {
                topic: article.title,
                category: article.category_l1 || 'General',
                article_type: article.article_type || 'informative',
                language: lang,
                system_prompt: sysPrompt || undefined,
            }, { timeout: 120000 });
            navigate(`/documents/${response.data.document_id}`);
        } catch (error) {
            console.error('Failed to generate article:', error);
            toast.error('Failed to generate article. Please try again.');
        } finally {
            setGeneratingArticle(null);
        }
    };
    const [expandedSections, setExpandedSections] = useState({
        semantic: true,
        audience: false,
        content: true,
        queries: false,
        competitive: true,
        articles: true,
        seo: true,
        taxonomy: true,
        ontology: true,
        tools: true
    });

    if (!topicalMaps || topicalMaps.length === 0) {
        return (
            <div className="bg-white rounded-lg shadow p-8 text-center text-slate-500">
                No topical map data available
            </div>
        );
    }
    // ── Primary = first URL, competitors = rest ─────────────────────────────
    const primaryMap = topicalMaps[0];
    const competitorMaps = topicalMaps.slice(1);
    const activeMap = primaryMap; // keep old refs working

    // Competitor colour lookup (stable by index)
    const compColor = (idx) => COMP_COLORS[idx % COMP_COLORS.length];
    const compDomain = (map) => getDomain(map.url);

    // Merged key topics: primary + gap topics from competitors
    const primaryTopicSet = new Set((primaryMap.key_topics || []).map(t => t.toLowerCase()));
    const gapTopicsWithSource = [];
    competitorMaps.forEach((cm, ci) => {
        (cm.key_topics || []).forEach(t => {
            if (!primaryTopicSet.has(t.toLowerCase()) && !gapTopicsWithSource.find(g => g.topic.toLowerCase() === t.toLowerCase())) {
                gapTopicsWithSource.push({ topic: t, domain: compDomain(cm), colorIdx: ci });
            }
        });
    });

    // Merged content articles: primary tagged, then competitor-unique articles
    const primaryArticles = (primaryMap.content_articles || []).map(a => ({ ...a, _isPrimary: true, _domain: getDomain(primaryMap.url) }));
    const primaryTitleSet = new Set(primaryArticles.map(a => a.title.toLowerCase().slice(0, 30)));
    const competitorArticles = [];
    competitorMaps.forEach((cm, ci) => {
        (cm.content_articles || []).forEach(a => {
            if (!primaryTitleSet.has(a.title.toLowerCase().slice(0, 30))) {
                competitorArticles.push({ ...a, _isPrimary: false, _domain: compDomain(cm), _colorIdx: ci });
            }
        });
    });
    const mergedArticles = [...primaryArticles, ...competitorArticles];

    // Merged core/outer topics from competitors (for content strategy section)
    const primaryCoreSet = new Set((primaryMap.content_strategy?.core_topics || []).map(t => t.toLowerCase()));
    const competitorCoreTopics = [];
    competitorMaps.forEach((cm, ci) => {
        (cm.content_strategy?.core_topics || []).forEach(t => {
            if (!primaryCoreSet.has(t.toLowerCase())) {
                competitorCoreTopics.push({ topic: t, domain: compDomain(cm), colorIdx: ci });
            }
        });
    });

    const toggleSection = (section) => {
        setExpandedSections(prev => ({
            ...prev,
            [section]: !prev[section]
        }));
    };


    const exportToPNG = async (elementId, filename) => {
        const element = document.getElementById(elementId);
        if (!element) return;
        
        try {
            // Filter function to remove the export buttons entirely from the final shot
            const filter = (node) => {
                // Ignore elements specifically marked
                if (node?.hasAttribute && node.hasAttribute('data-html2canvas-ignore')) {
                    return false;
                }
                // Ignore favicons strictly during export to prevent CORS security errors
                // that would otherwise crash the PDF generation.
                if (node?.tagName === 'IMG' && node.src?.includes('s2/favicons')) {
                    return false;
                }
                return true;
            };

            const dataUrl = await toPng(element, {
                quality: 1.0,
                pixelRatio: 2, // High resolution output
                cacheBust: true,
                includeQueryParams: true,
                backgroundColor: '#ffffff',
                filter: filter,
                style: {
                    margin: '0', 
                    transform: 'none'
                }
            });
            
            const link = document.createElement('a');
            link.download = `${filename}.png`;
            link.href = dataUrl;
            link.click();
        } catch (err) {
            console.error('Failed to export PNG', err);
        }
    };

    const exportToPDF = async (elementId, filename) => {
        const element = document.getElementById(elementId);
        if (!element) return;
        
        try {
            const filter = (node) => {
                // Ignore elements specifically marked
                if (node?.hasAttribute && node.hasAttribute('data-html2canvas-ignore')) {
                    return false;
                }
                // Ignore favicons strictly during export to prevent CORS security errors
                // that would otherwise crash the PDF generation.
                if (node?.tagName === 'IMG' && node.src?.includes('s2/favicons')) {
                    return false;
                }
                return true;
            };

            const dataUrl = await toPng(element, {
                quality: 1.0,
                pixelRatio: 2, 
                cacheBust: true,
                includeQueryParams: true,
                backgroundColor: '#ffffff',
                filter: filter,
                style: {
                    margin: '0', 
                    transform: 'none'
                }
            });
            
            // Standard A4 width is 210mm
            const pdfWidth = 210;
            // Calculate height proportionately based on DOM element aspect ratio
            const pdfHeight = (element.offsetHeight * pdfWidth) / element.offsetWidth;
            
            // Create a custom-sized PDF that acts as a continuous digital presentation board
            const pdf = new jsPDF({
                orientation: 'portrait',
                unit: 'mm',
                format: [pdfWidth, pdfHeight]
            });
            
            pdf.addImage(dataUrl, 'PNG', 0, 0, pdfWidth, pdfHeight);
            pdf.save(`${filename}.pdf`);
            
        } catch (err) {
            console.error('Failed to export PDF', err);
        }
    };

    const SectionHeader = ({ title, color, icon: Icon, section, count, elementId }) => (
        <div
            className={`flex items-center justify-between p-4 bg-gradient-to-r ${color} transition-opacity`}
        >
            <div className="flex items-center gap-3 cursor-pointer" onClick={() => section && toggleSection(section)}>
                {Icon && <Icon className="w-5 h-5 text-white" />}
                <h2 className="text-lg font-bold text-white">{title}</h2>
                {count !== undefined && (
                    <span className="px-2.5 py-1 bg-white/20 rounded-md text-white text-sm font-semibold">
                        {count}
                    </span>
                )}
            </div>
            <div className="flex items-center gap-2" data-html2canvas-ignore="true">
                {elementId && (
                    <button
                        onClick={(e) => {
                            e.stopPropagation();
                            
                            if (section && !expandedSections[section]) {
                                setExpandedSections(prev => ({ ...prev, [section]: true }));
                                setTimeout(() => {
                                    exportToPNG(elementId, `${title.replace(/\s+/g, '-').toLowerCase()}-export`);
                                }, 500);
                            } else {
                                exportToPNG(elementId, `${title.replace(/\s+/g, '-').toLowerCase()}-export`);
                            }
                        }}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-500/80 hover:bg-emerald-500 rounded-md transition-colors text-white text-xs font-black uppercase tracking-wider shadow-sm"
                        title="Export to PNG"
                    >
                        <ArrowDownTrayIcon className="w-4 h-4" />
                        PNG
                    </button>
                )}
                {section && (
                    <button
                        onClick={(e) => {
                            e.stopPropagation();
                            toggleSection(section);
                        }}
                        className="p-1.5 hover:bg-white/20 rounded-md transition-colors text-white"
                    >
                        {expandedSections[section] ?
                            <ChevronUpIcon className="w-5 h-5" /> :
                            <ChevronDownIcon className="w-5 h-5" />
                        }
                    </button>
                )}
            </div>
        </div>
    );

    const exportAllToPDF = () => {
        // Automatically expand all collapsed sections first for a complete client export
        setExpandedSections({
            semantic: true,
            audience: true,
            content: true,
            queries: true,
            competitive: true,
            articles: true,
            seo: true,
            taxonomy: true,
            ontology: true,
            tools: true
        });

        // Give React a tiny moment (500ms) to finish the expand DOM animations
        setTimeout(() => {
            exportToPDF('export-full-topical-map', `${activeMap.central_entity?.replace(/\s+/g, '-').toLowerCase() || 'full'}-topical-map-complete`);
        }, 500);
    };

    return (
        <>
        {/* ── Prompt settings panel ── */}
        <AnimatePresence>
            {showPromptSettings && (
                <motion.div
                    key="prompt-panel"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="fixed inset-0 z-[9998] flex items-center justify-center"
                    style={{ background: 'rgba(15,23,42,0.65)', backdropFilter: 'blur(6px)' }}
                    onClick={() => setShowPromptSettings(false)}
                >
                    <motion.div
                        initial={{ scale: 0.95, opacity: 0, y: 16 }}
                        animate={{ scale: 1, opacity: 1, y: 0 }}
                        exit={{ scale: 0.95, opacity: 0, y: 16 }}
                        transition={{ type: 'spring', stiffness: 300, damping: 28 }}
                        className="bg-white rounded-3xl shadow-2xl w-full max-w-xl mx-4 overflow-hidden"
                        onClick={e => e.stopPropagation()}
                    >
                        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
                            <div className="flex items-center gap-2.5">
                                <Cog6ToothIcon className="w-5 h-5 text-emerald-600" />
                                <h2 className="text-base font-bold text-slate-800">Writing Settings</h2>
                            </div>
                            <button onClick={() => setShowPromptSettings(false)} className="p-1.5 hover:bg-slate-100 rounded-lg transition-colors text-slate-400 hover:text-slate-600">
                                <XMarkIcon className="w-5 h-5" />
                            </button>
                        </div>

                        <div className="px-6 py-5 space-y-5">
                            {/* Language toggle */}
                            <div>
                                <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2.5">Output Language</p>
                                <div className="flex rounded-xl overflow-hidden border border-slate-200 w-fit">
                                    {[{ code: 'en', label: '🇬🇧 English' }, { code: 'th', label: '🇹🇭 ภาษาไทย' }].map(lang => (
                                        <button
                                            key={lang.code}
                                            onClick={() => setLanguage(lang.code)}
                                            className={`px-5 py-2 text-sm font-bold transition-all ${
                                                language === lang.code
                                                    ? 'bg-emerald-600 text-white'
                                                    : 'bg-white text-slate-600 hover:bg-slate-50'
                                            }`}
                                        >
                                            {lang.label}
                                        </button>
                                    ))}
                                </div>
                            </div>


                            {/* Prompt — only the selected language */}
                            {language === 'en' ? (
                                <div>
                                    <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Writing Prompt <span className="text-slate-300 normal-case tracking-normal font-normal">(leave blank for default)</span></p>
                                    <textarea
                                        value={promptEn}
                                        onChange={e => setPromptEn(e.target.value)}
                                        placeholder={DEFAULT_EN_HINT}
                                        rows={6}
                                        className="w-full text-sm border border-slate-200 rounded-xl px-4 py-3 text-slate-700 focus:outline-none focus:ring-2 focus:ring-emerald-500 resize-y font-mono"
                                    />
                                </div>
                            ) : (
                                <div>
                                    <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Writing Prompt <span className="text-slate-300 normal-case tracking-normal font-normal">(leave blank for default)</span></p>
                                    <textarea
                                        value={promptTh}
                                        onChange={e => setPromptTh(e.target.value)}
                                        placeholder={DEFAULT_TH_HINT}
                                        rows={6}
                                        className="w-full text-sm border border-slate-200 rounded-xl px-4 py-3 text-slate-700 focus:outline-none focus:ring-2 focus:ring-emerald-500 resize-y font-mono"
                                    />
                                </div>
                            )}

                        </div>

                        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-slate-100 bg-slate-50">
                            <button onClick={() => setShowPromptSettings(false)} className="px-4 py-2 text-sm font-bold text-slate-500 hover:text-slate-700 transition-colors">Cancel</button>
                            <button
                                onClick={savePromptSettings}
                                className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-sm font-bold transition-all shadow-sm"
                            >
                                Save & Apply
                            </button>
                        </div>
                    </motion.div>
                </motion.div>
            )}
        </AnimatePresence>

        {/* ── Full-screen generation overlay ── */}
        <AnimatePresence>
            {generatingArticle && (
                <motion.div
                    key="gen-overlay"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="fixed inset-0 z-[9999] flex items-center justify-center"
                    style={{ background: 'rgba(15, 23, 42, 0.65)', backdropFilter: 'blur(6px)' }}
                >
                    <motion.div
                        initial={{ scale: 0.9, opacity: 0, y: 20 }}
                        animate={{ scale: 1, opacity: 1, y: 0 }}
                        exit={{ scale: 0.9, opacity: 0, y: 20 }}
                        transition={{ type: 'spring', stiffness: 300, damping: 28 }}
                        className="bg-white rounded-3xl shadow-2xl px-10 py-10 flex flex-col items-center gap-5 max-w-sm w-full mx-4 text-center"
                    >
                        {/* Spinner */}
                        <div className="relative w-16 h-16">
                            <div className="absolute inset-0 rounded-full border-4 border-slate-100" />
                            <div className="absolute inset-0 rounded-full border-4 border-transparent border-t-emerald-600 animate-spin" />
                            <div className="absolute inset-0 flex items-center justify-center">
                                <SparklesIcon className="w-6 h-6 text-emerald-500 animate-pulse" />
                            </div>
                        </div>

                        <div>
                            <p className="text-lg font-bold text-slate-800 mb-1">Writing Article…</p>
                            <p className="text-sm text-slate-500 font-medium line-clamp-2 leading-snug">
                                {generatingArticle}
                            </p>
                        </div>

                        <p className="text-xs text-slate-400 font-medium">
                            AI is generating your article. This can take up to a minute.
                        </p>

                        {/* Progress dots */}
                        <div className="flex gap-1.5">
                            {[0, 1, 2].map(i => (
                                <motion.div
                                    key={i}
                                    className="w-2 h-2 rounded-full bg-emerald-400"
                                    animate={{ scale: [1, 1.4, 1], opacity: [0.5, 1, 0.5] }}
                                    transition={{ duration: 1.2, repeat: Infinity, delay: i * 0.2 }}
                                />
                            ))}
                        </div>
                    </motion.div>
                </motion.div>
            )}
        </AnimatePresence>

        <div className="space-y-6" id="export-full-topical-map">
            {/* Primary + Competitors indicator bar */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between w-full gap-3 mb-2" data-html2canvas-ignore="true">
                <div className="flex flex-wrap items-center gap-2">
                    {/* Primary site badge */}
                    <div className="flex items-center gap-2 px-3 py-1.5 bg-emerald-600 text-white rounded-lg text-sm font-bold shadow-sm">
                        <Favicon url={primaryMap.url} size={14} className="flex-shrink-0" />
                        <span>{getDomain(primaryMap.url)}</span>
                        <span className="text-[10px] bg-white/20 px-1.5 py-0.5 rounded font-black">PRIMARY</span>
                    </div>
                    {/* Competitor badges */}
                    {competitorMaps.map((cm, ci) => {
                        const c = compColor(ci);
                        return (
                            <div key={ci} className={`flex items-center gap-2 px-3 py-1.5 ${c.bg} border ${c.border} rounded-lg text-sm font-bold`}>
                                <Favicon url={cm.url} size={14} className="flex-shrink-0" />
                                <span className={c.text}>{compDomain(cm)}</span>
                                <span className={`text-[10px] ${c.text} opacity-70 font-black`}>COMPETITOR</span>
                            </div>
                        );
                    })}
                </div>


                <div className="flex items-center gap-2 self-start sm:self-auto sm:ml-auto">
                    {/* Writing settings button */}
                    <button
                        onClick={() => setShowPromptSettings(true)}
                        className="flex items-center gap-2 px-3 py-2.5 bg-white border border-slate-200 hover:border-emerald-300 hover:bg-emerald-50 text-slate-600 hover:text-emerald-700 rounded-xl font-bold text-sm transition-all"
                        title="Writing settings"
                    >
                        <Cog6ToothIcon className="w-4 h-4" />
                        <span className="hidden sm:inline">Settings</span>
                        {language === 'th' && <span className="text-[10px] px-1.5 py-0.5 bg-emerald-100 text-emerald-700 rounded font-black">ไทย</span>}
                    </button>
                    <button
                        onClick={exportAllToPDF}
                        className="flex items-center gap-2 px-4 sm:px-5 py-2 sm:py-2.5 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white rounded-xl font-bold text-sm shadow-lg shadow-emerald-500/20 transition-all whitespace-nowrap"
                    >
                        <ArrowDownTrayIcon className="w-4 h-4" />
                        Export Map to PDF
                    </button>
                </div>
            </div>

            {/* Header Info */}
            <div className="bg-white rounded-2xl shadow-sm border border-slate-200/80 overflow-hidden">
                <div className="bg-slate-900 p-6 relative overflow-hidden">
                    <div className="absolute inset-0 bg-[linear-gradient(to_right,#ffffff0a_1px,transparent_1px),linear-gradient(to_bottom,#ffffff0a_1px,transparent_1px)] bg-[size:20px_20px] pointer-events-none" />
                    <div className="absolute top-0 right-0 w-64 h-64 bg-emerald-500/10 rounded-full blur-3xl -mr-32 -mt-32 pointer-events-none" />
                    <h1 className="text-3xl font-black text-white mb-2 tracking-tight relative z-10">{activeMap.central_entity}</h1>
                    <div className="flex items-center gap-2 text-emerald-400/90 text-sm font-semibold relative z-10">
                        <Favicon url={activeMap.url} size={16} className="rounded-sm" />
                        {activeMap.url}
                    </div>
                </div>
                <div className="p-4 bg-slate-50">
                    <p className="text-slate-700 text-sm leading-relaxed">{activeMap.business_description}</p>
                </div>
            </div>

            {/* Key Topics - Horizontal Pills */}
            <div className="bg-white rounded-2xl shadow-sm border border-slate-200/80 p-5">
                <div className="flex items-center gap-3 mb-4">
                    <h3 className="text-[11px] font-black text-slate-400 tracking-widest uppercase">KEY TOPICS</h3>
                    {gapTopicsWithSource.length > 0 && (
                        <span className="text-[10px] font-black px-2 py-0.5 bg-amber-100 text-amber-700 border border-amber-200 rounded-full">
                            +{gapTopicsWithSource.length} from competitors
                        </span>
                    )}
                </div>
                <div className="flex flex-wrap gap-2.5">
                    {/* Primary topics */}
                    {activeMap.key_topics?.slice(0, 12).map((topic, idx) => (
                        <span key={idx} className="px-3.5 py-1.5 bg-emerald-50 text-emerald-700 border border-emerald-100/50 rounded-full text-sm font-bold hover:bg-emerald-100 transition-colors cursor-default">
                            {topic}
                        </span>
                    ))}
                    {/* Gap topics from competitors */}
                    {gapTopicsWithSource.map((g, idx) => {
                        const c = compColor(g.colorIdx);
                        return (
                            <span key={`gap-${idx}`} className={`inline-flex items-center gap-1.5 px-3 py-1.5 ${c.bg} border ${c.border} rounded-full text-sm font-bold cursor-default`}>
                                <span className={`w-1.5 h-1.5 rounded-full ${c.dot} flex-shrink-0`} />
                                <span className={c.text}>{g.topic}</span>
                                <span className={`text-[9px] ${c.text} opacity-60 font-black`}>{g.domain}</span>
                            </span>
                        );
                    })}
                </div>
            </div>

            {/* Business Overview - Two Column */}
            <div id="export-business-overview" className="bg-white rounded-2xl shadow-sm border border-slate-200/80 overflow-hidden">
                <SectionHeader title="Business Overview" color="from-slate-800 to-slate-900" icon={GlobeAltIcon} elementId="export-business-overview" />
                <div className="grid grid-cols-1 md:grid-cols-2 gap-px bg-slate-200">
                    <div className="bg-white p-4">
                        <h4 className="text-xs font-semibold text-slate-500 mb-2">BUSINESS MODEL</h4>
                        <p className="text-slate-800 font-medium">{activeMap.business_model}</p>
                    </div>
                    <div className="bg-white p-4">
                        <h4 className="text-xs font-semibold text-slate-500 mb-2">SEARCH INTENT</h4>
                        <div className="flex flex-wrap gap-1">
                            {activeMap.search_intent?.map((intent, idx) => (
                                <span key={idx} className="px-2 py-1 bg-emerald-50 text-emerald-700 rounded-md text-[10px] font-black uppercase tracking-wider border border-emerald-100">
                                    {intent}
                                </span>
                            ))}
                        </div>
                    </div>
                    <div className="bg-white p-4">
                        <h4 className="text-xs font-semibold text-slate-500 mb-2">TARGET AUDIENCES</h4>
                        <div className="space-y-1">
                            {activeMap.target_audiences?.slice(0, 3).map((audience, idx) => (
                                <div key={idx} className="text-sm text-slate-700">• {audience}</div>
                            ))}
                        </div>
                    </div>
                    <div className="bg-white p-4">
                        <h4 className="text-xs font-semibold text-slate-500 mb-2">CONVERSION METHODS</h4>
                        <div className="space-y-1">
                            {activeMap.conversion_methods?.slice(0, 3).map((method, idx) => (
                                <div key={idx} className="text-sm text-slate-700">• {method}</div>
                            ))}
                        </div>
                    </div>
                </div>
            </div>

            {/* Semantic Analysis */}
            {activeMap.semantic_relationships && (
                <div id="export-semantic-analysis" className="bg-white rounded-lg shadow-sm border border-slate-200 overflow-hidden">
                <SectionHeader
                    title="Semantic Analysis"
                    color="from-slate-800 to-slate-900"
                    icon={SparklesIcon}
                        section="semantic"
                        elementId="export-semantic-analysis"
                    />
                    {expandedSections.semantic && (
                        <div className="p-4">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                {/* Core Entities */}
                                {activeMap.semantic_relationships.core_entities?.length > 0 && (
                                    <div className="border border-slate-200 rounded-lg p-3">
                                        <h4 className="text-[10px] font-black text-slate-400 mb-2 tracking-widest uppercase">CORE ENTITIES</h4>
                                        <div className="flex flex-wrap gap-1">
                                            {activeMap.semantic_relationships.core_entities.map((entity, idx) => (
                                                <span key={idx} className="px-2 py-1 bg-emerald-50 text-emerald-700 rounded text-xs font-bold border border-emerald-100/50">
                                                    {entity}
                                                </span>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                {/* Derived Entities */}
                                {activeMap.semantic_relationships.derived_entities?.length > 0 && (
                                    <div className="border border-slate-200 rounded-lg p-3">
                                        <h4 className="text-[10px] font-black text-slate-400 mb-2 tracking-widest uppercase">DERIVED ENTITIES</h4>
                                        <div className="flex flex-wrap gap-1">
                                            {activeMap.semantic_relationships.derived_entities.map((entity, idx) => (
                                                <span key={idx} className="px-2 py-1 bg-slate-100 text-slate-700 rounded text-xs font-bold border border-slate-200">
                                                    {entity}
                                                </span>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                {/* Attributes */}
                                {activeMap.semantic_relationships.attributes?.length > 0 && (
                                        <div className="bg-slate-50 border border-slate-200 rounded-xl p-4">
                                            <h4 className="text-[10px] font-black text-slate-400 mb-3 tracking-widest uppercase">ATTRIBUTES</h4>
                                            <div className="flex flex-wrap gap-2">
                                                {activeMap.semantic_relationships.attributes.map((attr, idx) => (
                                                    <span key={idx} className="px-2.5 py-1 bg-emerald-100/50 text-emerald-800 rounded-md text-xs font-bold border border-emerald-200/50">
                                                        {attr}
                                                    </span>
                                                ))}
                                            </div>
                                        </div>
                                )}

                                {/* Context Terms */}
                                {activeMap.semantic_relationships.context_terms?.length > 0 && (
                                        <div className="bg-slate-50 border border-slate-200 rounded-xl p-4">
                                            <h4 className="text-[10px] font-black text-slate-400 mb-3 tracking-widest uppercase">CONTEXT TERMS</h4>
                                            <div className="flex flex-wrap gap-2">
                                                {activeMap.semantic_relationships.context_terms.map((term, idx) => (
                                                    <span key={idx} className="px-2.5 py-1 bg-amber-100/50 text-amber-800 rounded-md text-xs font-bold border border-amber-200/50">
                                                        {term}
                                                    </span>
                                                ))}
                                            </div>
                                        </div>
                                )}
                            </div>
                        </div>
                    )}
                </div>
            )}

            {/* Content Strategy */}
            {activeMap.content_strategy && (
                <div id="export-content-strategy" className="bg-white rounded-lg shadow-sm border border-slate-200 overflow-hidden">
                    <SectionHeader
                        title="Content Strategy"
                        color="from-slate-800 to-slate-900"
                        icon={LightBulbIcon}
                        section="content"
                        elementId="export-content-strategy"
                    />
                    {expandedSections.content && (
                        <div className="p-4">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                {/* Core Topics */}
                                {activeMap.content_strategy.core_topics?.length > 0 && (
                                    <div className="border-l-4 border-emerald-500 bg-emerald-50/50 p-4 rounded-r-xl">
                                        <h4 className="text-sm font-black text-emerald-800 mb-2 tracking-tight">Core Topics (Revenue)</h4>
                                        <ul className="space-y-1.5">
                                            {activeMap.content_strategy.core_topics.map((topic, idx) => (
                                                <li key={idx} className="text-sm text-slate-700 font-medium">• {topic}</li>
                                            ))}
                                        </ul>
                                    </div>
                                )}

                                {/* Outer Topics */}
                                {activeMap.content_strategy.outer_topics?.length > 0 && (
                                    <div className="border-l-4 border-slate-400 bg-slate-50/50 p-4 rounded-r-xl">
                                        <h4 className="text-sm font-black text-slate-800 mb-2 tracking-tight">Outer Topics (Authority)</h4>
                                        <ul className="space-y-1.5">
                                            {activeMap.content_strategy.outer_topics.map((topic, idx) => (
                                                <li key={idx} className="text-sm text-slate-600 font-medium leading-relaxed">• {topic}</li>
                                            ))}
                                        </ul>
                                    </div>
                                )}

                                {/* Competitor Core Topic Gaps */}
                                {competitorCoreTopics.length > 0 && (
                                    <div className="border-l-4 border-violet-400 bg-violet-50/50 p-4 rounded-r-xl">
                                        <h4 className="text-sm font-black text-violet-800 mb-2 tracking-tight">Gap Topics from Competitors</h4>
                                        <ul className="space-y-1.5">
                                            {competitorCoreTopics.map((g, idx) => {
                                                const c = compColor(g.colorIdx);
                                                return (
                                                    <li key={idx} className="flex items-center gap-2 text-sm text-slate-700 font-medium">
                                                        <span className={`w-1.5 h-1.5 rounded-full ${c.dot} flex-shrink-0`} />
                                                        {g.topic}
                                                        <span className={`text-[9px] ${c.text} ${c.bg} border ${c.border} px-1.5 py-0.5 rounded font-black`}>{g.domain}</span>
                                                    </li>
                                                );
                                            })}
                                        </ul>
                                    </div>
                                )}

                                {/* Content Gaps */}
                                {activeMap.content_strategy.content_gaps?.length > 0 && (
                                    <div className="border-l-4 border-amber-500 bg-amber-50/50 p-4 rounded-r-xl md:col-span-2">
                                        <h4 className="text-sm font-black text-amber-800 mb-3 tracking-tight">Content Gaps & Opportunities</h4>
                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-1.5">
                                            {activeMap.content_strategy.content_gaps.map((gap, idx) => (
                                                <div key={idx} className="text-sm text-slate-700 font-medium">• {gap}</div>
                                            ))}
                                        </div>
                                    </div>
                                )}

                            </div>
                        </div>
                    )}
                </div>
            )}

            {/* Taxonomy Structure */}
            {activeMap.taxonomy && (
                <div id="export-taxonomy-structure" className="bg-white rounded-lg shadow-sm border border-slate-200 overflow-hidden">
                    <SectionHeader
                        title="Taxonomy"
                        color="from-slate-800 to-slate-900"
                        icon={Squares2X2Icon}
                        section="taxonomy"
                        count={activeMap.taxonomy.length}
                        elementId="export-taxonomy-structure"
                    />
                    {expandedSections.taxonomy && (
                        <div className="p-4">
                            {/* Group by level */}
                            {[1, 2, 3].map(level => {
                                const nodesAtLevel = activeMap.taxonomy.filter(node => node.level === level);
                                if (nodesAtLevel.length === 0) return null;

                                return (
                                    <div key={level} className="mb-4 last:mb-0">
                                        <h4 className="text-xs font-semibold text-slate-500 mb-2 uppercase">
                                            Level {level} {level === 1 ? '(Main Categories)' : level === 2 ? '(Subcategories)' : '(Sub-subcategories)'}
                                        </h4>
                                        <div className="flex flex-wrap gap-2">
                                            {nodesAtLevel.map((node, idx) => (
                                                <div
                                                    key={idx}
                                                    className="px-3 py-2 rounded-lg text-sm font-medium text-white shadow-sm"
                                                    style={{ backgroundColor: node.level === 1 ? '#0f172a' : node.level === 2 ? '#059669' : '#64748b' }}
                                                >
                                                    {node.name}
                                                    {node.children && node.children.length > 0 && (
                                                        <span className="ml-2 text-xs opacity-75">
                                                            ({node.children.length})
                                                        </span>
                                                    )}
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            )}

            {/* Taxonomy Visualization */}
            {activeMap.taxonomy && (
                <div id="export-taxonomy-visualization" className="bg-white rounded-lg shadow-sm border border-slate-200 overflow-hidden">
                    <SectionHeader
                        title="Taxonomy Visualization"
                        color="from-slate-800 to-slate-900"
                        icon={Squares2X2Icon}
                        elementId="export-taxonomy-visualization"
                    />
                    <div className="p-6 bg-slate-50">
                        <div className="overflow-x-auto">
                            <div className="inline-block min-w-full">
                                {/* Build tree structure */}
                                {(() => {
                                    // Get level 1 nodes (root nodes)
                                    const level1Nodes = activeMap.taxonomy.filter(node => node.level === 1);

                                    return (
                                        <div className="flex flex-col items-center gap-8">
                                            {level1Nodes.map((l1Node, l1Idx) => (
                                                <div key={l1Idx} className="flex flex-col items-center">
                                                    {/* Level 1 Node */}
                                                    <div
                                                        className="px-6 py-3 rounded-lg text-sm font-semibold text-white shadow-md border-2 border-white"
                                                        style={{ backgroundColor: l1Node.color || '#0f172a' }}
                                                    >
                                                        {l1Node.name}
                                                    </div>

                                                    {/* Connector line */}
                                                    {l1Node.children && l1Node.children.length > 0 && (
                                                        <div className="w-0.5 h-8 bg-slate-300"></div>
                                                    )}

                                                    {/* Level 2 Nodes */}
                                                    {l1Node.children && l1Node.children.length > 0 && (
                                                        <div className="flex gap-4 relative">
                                                            {/* Horizontal connector */}
                                                            <div className="absolute top-0 left-0 right-0 h-0.5 bg-slate-300" style={{ top: '-16px' }}></div>

                                                            {l1Node.children.map((l2Name, l2Idx) => {
                                                                const l2Node = activeMap.taxonomy.find(n => n.name === l2Name && n.level === 2);
                                                                if (!l2Node) return null;

                                                                return (
                                                                    <div key={l2Idx} className="flex flex-col items-center">
                                                                        {/* Vertical connector to L2 */}
                                                                        <div className="w-0.5 h-4 bg-slate-300"></div>

                                                                        {/* Level 2 Node */}
                                                                        <div
                                                                            className="px-4 py-2 rounded-lg text-xs font-medium text-white shadow-sm"
                                                                            style={{ backgroundColor: l2Node.color || '#059669' }}
                                                                        >
                                                                            {l2Node.name}
                                                                        </div>

                                                                        {/* Connector to L3 */}
                                                                        {l2Node.children && l2Node.children.length > 0 && (
                                                                            <div className="w-0.5 h-6 bg-slate-300"></div>
                                                                        )}

                                                                        {/* Level 3 Nodes */}
                                                                        {l2Node.children && l2Node.children.length > 0 && (
                                                                            <div className="flex flex-col gap-2">
                                                                                {l2Node.children.map((l3Name, l3Idx) => {
                                                                                    const l3Node = activeMap.taxonomy.find(n => n.name === l3Name && n.level === 3);
                                                                                    if (!l3Node) return null;

                                                                                    return (
                                                                                        <div
                                                                                            key={l3Idx}
                                                                                            className="px-3 py-1.5 rounded text-xs font-medium text-white shadow-sm"
                                                                                            style={{ backgroundColor: l3Node.color || '#64748b' }}
                                                                                        >
                                                                                            {l3Node.name}
                                                                                        </div>
                                                                                    );
                                                                                })}
                                                                            </div>
                                                                        )}
                                                                    </div>
                                                                );
                                                            })}
                                                        </div>
                                                    )}
                                                </div>
                                            ))}
                                        </div>
                                    );
                                })()}
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Ontology Relationships */}
            {activeMap.ontology && (
                <div id="export-ontology-relationships" className="bg-white rounded-lg shadow-sm border border-slate-200 overflow-hidden">
                    <SectionHeader
                        title="Ontology"
                        color="from-slate-800 to-slate-900"
                        icon={TableCellsIcon}
                        section="ontology"
                        count={activeMap.ontology.length}
                        elementId="export-ontology-relationships"
                    />
                    {expandedSections.ontology && (
                        <div className="p-4">
                            <div className="overflow-x-auto">
                                <table className="w-full border-collapse">
                                    <thead>
                                        <tr className="bg-slate-900">
                                            <th className="px-4 py-2 text-left text-[10px] font-black text-slate-300 uppercase tracking-widest">
                                                Subject
                                            </th>
                                            <th className="px-4 py-2 text-left text-[10px] font-black text-slate-300 uppercase tracking-widest">
                                                Predicate
                                            </th>
                                            <th className="px-4 py-2 text-left text-[10px] font-black text-slate-300 uppercase tracking-widest">
                                                Object
                                            </th>
                                            <th className="px-4 py-2 text-left text-[10px] font-black text-slate-300 uppercase tracking-widest">
                                                Context
                                            </th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {activeMap.ontology.map((relation, idx) => (
                                            <tr key={idx} className="hover:bg-emerald-50/50 transition-colors border-b border-slate-100 last:border-0">
                                                <td className="border border-slate-200 px-4 py-2 text-sm text-slate-700">
                                                    {relation.subject}
                                                </td>
                                                <td className="px-4 py-2 text-sm text-emerald-600 font-bold italic">
                                                    {relation.predicate}
                                                </td>
                                                <td className="border border-slate-200 px-4 py-2 text-sm text-slate-700">
                                                    {relation.object}
                                                </td>
                                                <td className="border border-slate-200 px-4 py-2 text-sm text-slate-600 italic">
                                                    {relation.context}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    )}
                </div>
            )}

            {/* Audience Segments */}
            {activeMap.audience_segments && activeMap.audience_segments.length > 0 && (
                <div id="export-audience-segments" className="bg-white rounded-lg shadow-sm border border-slate-200 overflow-hidden">
                    <SectionHeader
                        title="Audience Segments"
                        color="from-slate-800 to-slate-900"
                        icon={UserGroupIcon}
                        section="audience"
                        count={activeMap.audience_segments.length}
                        elementId="export-audience-segments"
                    />
                    {expandedSections.audience && (
                        <div className="p-4">
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                {activeMap.audience_segments.map((segment, idx) => (
                                    <div key={idx} className="border border-slate-200 rounded-xl p-4 bg-slate-50/50 hover:bg-white transition-all shadow-sm">
                                        <div className="flex items-center gap-2 mb-3">
                                            <UserGroupIcon className="w-5 h-5 text-emerald-600" />
                                            <h4 className="text-sm font-black text-slate-800">{segment.expertise_level}</h4>
                                        </div>

                                        <div className="space-y-3">
                                            <div>
                                                <p className="text-xs font-semibold text-slate-600 mb-1">Goal:</p>
                                                <p className="text-sm text-slate-700">{segment.primary_goal}</p>
                                            </div>

                                            {segment.content_types && segment.content_types.length > 0 && (
                                                <div>
                                                    <p className="text-xs font-semibold text-slate-600 mb-1">Content Types:</p>
                                                    <div className="flex flex-wrap gap-1">
                                                        {segment.content_types.map((type, typeIdx) => (
                                                            <span key={typeIdx} className="text-xs px-2 py-0.5 bg-white rounded text-slate-700">
                                                                {type}
                                                            </span>
                                                        ))}
                                                    </div>
                                                </div>
                                            )}

                                            {segment.pain_points && segment.pain_points.length > 0 && (
                                                <div>
                                                    <p className="text-xs font-semibold text-slate-600 mb-1">Pain Points:</p>
                                                    <ul className="text-xs text-slate-600 space-y-0.5">
                                                        {segment.pain_points.slice(0, 3).map((pain, painIdx) => (
                                                            <li key={painIdx}>• {pain}</li>
                                                        ))}
                                                    </ul>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            )}

            {/* Tools & Platforms */}
            {activeMap.technology_stack && activeMap.technology_stack.length > 0 && (
                <div id="export-tools-platforms" className="bg-white rounded-lg shadow-sm border border-slate-200 overflow-hidden">
                    <SectionHeader
                        title="Tools & Platforms"
                        color="from-slate-800 to-slate-900"
                        icon={WrenchScrewdriverIcon}
                        section="tools"
                        count={activeMap.technology_stack.length}
                        elementId="export-tools-platforms"
                    />
                    {expandedSections.tools && (
                        <div className="p-4">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                {activeMap.technology_stack.map((tech, idx) => (
                                    <div key={idx} className="border border-slate-200 rounded-xl p-4 bg-slate-50/50 hover:bg-white transition-all shadow-sm">
                                        <div className="flex items-center gap-2 mb-2">
                                            <WrenchScrewdriverIcon className="w-5 h-5 text-emerald-600" />
                                            <h4 className="text-sm font-black text-slate-800">{tech}</h4>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            )}

            {/* Query Research */}
            {activeMap.query_templates && (
                <div id="export-query-research" className="bg-white rounded-lg shadow-sm border border-slate-200 overflow-hidden">
                    <SectionHeader
                        title="Query Research"
                        color="from-slate-800 to-slate-900"
                        icon={MagnifyingGlassIcon}
                        section="queries"
                        elementId="export-query-research"
                    />
                    {expandedSections.queries && (
                        <div className="p-4 space-y-3">
                            {Object.entries(activeMap.query_templates).map(([type, queries]) => {
                                if (!queries || queries.length === 0) return null;
                                const colors = {
                                    informational: 'emerald',
                                    transactional: 'teal',
                                    commercial: 'slate',
                                    navigational: 'amber',
                                    contextual: 'emerald',
                                    audience_specific: 'teal',
                                    predictive: 'slate',
                                    voice_search: 'emerald',
                                    raw_queries: 'slate'
                                };
                                const color = colors[type] || 'slate';
                                const colorClass = color === 'emerald' ? 'emerald' : color === 'teal' ? 'teal' : color === 'amber' ? 'amber' : 'slate';
                                return (
                                    <div key={type} className="border border-slate-200 rounded p-3">
                                        <h4 className={`text-[10px] font-black text-${colorClass}-600 mb-2 uppercase tracking-widest`}>
                                            {type.replace(/_/g, ' ')}
                                        </h4>
                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-1.5">
                                            {queries.slice(0, 10).map((query, idx) => (
                                                <div key={idx} className={`text-xs text-slate-700 bg-${colorClass}-100/50 px-2.5 py-1.5 rounded-md border border-${colorClass}-200/30`}>
                                                    {query}
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            )}

            {/* Competitive Analysis */}
            {activeMap.competitive_analysis && (
                <div id="export-competitive-analysis" className="bg-white rounded-lg shadow-sm border border-slate-200 overflow-hidden">
                    <SectionHeader
                        title="Competitive Analysis"
                        color="from-slate-800 to-slate-900"
                        icon={TrophyIcon}
                        section="competitive"
                        count={activeMap.competitive_analysis.top_competitors?.length}
                        elementId="export-competitive-analysis"
                    />
                    {expandedSections.competitive && (
                        <div className="p-4">
                            {/* Top Competitors */}
                            <div className="mb-4">
                                <h4 className="text-sm font-semibold text-slate-700 mb-3">Top Competitors</h4>
                                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
                                    {activeMap.competitive_analysis.top_competitors?.map((competitor, idx) => (
                                        <div key={idx} className="bg-amber-50 border border-amber-100 rounded-lg px-3 py-2 text-sm text-amber-900 font-bold shadow-sm hover:bg-amber-100 transition-all">
                                            {competitor}
                                        </div>
                                    ))}
                                </div>
                            </div>

                            {/* SERP Insights */}
                            {activeMap.competitive_analysis.serp_insights?.length > 0 && (
                                <div className="border-t border-slate-200 pt-4">
                                    <h4 className="text-sm font-semibold text-slate-700 mb-2">SERP Insights</h4>
                                    <div className="space-y-1">
                                        {activeMap.competitive_analysis.serp_insights.slice(0, 10).map((insight, idx) => (
                                            <div key={idx} className="text-sm text-slate-600 bg-slate-50 px-3 py-1.5 rounded">
                                                {insight}
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            )}

            {/* Content Plan — merged primary + competitor articles */}
            {mergedArticles.length > 0 && (
                <div id="export-content-plan" className="bg-white rounded-lg shadow-sm border border-slate-200 overflow-hidden">
                    <SectionHeader
                        title="Content Plan"
                        color="from-slate-800 to-slate-900"
                        icon={DocumentTextIcon}
                        section="articles"
                        count={mergedArticles.length}
                        elementId="export-content-plan"
                    />
                    {expandedSections.articles && (
                        <div className="p-4">
                            {/* Table */}
                            <div className="overflow-x-auto">
                                <table className="w-full border-collapse">
                                    <thead>
                                        <tr className="bg-slate-50 border-b border-slate-200">
                                            <th className="px-4 py-3 text-left text-xs font-semibold text-slate-700 uppercase tracking-wider">
                                                Article Title <span className="hidden sm:inline-block"><ChevronUpDownIcon className="inline w-3.5 h-3.5 text-slate-400 ml-0.5" /></span>
                                            </th>
                                            <th className="px-3 py-3 text-left text-xs font-semibold text-slate-700 uppercase tracking-wider">Source</th>
                                            <th className="px-4 py-3 text-left text-xs font-semibold text-slate-700 uppercase tracking-wider">
                                                Section <span className="hidden sm:inline-block"><ChevronUpDownIcon className="inline w-3.5 h-3.5 text-slate-400 ml-0.5" /></span>
                                            </th>
                                            <th className="px-4 py-3 text-left text-xs font-semibold text-slate-700 uppercase tracking-wider">
                                                Article Type
                                            </th>
                                            <th className="px-4 py-3 text-left text-xs font-semibold text-slate-700 uppercase tracking-wider w-8 text-center">
                                                Actions
                                            </th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {mergedArticles.map((article, idx) => {
                                            const isComp = !article._isPrimary;
                                            const ci = article._colorIdx ?? 0;
                                            const c = isComp ? compColor(ci) : null;
                                            return (
                                            <tr key={idx} className={`border-b border-slate-100 hover:bg-slate-50 transition-colors ${isComp ? 'bg-violet-50/30' : ''}`}>
                                                <td className="px-4 py-3 text-sm text-slate-700">{article.title}</td>
                                                <td className="px-3 py-3">
                                                    {isComp ? (
                                                        <span className={`inline-flex items-center gap-1 px-2 py-1 rounded text-[10px] font-black ${c.bg} ${c.text} border ${c.border}`}>
                                                            <span className={`w-1.5 h-1.5 rounded-full ${c.dot}`} />
                                                            {article._domain}
                                                        </span>
                                                    ) : (
                                                        <span className="inline-flex items-center gap-1 px-2 py-1 rounded text-[10px] font-black bg-emerald-100 text-emerald-700 border border-emerald-200">
                                                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                                                            Primary
                                                        </span>
                                                    )}
                                                </td>
                                                <td className="px-4 py-3">
                                                    <span className={`inline-block px-2.5 py-1 rounded-md text-[10px] font-black uppercase tracking-wider ${article.section === 'Core' ? 'bg-emerald-100 text-emerald-800 border border-emerald-200/50' : 'bg-slate-100 text-slate-700 border border-slate-200'}`}>
                                                        {article.section}
                                                    </span>
                                                </td>
                                                <td className="px-4 py-3">
                                                    <span className="inline-block px-2 py-1 rounded text-xs font-medium bg-slate-600 text-white">
                                                        {article.article_type}
                                                    </span>
                                                </td>
                                                <td className="px-4 py-3 text-center">
                                                    <button
                                                        onClick={() => handleGenerateArticle(article)}
                                                        disabled={!!generatingArticle}
                                                        className={`inline-flex items-center gap-x-1.5 rounded-lg px-3 py-1.5 text-xs font-bold shadow-sm transition-all
                                                            ${generatingArticle === article.title
                                                                ? 'bg-emerald-100 text-emerald-600 cursor-wait'
                                                                : generatingArticle
                                                                ? 'bg-slate-50 text-slate-400 cursor-not-allowed'
                                                                : 'bg-emerald-600 text-white hover:bg-emerald-700'
                                                            }`}
                                                    >
                                                        <SparklesIcon className={`-ml-0.5 h-3.5 w-3.5 ${generatingArticle === article.title ? 'animate-spin' : ''}`} />
                                                        {generatingArticle === article.title ? 'Writing…' : 'Write'}
                                                    </button>
                                                </td>
                                            </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    )}
                </div>
            )}

            {/* SEO Optimization */}
            {activeMap.seo_optimization && (
                <div id="export-seo-optimization" className="bg-white rounded-lg shadow-sm border border-slate-200 overflow-hidden">
                    <SectionHeader
                        title="SEO Optimization"
                        color="from-slate-800 to-slate-900"
                        icon={ChartBarIcon}
                        section="seo"
                        elementId="export-seo-optimization"
                    />
                    {expandedSections.seo && (
                        <div className="p-4">
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                {/* Topic Clusters */}
                                {activeMap.seo_optimization.topic_clusters?.length > 0 && (
                                    <div className="border border-emerald-200/50 rounded-xl p-4 bg-emerald-50/50">
                                        <h4 className="text-[10px] font-black text-emerald-800 mb-3 tracking-widest uppercase">Topic Clusters</h4>
                                        <ul className="space-y-1.5">
                                            {activeMap.seo_optimization.topic_clusters.map((cluster, idx) => (
                                                <li key={idx} className="text-sm text-slate-700 font-medium leading-relaxed">• {cluster}</li>
                                            ))}
                                        </ul>
                                    </div>
                                )}

                                {/* Schema Recommendations */}
                                {activeMap.seo_optimization.schema_recommendations?.length > 0 && (
                                    <div className="border border-slate-200 rounded-xl p-4 bg-slate-50">
                                        <h4 className="text-[10px] font-black text-slate-800 mb-3 tracking-widest uppercase">Schema Markup</h4>
                                        <ul className="space-y-1.5">
                                            {activeMap.seo_optimization.schema_recommendations.map((schema, idx) => (
                                                <li key={idx} className="text-sm text-slate-700 font-medium leading-relaxed">✓ {schema}</li>
                                            ))}
                                        </ul>
                                    </div>
                                )}

                                {activeMap.seo_optimization.entity_optimization?.length > 0 && (
                                    <div className="border border-emerald-200/50 rounded-xl p-4 bg-emerald-50/50">
                                        <h4 className="text-[10px] font-black text-emerald-800 mb-3 tracking-widest uppercase">Entity Optimization</h4>
                                        <ul className="space-y-1.5">
                                            {activeMap.seo_optimization.entity_optimization.map((tip, idx) => (
                                                <li key={idx} className="text-sm text-slate-700 font-medium leading-relaxed">→ {tip}</li>
                                            ))}
                                        </ul>
                                    </div>
                                )}
                            </div>
                        </div>
                    )}
                </div>
            )}
        </div>
        </>
    );
};

export default TopicalMap;

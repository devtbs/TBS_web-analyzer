import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import api from '../api/axios';
import { toast } from 'react-hot-toast';
import { 
    ArrowLeftIcon, 
    DocumentDuplicateIcon,
    SparklesIcon,
    ChevronDownIcon,
    AdjustmentsHorizontalIcon,
} from '@heroicons/react/24/outline';
import { CheckCircleIcon, ChevronUpIcon } from '@heroicons/react/24/solid';
import ArticleEditor from '../components/editor/ArticleEditor';

// ── Writing settings config ──────────────────────────────────────────────────
const TONE_OPTIONS = [
    { value: 'professional',   label: 'Professional',   desc: 'Formal & authoritative' },
    { value: 'conversational', label: 'Conversational', desc: 'Friendly & approachable' },
    { value: 'persuasive',     label: 'Persuasive',     desc: 'Compelling & action-driven' },
    { value: 'educational',    label: 'Educational',    desc: 'Clear & instructional' },
    { value: 'storytelling',   label: 'Storytelling',   desc: 'Narrative & immersive' },
    { value: 'journalistic',   label: 'Journalistic',   desc: 'Factual & magazine-style' },
];

const LENGTH_OPTIONS = [
    { value: 'short',    label: 'Short',    desc: '600–800 words' },
    { value: 'medium',   label: 'Medium',   desc: '1,000–1,400 words' },
    { value: 'long',     label: 'Long',     desc: '1,800–2,400 words' },
    { value: 'in-depth', label: 'In-Depth', desc: '3,000+ words' },
];

const LANGUAGE_OPTIONS = [
    { value: 'en', label: '🇬🇧 English' },
    { value: 'th', label: '🇹🇭 Thai' },
];

// ── Small selector chip ──────────────────────────────────────────────────────
function OptionChip({ selected, onClick, label, desc }) {
    return (
        <button
            type="button"
            onClick={onClick}
            className={`flex flex-col items-start px-3 py-2 rounded-lg border text-left transition-all text-sm ${
                selected
                    ? 'bg-blue-50 border-blue-400 text-blue-700'
                    : 'bg-white border-slate-200 text-slate-600 hover:border-slate-300 hover:bg-slate-50'
            }`}
        >
            <span className="font-bold leading-tight">{label}</span>
            {desc && <span className="text-[11px] opacity-70 mt-0.5">{desc}</span>}
        </button>
    );
}

export default function DocumentDetail() {
    const { documentId } = useParams();
    const navigate = useNavigate();
    const [documentData, setDocumentData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);
    const [copied, setCopied] = useState(false);

    // Writing settings state
    const [settingsOpen, setSettingsOpen] = useState(true);
    const [tone, setTone] = useState('professional');
    const [length, setLength] = useState('medium');
    const [language, setLanguage] = useState('en');
    const [audience, setAudience] = useState('');
    const [customInstructions, setCustomInstructions] = useState('');

    useEffect(() => {
        fetchDocument();
    }, [documentId]);
    
    const fetchDocument = async () => {
        try {
            const response = await api.get(`/api/documents/${documentId}`);
            setDocumentData(response.data);
            // Pre-fill audience from brief if available
            if (response.data?.content?.target_audience) {
                setAudience(response.data.content.target_audience);
            }
        } catch (error) {
            console.error('Failed to fetch document:', error);
            toast.error('Failed to load document details');
            navigate('/documents');
        } finally {
            setLoading(false);
        }
    };

    const handleCopy = () => {
        if (!documentData || !documentData.content) return;
        
        const briefData = documentData.content;
        const contentToCopy = `
# Content Brief: ${documentData.title}

## Overview
- Search Intent: ${briefData.search_intent}
- Target Audience: ${briefData.target_audience}

## Titles
${briefData.title_ideas?.map(title => `- ${title}`).join('\n')}

## Meta Description
${briefData.meta_description}

## Keywords
- Primary: ${briefData.primary_keywords?.join(', ')}
- Secondary: ${briefData.secondary_keywords?.join(', ')}

## Outline
${briefData.outline?.map(item => `
### ${item.heading}
${item.talking_points?.map(point => `- ${point}`).join('\n')}
`).join('\n')}

## Competitor Insights
${briefData.competitor_insights?.map(insight => `- ${insight}`).join('\n')}

## Internal Linking
${briefData.internal_linking_suggestions?.map(link => `- ${link}`).join('\n')}
        `.trim();

        navigator.clipboard.writeText(contentToCopy).then(() => {
            setCopied(true);
            toast.success('Brief copied to clipboard!', { icon: '📝' });
            setTimeout(() => setCopied(false), 2000);
        });
    };

    const handleSave = async (htmlContent) => {
        setIsSaving(true);
        try {
            await api.put(`/api/documents/${documentId}`, {
                content: {
                    ...documentData.content,
                    article_markdown: htmlContent 
                }
            });
            setDocumentData(prev => ({
                ...prev,
                content: {
                    ...prev.content,
                    article_markdown: htmlContent
                }
            }));
            toast.success('Document saved successfully');
        } catch (error) {
            console.error('Error saving document:', error);
            toast.error('Failed to save document');
        } finally {
            setIsSaving(false);
        }
    };

    const handleTitleChange = async (newTitle) => {
        try {
            await api.put(`/api/documents/${documentId}`, { title: newTitle });
            setDocumentData(prev => ({ ...prev, title: newTitle }));
            window.dispatchEvent(new CustomEvent('documents-updated'));
        } catch (error) {
            console.error('Failed to update title:', error);
            toast.error('Failed to save title');
        }
    };

    const handleGenerateArticle = async () => {
        setLoading(true);
        try {
            const res = await api.post(
                `/api/documents/${documentId}/generate-article`,
                {
                    language,
                    tone,
                    length,
                    audience: audience.trim(),
                    custom_instructions: customInstructions.trim(),
                },
                { timeout: 120000 }
            );
            setDocumentData({
                ...documentData,
                content_type: 'Full Article',
                content: { ...documentData.content, article_markdown: res.data.article },
            });
            toast.success('Article generated successfully!', { icon: '🎉' });
        } catch (error) {
            console.error('Failed to generate article:', error);
            toast.error('Failed to generate article.');
        } finally {
            setLoading(false);
        }
    };

    if (loading) {
        return (
            <div className="flex justify-center items-center h-full min-h-screen">
                <div className="flex flex-col items-center">
                    <div className="w-10 h-10 border-4 border-slate-200 border-t-blue-600 rounded-full animate-spin"></div>
                    <p className="mt-4 text-slate-500 font-medium">Loading Document...</p>
                </div>
            </div>
        );
    }

    if (!documentData) return null;

    const briefData = documentData.content;
    const isFullArticle = documentData.content_type === "Full Article" || briefData.article_markdown;

    if (isFullArticle) {
        return (
            <div className="flex flex-col h-screen w-full bg-white m-0 p-0 overflow-hidden border-t border-slate-200">
                <ArticleEditor
                    documentId={documentId}
                    title={documentData.title}
                    initialMarkdown={briefData.article_markdown}
                    onSave={handleSave}
                    onTitleChange={handleTitleChange}
                    isSaving={isSaving}
                    onClose={() => navigate('/documents')}
                    lastSavedAt={documentData.updated_at}
                />
            </div>
        );
    }

    return (
        <div className="p-8 max-w-6xl mx-auto min-h-screen pb-24">
            <button 
                onClick={() => navigate('/documents')}
                className="mb-6 flex items-center text-sm font-semibold text-slate-500 hover:text-slate-900 transition-colors"
            >
                <ArrowLeftIcon className="w-4 h-4 mr-1" />
                Back to Documents
            </button>

            <div className="bg-white rounded-3xl p-8 md:p-12 shadow-sm border border-slate-200/60 relative overflow-hidden max-w-4xl">
                {/* Header Graphic */}
                <div className="absolute top-0 right-0 -mr-16 -mt-16 w-64 h-64 bg-slate-50 rounded-full opacity-60 pointer-events-none" />
                <div className="absolute top-0 right-0 p-8 z-20">
                    <button
                        onClick={handleCopy}
                        className={`inline-flex items-center gap-x-2 rounded-lg px-4 py-2.5 text-sm font-bold shadow-sm ring-1 ring-inset transition-all ${
                            copied 
                                ? 'bg-green-50 text-green-700 ring-green-600/20' 
                                : 'bg-white text-slate-900 ring-slate-300 hover:bg-slate-50'
                        }`}
                    >
                        {copied ? (
                            <><CheckCircleIcon className="-ml-0.5 h-5 w-5" /> Copied!</>
                        ) : (
                            <><DocumentDuplicateIcon className="-ml-0.5 h-5 w-5" /> Copy Document</>
                        )}
                    </button>
                </div>

                <div className="relative z-10">
                    <div className="flex items-center gap-3 mb-4">
                        <span className="px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider bg-blue-50 text-blue-700">
                            Content Brief
                        </span>
                        <span className="text-slate-400 text-sm font-medium">
                            {new Date(documentData.created_at).toLocaleDateString()}
                        </span>
                    </div>
                    
                    <h1 className="text-4xl md:text-5xl font-black tracking-tight text-slate-900 mb-6 leading-tight max-w-3xl">
                        {documentData.title}
                    </h1>

                    <div className="h-1 w-20 rounded mb-10 bg-blue-600"></div>
                    
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-12">
                                <div className="bg-slate-50 rounded-2xl p-6 border border-slate-100">
                                    <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">Search Intent</h3>
                                    <p className="text-slate-900 font-medium capitalize">{briefData.search_intent}</p>
                                </div>
                                <div className="bg-slate-50 rounded-2xl p-6 border border-slate-100">
                                    <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">Target Audience</h3>
                                    <p className="text-slate-900 font-medium">{briefData.target_audience}</p>
                                </div>
                            </div>

                            <div className="space-y-12">
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                                    <section>
                                        <h2 className="flex items-center text-xl font-bold text-slate-900 mb-4 pb-2 border-b border-slate-100">
                                            <SparklesIcon className="w-5 h-5 mr-2 text-blue-500" />
                                            Top Title Ideas
                                        </h2>
                                        <ul className="space-y-3">
                                            {briefData.title_ideas?.map((title, i) => (
                                                <li key={i} className="flex gap-3 text-slate-700 font-bold p-3 bg-white border border-slate-200 rounded-xl hover:border-blue-400 transition-colors shadow-sm">
                                                    <span className="text-slate-400 select-none">{i + 1}.</span>
                                                    {title}
                                                </li>
                                            ))}
                                        </ul>
                                    </section>

                                    <section>
                                        <h2 className="text-xl font-bold text-slate-900 mb-4 pb-2 border-b border-slate-100">
                                            Meta Description
                                        </h2>
                                        <div className="p-4 bg-slate-800 text-slate-300 rounded-xl shadow-inner font-mono text-sm leading-relaxed relative overflow-hidden group">
                                            <div className="absolute top-0 left-0 w-1 h-full bg-blue-500"></div>
                                            "{briefData.meta_description}"
                                        </div>
                                    </section>
                                </div>

                                <section>
                                    <h2 className="text-xl font-bold text-slate-900 mb-6 pb-2 border-b border-slate-100">
                                        Target Keywords
                                    </h2>
                                    <div className="space-y-6">
                                        <div>
                                            <h4 className="text-sm font-bold text-slate-500 mb-3 uppercase tracking-wider">Primary</h4>
                                            <div className="flex flex-wrap gap-2">
                                                {briefData.primary_keywords?.map((kw, i) => (
                                                    <span key={i} className="inline-flex items-center px-3 py-1.5 rounded-lg text-sm font-bold bg-blue-50 text-blue-700 border border-blue-100">
                                                        {kw}
                                                    </span>
                                                ))}
                                            </div>
                                        </div>
                                        <div>
                                            <h4 className="text-sm font-bold text-slate-500 mb-3 uppercase tracking-wider">Secondary</h4>
                                            <div className="flex flex-wrap gap-2">
                                                {briefData.secondary_keywords?.map((kw, i) => (
                                                    <span key={i} className="inline-flex items-center px-3 py-1.5 rounded-lg text-sm font-medium bg-slate-50 text-slate-700 border border-slate-200 hover:bg-slate-100 transition-colors cursor-default">
                                                        {kw}
                                                    </span>
                                                ))}
                                            </div>
                                        </div>
                                    </div>
                                </section>

                                <section>
                                    <h2 className="text-2xl font-black text-slate-900 mb-6 pb-2 border-b border-slate-100">
                                        Content Outline
                                    </h2>
                                    <div className="space-y-4">
                                        {briefData.outline?.map((section, idx) => (
                                            <div key={idx} className={`rounded-2xl p-6 bg-slate-50 border border-slate-100`}>
                                                <div className="flex items-start gap-4 mb-4">
                                                    <span className="flex-shrink-0 flex items-center justify-center w-8 h-8 rounded-lg bg-indigo-100 text-indigo-700 font-black text-sm">
                                                        H{section.level}
                                                    </span>
                                                    <h3 className="text-xl font-bold text-slate-900 pt-0.5">
                                                        {section.heading}
                                                    </h3>
                                                </div>
                                                {section.talking_points && section.talking_points.length > 0 && (
                                                    <div className="ml-12 pl-4 border-l-2 border-slate-200">
                                                        <ul className="space-y-2">
                                                            {section.talking_points.map((point, pIdx) => (
                                                                <li key={pIdx} className="text-slate-600 font-medium text-[15px] flex items-start">
                                                                    <span className="mr-2 mt-1.5 w-1.5 h-1.5 rounded-full bg-slate-300 flex-shrink-0" />
                                                                    {point}
                                                                </li>
                                                            ))}
                                                        </ul>
                                                    </div>
                                                )}
                                            </div>
                                        ))}
                                    </div>
                                </section>

                                <div className="grid grid-cols-1 md:grid-cols-2 gap-8 pt-6 border-t border-slate-100">
                                    <section>
                                        <h3 className="text-lg font-bold text-slate-900 mb-4">Competitor Insights</h3>
                                        <ul className="space-y-3">
                                            {briefData.competitor_insights?.map((insight, i) => (
                                                <li key={i} className="flex gap-3 text-slate-600 bg-slate-50 p-3 rounded-lg text-sm border border-slate-100">
                                                    <span className="text-slate-400 select-none">•</span>
                                                    <span className="leading-relaxed">{insight}</span>
                                                </li>
                                            ))}
                                        </ul>
                                    </section>
                                    <section>
                                        <h3 className="text-lg font-bold text-slate-900 mb-4">Internal Linking</h3>
                                        <ul className="space-y-3">
                                            {briefData.internal_linking_suggestions?.map((link, i) => (
                                                <li key={i} className="flex gap-3 text-slate-600 bg-slate-50 p-3 rounded-lg text-sm border border-slate-100">
                                                    <span className="text-blue-400 select-none">🔗</span>
                                                    <span className="leading-relaxed">{link}</span>
                                                </li>
                                            ))}
                                        </ul>
                                    </section>
                                </div>
                            </div>
                            
                            {/* ── Generate Article Section ── */}
                            <div className="mt-16 pt-12 border-t-2 border-slate-100">
                                <div className="mb-6">
                                    <h2 className="text-2xl font-black text-slate-900 mb-1">Generate Full Article</h2>
                                    <p className="text-slate-500 font-medium">
                                        Configure the writing style below, then click Generate.
                                    </p>
                                </div>

                                {/* Writing Settings Panel */}
                                <div className="rounded-2xl border border-slate-200 bg-slate-50/60 overflow-hidden mb-6">
                                    <button
                                        type="button"
                                        onClick={() => setSettingsOpen(o => !o)}
                                        className="w-full flex items-center justify-between px-5 py-4 text-left hover:bg-slate-100/60 transition-colors"
                                    >
                                        <span className="flex items-center gap-2 text-[15px] font-bold text-slate-800">
                                            <AdjustmentsHorizontalIcon className="w-5 h-5 text-blue-500" />
                                            Writing Settings
                                        </span>
                                        {settingsOpen
                                            ? <ChevronUpIcon className="w-4 h-4 text-slate-400" />
                                            : <ChevronDownIcon className="w-4 h-4 text-slate-400" />
                                        }
                                    </button>

                                    {settingsOpen && (
                                        <div className="px-5 pb-5 space-y-5 border-t border-slate-200">
                                            {/* Language */}
                                            <div className="pt-4">
                                                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Language</label>
                                                <div className="flex gap-2 flex-wrap">
                                                    {LANGUAGE_OPTIONS.map(opt => (
                                                        <OptionChip
                                                            key={opt.value}
                                                            selected={language === opt.value}
                                                            onClick={() => setLanguage(opt.value)}
                                                            label={opt.label}
                                                        />
                                                    ))}
                                                </div>
                                            </div>

                                            {/* Tone */}
                                            <div>
                                                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Tone</label>
                                                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                                                    {TONE_OPTIONS.map(opt => (
                                                        <OptionChip
                                                            key={opt.value}
                                                            selected={tone === opt.value}
                                                            onClick={() => setTone(opt.value)}
                                                            label={opt.label}
                                                            desc={opt.desc}
                                                        />
                                                    ))}
                                                </div>
                                            </div>

                                            {/* Length */}
                                            <div>
                                                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Length</label>
                                                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                                                    {LENGTH_OPTIONS.map(opt => (
                                                        <OptionChip
                                                            key={opt.value}
                                                            selected={length === opt.value}
                                                            onClick={() => setLength(opt.value)}
                                                            label={opt.label}
                                                            desc={opt.desc}
                                                        />
                                                    ))}
                                                </div>
                                            </div>

                                            {/* Audience override */}
                                            <div>
                                                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">
                                                    Target Audience <span className="font-normal normal-case text-slate-400">(optional override)</span>
                                                </label>
                                                <input
                                                    type="text"
                                                    value={audience}
                                                    onChange={e => setAudience(e.target.value)}
                                                    placeholder="e.g. Small business owners with no SEO experience"
                                                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white outline-none focus:ring-2 focus:ring-blue-400 focus:border-blue-400 transition-all"
                                                />
                                            </div>

                                            {/* Custom instructions */}
                                            <div>
                                                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">
                                                    Custom Instructions <span className="font-normal normal-case text-slate-400">(optional)</span>
                                                </label>
                                                <textarea
                                                    value={customInstructions}
                                                    onChange={e => setCustomInstructions(e.target.value)}
                                                    rows={3}
                                                    placeholder="e.g. Include a comparison table. Avoid mentioning competitor brand names. Use simple language, no jargon."
                                                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white outline-none focus:ring-2 focus:ring-blue-400 focus:border-blue-400 transition-all resize-none"
                                                />
                                            </div>
                                        </div>
                                    )}
                                </div>

                                {/* Generate Button */}
                                <button
                                    onClick={handleGenerateArticle}
                                    disabled={loading}
                                    className="flex items-center gap-2 bg-blue-600 outline-none hover:bg-blue-700 active:bg-blue-800 text-white px-6 py-3 rounded-xl font-bold transition-all disabled:opacity-50"
                                >
                                    <SparklesIcon className="w-5 h-5" />
                                    {loading ? 'Generating…' : 'Write Full Article'}
                                </button>
                            </div>
                </div>
            </div>
        </div>
    );
}

import { Fragment, useState, useEffect } from 'react';
import { Dialog, Transition } from '@headlessui/react';
import {
    XMarkIcon,
    SparklesIcon,
    DocumentTextIcon,
    CheckCircleIcon,
    DocumentDuplicateIcon
} from '@heroicons/react/24/outline';
import api from '../../api/axios';
import { toast } from 'react-hot-toast';

export default function ContentBriefModal({ isOpen, onClose, article, analysisId }) {
    const [loading, setLoading] = useState(false);
    const [briefData, setBriefData] = useState(null);
    const [copied, setCopied] = useState(false);

    useEffect(() => {
        if (!isOpen) {
            // Reset state when modal is closed
            setTimeout(() => {
                setBriefData(null);
                setLoading(false);
            }, 300);
            return;
        }

        if (article && analysisId && !briefData) {
            generateBrief();
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isOpen, article, analysisId]);

    const generateBrief = async () => {
        setLoading(true);
        try {
            const response = await api.post(`/api/brief/${analysisId}`, {
                topic: article.title,
                category: article.category_l1 || 'General',
                article_type: article.article_type || 'informative'
            });

            if (response.data?.brief) {
                setBriefData(response.data.brief);
            } else {
                toast.error('Failed to generate brief data');
                onClose();
            }
        } catch (error) {
            console.error('Error generating brief:', error);
            toast.error('Failed to generate content brief. Try again later.');
            onClose();
        } finally {
            setLoading(false);
        }
    };

    const copyToClipboard = () => {
        if (!briefData) return;

        const contentToCopy = `
# Content Brief: ${article?.title}

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
            setTimeout(() => setCopied(false), 2000);
            toast.success('Copied to clipboard');
        });
    };

    return (
        <Transition.Root show={isOpen} as={Fragment}>
            <Dialog as="div" className="relative z-50" onClose={onClose}>
                <Transition.Child
                    as={Fragment}
                    enter="ease-out duration-300"
                    enterFrom="opacity-0"
                    enterTo="opacity-100"
                    leave="ease-in duration-200"
                    leaveFrom="opacity-100"
                    leaveTo="opacity-0"
                >
                    <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm transition-opacity" />
                </Transition.Child>

                <div className="fixed inset-0 z-10 w-screen overflow-y-auto">
                    <div className="flex min-h-full items-end justify-center p-4 text-center sm:items-center sm:p-0">
                        <Transition.Child
                            as={Fragment}
                            enter="ease-out duration-300"
                            enterFrom="opacity-0 translate-y-4 sm:translate-y-0 sm:scale-95"
                            enterTo="opacity-100 translate-y-0 sm:scale-100"
                            leave="ease-in duration-200"
                            leaveFrom="opacity-100 translate-y-0 sm:scale-100"
                            leaveTo="opacity-0 translate-y-4 sm:translate-y-0 sm:scale-95"
                        >
                            <Dialog.Panel className="relative transform overflow-hidden rounded-xl bg-white text-left shadow-2xl transition-all sm:my-8 sm:w-full sm:max-w-4xl max-h-[90vh] flex flex-col">
                                
                                {/* Header */}
                                <div className="bg-slate-50 border-b border-slate-200 px-6 py-4 flex items-center justify-between shrink-0">
                                    <div className="flex items-center space-x-3">
                                        <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center">
                                            <SparklesIcon className="h-5 w-5 text-blue-600" />
                                        </div>
                                        <div>
                                            <Dialog.Title as="h3" className="text-lg font-bold leading-6 text-slate-900">
                                                AI Content Brief
                                            </Dialog.Title>
                                            <p className="text-sm text-slate-500 mt-0.5 truncate max-w-md">
                                                {article?.title}
                                            </p>
                                        </div>
                                    </div>
                                    
                                    <div className="flex items-center space-x-2">
                                        {briefData && (
                                            <button
                                                type="button"
                                                onClick={copyToClipboard}
                                                className="inline-flex items-center gap-x-1.5 rounded-md bg-white px-3 py-2 text-sm font-semibold text-slate-700 shadow-sm ring-1 ring-inset ring-slate-300 hover:bg-slate-50 transition-colors"
                                            >
                                                {copied ? (
                                                    <CheckCircleIcon className="-ml-0.5 h-4 w-4 text-green-500" aria-hidden="true" />
                                                ) : (
                                                    <DocumentDuplicateIcon className="-ml-0.5 h-4 w-4" aria-hidden="true" />
                                                )}
                                                {copied ? 'Copied' : 'Copy Text'}
                                            </button>
                                        )}
                                        <button
                                            type="button"
                                            className="rounded-md bg-slate-50 text-slate-400 hover:text-slate-500 hover:bg-slate-100 p-2 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
                                            onClick={onClose}
                                        >
                                            <span className="sr-only">Close</span>
                                            <XMarkIcon className="h-5 w-5" aria-hidden="true" />
                                        </button>
                                    </div>
                                </div>

                                {/* Body */}
                                <div className="px-6 py-6 overflow-y-auto flex-1 bg-white">
                                    {loading ? (
                                        <div className="flex flex-col items-center justify-center py-20">
                                            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mb-4"></div>
                                            <h3 className="text-lg font-medium text-slate-900 mb-2">Generating Your Brief</h3>
                                            <p className="text-sm text-slate-500 text-center max-w-sm">
                                                AI is analyzing the topic and generating a comprehensive outline. This might take 10-20 seconds...
                                            </p>
                                        </div>
                                    ) : briefData ? (
                                        <div className="space-y-8 animate-in fade-in duration-500">
                                            {/* Overview Cards */}
                                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                                <div className="bg-slate-50 border border-slate-200 rounded-lg p-4">
                                                    <h4 className="text-sm font-semibold text-slate-900 mb-1">Search Intent</h4>
                                                    <p className="text-sm text-slate-600">{briefData.search_intent || 'N/A'}</p>
                                                </div>
                                                <div className="bg-slate-50 border border-slate-200 rounded-lg p-4">
                                                    <h4 className="text-sm font-semibold text-slate-900 mb-1">Target Audience</h4>
                                                    <p className="text-sm text-slate-600">{briefData.target_audience || 'N/A'}</p>
                                                </div>
                                            </div>

                                            {/* Keywords & Meta */}
                                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                                <div>
                                                    <h4 className="text-base font-semibold text-slate-900 mb-3 flex items-center">
                                                        <DocumentTextIcon className="w-5 h-5 mr-2 text-slate-400" />
                                                        Keywords
                                                    </h4>
                                                    <div className="space-y-3">
                                                        <div>
                                                            <span className="text-xs font-medium text-slate-500 uppercase tracking-wider">Primary</span>
                                                            <div className="mt-1 flex flex-wrap gap-2">
                                                                {briefData.primary_keywords?.map((kw, i) => (
                                                                    <span key={i} className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                                                                        {kw}
                                                                    </span>
                                                                ))}
                                                            </div>
                                                        </div>
                                                        <div>
                                                            <span className="text-xs font-medium text-slate-500 uppercase tracking-wider">Secondary</span>
                                                            <div className="mt-1 flex flex-wrap gap-2">
                                                                {briefData.secondary_keywords?.map((kw, i) => (
                                                                    <span key={i} className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-700">
                                                                        {kw}
                                                                    </span>
                                                                ))}
                                                            </div>
                                                        </div>
                                                    </div>
                                                </div>
                                                
                                                <div>
                                                    <h4 className="text-base font-semibold text-slate-900 mb-3 flex items-center">
                                                        <SparklesIcon className="w-5 h-5 mr-2 text-slate-400" />
                                                        Title & Meta
                                                    </h4>
                                                    <div className="space-y-3">
                                                        <div className="bg-white border border-slate-200 rounded p-3">
                                                            <span className="text-xs font-medium text-slate-500 uppercase tracking-wider mb-2 block">Top Title Idea</span>
                                                            <p className="text-sm text-slate-900 font-bold">{briefData.title_ideas?.[0]}</p>
                                                        </div>
                                                        <div className="bg-white border border-slate-200 rounded p-3">
                                                            <span className="text-xs font-medium text-slate-500 uppercase tracking-wider mb-2 block">Meta Description</span>
                                                            <p className="text-sm text-slate-600">{briefData.meta_description}</p>
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>

                                            {/* Outline */}
                                            <div>
                                                <h4 className="text-base font-semibold text-slate-900 mb-4 border-b border-slate-200 pb-2">
                                                    Content Outline
                                                </h4>
                                                <div className="space-y-4">
                                                    {briefData.outline?.map((section, idx) => (
                                                        <div key={idx} className={`pl-${(section.level - 1) * 4} border-l-2 ${section.level === 1 ? 'border-blue-500' : 'border-slate-200'}`}>
                                                            <div className="pl-4">
                                                                <h5 className={`font-semibold text-slate-900 ${section.level === 1 ? 'text-lg' : 'text-md'}`}>
                                                                    H{section.level}: {section.heading}
                                                                </h5>
                                                                {section.talking_points && section.talking_points.length > 0 && (
                                                                    <ul className="mt-2 space-y-1 list-disc pl-5">
                                                                        {section.talking_points.map((point, i) => (
                                                                            <li key={i} className="text-sm text-slate-600">{point}</li>
                                                                        ))}
                                                                    </ul>
                                                                )}
                                                            </div>
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>

                                            {/* Bottom sections */}
                                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 bg-slate-50 rounded-xl p-6 border border-slate-100">
                                                <div>
                                                    <h4 className="text-sm font-semibold text-slate-900 mb-3">Competitor Insights</h4>
                                                    <ul className="space-y-2">
                                                        {briefData.competitor_insights?.map((insight, idx) => (
                                                            <li key={idx} className="flex text-sm text-slate-600">
                                                                <span className="text-purple-500 mr-2">•</span>
                                                                {insight}
                                                            </li>
                                                        ))}
                                                    </ul>
                                                </div>
                                                <div>
                                                    <h4 className="text-sm font-semibold text-slate-900 mb-3">Internal Linking Strategy</h4>
                                                    <ul className="space-y-2">
                                                        {briefData.internal_linking_suggestions?.map((link, idx) => (
                                                            <li key={idx} className="flex text-sm text-slate-600">
                                                                <span className="text-blue-500 mr-2">→</span>
                                                                {link}
                                                            </li>
                                                        ))}
                                                    </ul>
                                                </div>
                                            </div>

                                        </div>
                                    ) : null}
                                </div>
                            </Dialog.Panel>
                        </Transition.Child>
                    </div>
                </div>
            </Dialog>
        </Transition.Root>
    );
}

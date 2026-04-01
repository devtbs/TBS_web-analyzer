import { useState } from 'react';
import {
    BriefcaseIcon,
    ServerIcon,
    UserGroupIcon,
    GlobeAltIcon,
    ChartBarIcon,
    SparklesIcon,
    ChevronDownIcon,
    ChevronUpIcon
} from '@heroicons/react/24/outline';
import Favicon from '../ui/Favicon';

const Comparison = ({ comparisonData }) => {
    const [expandedSections, setExpandedSections] = useState({
        business: true,
        overlap: true,
        unique: true,
        audience: true,
        technology: true,
        geographic: true,
        similarity: true
    });

    // Debug logging
    console.log('Comparison component received data:', comparisonData);

    if (!comparisonData) {
        return (
            <div className="bg-white rounded-lg shadow p-8 text-center text-slate-500">
                <p>No comparison data available</p>
                <p className="text-sm mt-2">Comparison requires 2 or more URLs</p>
            </div>
        );
    }

    // Check if data is still processing
    if (comparisonData.status === 'processing') {
        return (
            <div className="bg-white rounded-lg shadow p-8 text-center">
                <div className="animate-spin rounded-full h-12 w-12 border-b-4 border-blue-600 mx-auto mb-4"></div>
                <p className="text-slate-600">Generating comparison with AI...</p>
            </div>
        );
    }

    // Check if comparison is not applicable
    if (comparisonData.status === 'not_applicable') {
        return (
            <div className="bg-white rounded-lg shadow p-8 text-center text-slate-500">
                <p className="text-lg mb-2">⚠️ Comparison Not Available</p>
                <p className="text-sm">Comparison requires analyzing 2 or more URLs</p>
            </div>
        );
    }

    // Validate we have the expected data structure
    if (!comparisonData.business_models || typeof comparisonData.business_models !== 'object') {
        console.error('Invalid comparison data structure:', comparisonData);
        return (
            <div className="bg-white rounded-lg shadow p-8 text-center text-red-500">
                <p>Error loading comparison data</p>
                <p className="text-sm mt-2">Please try analyzing again</p>
            </div>
        );
    }

    const toggleSection = (section) => {
        setExpandedSections(prev => ({
            ...prev,
            [section]: !prev[section]
        }));
    };

    const SectionHeader = ({ title, icon: Icon, section, count }) => (
        <div
            className="flex items-center justify-between p-4 bg-gradient-to-r from-slate-800 to-slate-900 cursor-pointer hover:from-slate-700 hover:to-slate-800 transition-all border-b border-white/5"
            onClick={() => section && toggleSection(section)}
        >
            <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-white/10 flex items-center justify-center shadow-inner">
                    {Icon && <Icon className="w-[18px] h-[18px] text-emerald-400" />}
                </div>
                <h2 className="text-base font-bold text-white tracking-tight">{title}</h2>
                {count !== undefined && (
                    <span className="px-2 py-0.5 bg-emerald-500/20 border border-emerald-500/30 rounded text-emerald-300 text-xs font-black uppercase tracking-wider">
                        {count}
                    </span>
                )}
            </div>
            {section && (
                <div className="p-1 rounded-md hover:bg-white/10 transition-colors">
                    {expandedSections[section] ?
                        <ChevronUpIcon className="w-5 h-5 text-slate-400" /> :
                        <ChevronDownIcon className="w-5 h-5 text-slate-400" />
                    }
                </div>
            )}
        </div>
    );

    // Extract domains from URLs
    const getDomain = (url) => {
        try {
            return new URL(url).hostname.replace('www.', '');
        } catch {
            return url;
        }
    };

    const urls = Object.keys(comparisonData.business_models || {});

    return (
        <div className="space-y-6">
            {/* Business Models */}
            <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
                <SectionHeader
                    title="Business Models"
                    icon={BriefcaseIcon}
                    section="business"
                    count={Object.keys(comparisonData.business_models).length}
                />
                {expandedSections.business && (
                    <div className="p-5">
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                            {Object.entries(comparisonData.business_models).map(([url, model]) => (
                                <div key={url} className="flex flex-col gap-2 p-4 bg-slate-50 rounded-xl border border-slate-100 hover:border-emerald-200 hover:bg-emerald-50/30 transition-all group">
                                    <div className="flex items-center gap-2">
                                        <Favicon url={url} size={14} className="rounded-sm flex-shrink-0" />
                                        <span className="text-[11px] font-black uppercase text-slate-400 group-hover:text-emerald-600 transition-colors tracking-wider">{getDomain(url)}</span>
                                    </div>
                                    <span className="text-sm text-slate-900 font-bold">
                                        {model}
                                    </span>
                                </div>
                            ))}
                        </div>
                    </div>
                )}
            </div>

            {/* Service Overlap */}
            {comparisonData.service_overlap && comparisonData.service_overlap.length > 0 && (
                <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
                    <SectionHeader
                        title="Common Services & Features"
                        icon={ChartBarIcon}
                        section="overlap"
                        count={comparisonData.service_overlap.length}
                    />
                    {expandedSections.overlap && (
                        <div className="p-5">
                            <p className="text-xs font-bold text-slate-400 mb-4 uppercase tracking-widest">Shared across all analyzed properties:</p>
                            <div className="flex flex-wrap gap-2">
                                {comparisonData.service_overlap.map((service, index) => (
                                    <span
                                        key={index}
                                        className="px-3.5 py-2 bg-emerald-50 text-emerald-700 border border-emerald-100 rounded-xl text-sm font-bold hover:bg-emerald-100 hover:border-emerald-200 transition-all shadow-sm"
                                    >
                                        {service}
                                    </span>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            )}

            {/* Unique Services */}
            {comparisonData.unique_services && Object.keys(comparisonData.unique_services).length > 0 && (
                <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
                    <SectionHeader
                        title="Unique Differentiators"
                        icon={SparklesIcon}
                        section="unique"
                    />
                    {expandedSections.unique && (
                        <div className="p-5">
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
                                {Object.entries(comparisonData.unique_services).map(([url, services]) => (
                                    services && services.length > 0 && (
                                        <div key={url} className="flex flex-col gap-4 p-5 rounded-2xl bg-slate-50 border border-slate-100 hover:border-emerald-200 transition-all hover:bg-white hover:shadow-md group">
                                            <div className="flex items-center justify-between">
                                                <h4 className="font-black text-slate-900 group-hover:text-emerald-700 transition-colors text-sm">{getDomain(url)}</h4>
                                                <span className="w-6 h-6 rounded-lg bg-emerald-500/10 flex items-center justify-center">
                                                    <SparklesIcon className="w-3.5 h-3.5 text-emerald-600" />
                                                </span>
                                            </div>
                                            <div className="flex flex-wrap gap-2">
                                                {services.map((service, idx) => (
                                                    <span
                                                        key={idx}
                                                        className="px-3 py-1.5 bg-white text-slate-700 rounded-lg text-xs font-bold border border-slate-200 shadow-sm"
                                                    >
                                                        {service}
                                                    </span>
                                                ))}
                                            </div>
                                        </div>
                                    )
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            )}

            {/* Target Audiences */}
            {comparisonData.audience_comparison && Object.keys(comparisonData.audience_comparison).length > 0 && (
                <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
                    <SectionHeader
                        title="Target Audience Comparison"
                        icon={UserGroupIcon}
                        section="audience"
                    />
                    {expandedSections.audience && (
                        <div className="p-5">
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
                                {Object.entries(comparisonData.audience_comparison).map(([url, audiences]) => (
                                    <div key={url} className="p-5 rounded-2xl bg-white border border-slate-200 shadow-sm hover:border-emerald-200 transition-all group">
                                        <h4 className="font-black text-slate-400 group-hover:text-emerald-700 uppercase tracking-widest text-[10px] mb-4 transition-colors">{getDomain(url)}</h4>
                                        <div className="space-y-3">
                                            {audiences && audiences.map((audience, idx) => (
                                                <div key={idx} className="flex items-center gap-3">
                                                    <div className="w-1.5 h-1.5 bg-emerald-500 rounded-full flex-shrink-0 shadow-[0_0_8px_rgba(16,185,129,0.4)]"></div>
                                                    <span className="text-sm text-slate-700 font-bold">{audience}</span>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            )}

            {/* Technology Stack */}
            {comparisonData.technology_stack && Object.keys(comparisonData.technology_stack).length > 0 && (
                <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
                    <SectionHeader
                        title="Technology Stack"
                        icon={ServerIcon}
                        section="technology"
                    />
                    {expandedSections.technology && (
                        <div className="p-5">
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                                {Object.entries(comparisonData.technology_stack).map(([url, technologies]) => (
                                    <div key={url} className="p-4 rounded-xl bg-slate-50 border border-slate-100 hover:bg-white hover:shadow-md transition-all group">
                                        <h4 className="font-black text-slate-400 group-hover:text-emerald-700 transition-colors uppercase tracking-widest text-[9px] mb-3">{getDomain(url)}</h4>
                                        <div className="flex flex-wrap gap-1.5">
                                            {technologies && technologies.map((tech, idx) => (
                                                <span
                                                    key={idx}
                                                    className="px-2.5 py-1 bg-white text-slate-600 rounded-lg text-[10px] font-black border border-slate-200 shadow-sm"
                                                >
                                                    {tech}
                                                </span>
                                            ))}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            )}

            {/* Geographic Coverage */}
            {comparisonData.geographic_coverage && Object.keys(comparisonData.geographic_coverage).length > 0 && (
                <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
                    <SectionHeader
                        title="Geographic Coverage"
                        icon={GlobeAltIcon}
                        section="geographic"
                    />
                    {expandedSections.geographic && (
                        <div className="p-5">
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                                {Object.entries(comparisonData.geographic_coverage).map(([url, locations]) => (
                                    <div key={url} className="p-4 rounded-xl bg-slate-50 border border-slate-100 group">
                                        <h4 className="font-black text-slate-400 group-hover:text-emerald-700 transition-colors uppercase tracking-widest text-[9px] mb-3">{getDomain(url)}</h4>
                                        <div className="flex flex-wrap gap-1.5">
                                            {locations && locations.map((location, idx) => (
                                                <span
                                                    key={idx}
                                                    className="px-2.5 py-1 bg-white text-slate-600 rounded-lg text-[10px] font-black border border-slate-200 shadow-sm"
                                                >
                                                    {location}
                                                </span>
                                            ))}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            )}

            {/* Similarity Matrix */}
            {comparisonData.similarity_matrix && Object.keys(comparisonData.similarity_matrix).length > 0 && (
                <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
                    <SectionHeader
                        title="Similarity Analysis"
                        icon={ChartBarIcon}
                        section="similarity"
                    />
                    {expandedSections.similarity && (
                        <div className="p-4">
                            <p className="text-sm text-slate-600 mb-4">
                                Similarity scores between websites (0% = completely different, 100% = identical)
                            </p>
                            <div className="overflow-x-auto">
                                <table className="w-full text-sm border-collapse">
                                    <thead>
                                        <tr className="bg-slate-50">
                                            <th className="text-left p-3 border border-slate-200 font-semibold"></th>
                                            {urls.map((url, index) => (
                                                <th key={index} className="p-3 border border-slate-200 text-center font-semibold text-xs">
                                                    {getDomain(url)}
                                                </th>
                                            ))}
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {urls.map((url1, i) => (
                                            <tr key={i} className="hover:bg-slate-50 transition-colors">
                                                <td className="p-3 border border-slate-200 font-semibold text-xs bg-slate-50">
                                                    {getDomain(url1)}
                                                </td>
                                                {urls.map((url2, j) => {
                                                    const score = comparisonData.similarity_matrix[url1]?.[url2] || 0;
                                                    const percentage = Math.round(score * 100);
                                                    const bgColor = score === 1
                                                        ? 'bg-slate-100 text-slate-400'
                                                        : score >= 0.7
                                                            ? 'bg-emerald-50 text-emerald-700'
                                                            : score >= 0.4
                                                                ? 'bg-amber-50 text-amber-700'
                                                                : 'bg-rose-50 text-rose-700';

                                                    return (
                                                        <td
                                                            key={j}
                                                            className={`p-4 border border-slate-100 text-center font-bold text-sm ${bgColor}`}
                                                        >
                                                            {percentage}%
                                                        </td>
                                                    );
                                                })}
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                            <div className="mt-6 flex flex-wrap items-center gap-6 text-[10px] font-black uppercase tracking-widest text-slate-400">
                                <div className="flex items-center gap-2">
                                    <div className="w-3 h-3 bg-emerald-100 border border-emerald-200 rounded-sm"></div>
                                    <span>High (70%+)</span>
                                </div>
                                <div className="flex items-center gap-2">
                                    <div className="w-3 h-3 bg-amber-100 border border-amber-200 rounded-sm"></div>
                                    <span>Medium (40-69%)</span>
                                </div>
                                <div className="flex items-center gap-2">
                                    <div className="w-3 h-3 bg-rose-100 border border-rose-200 rounded-sm"></div>
                                    <span>Low (&lt;40%)</span>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};

export default Comparison;

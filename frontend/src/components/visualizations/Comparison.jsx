import { useState } from 'react';
import {
    SparklesIcon,
    BoltIcon,
    ExclamationTriangleIcon,
    LightBulbIcon,
    RocketLaunchIcon,
    ArrowTrendingUpIcon,
    ChevronDownIcon,
    ChevronUpIcon,
    DocumentTextIcon,
} from '@heroicons/react/24/outline';

const PRIORITY_LABELS = { 1: { label: 'High priority', color: 'bg-red-100 text-red-700 border-red-200' }, 2: { label: 'Medium', color: 'bg-amber-100 text-amber-700 border-amber-200' }, 3: { label: 'Low', color: 'bg-slate-100 text-slate-600 border-slate-200' } };

const Section = ({ title, icon: Icon, iconBg, count, children, defaultOpen = true }) => {
    const [open, setOpen] = useState(defaultOpen);
    return (
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 bg-gradient-to-r from-slate-800 to-slate-900 cursor-pointer hover:from-slate-700 hover:to-slate-800 transition-all" onClick={() => setOpen(o => !o)}>
                <div className="flex items-center gap-3">
                    <div className={`w-8 h-8 rounded-lg ${iconBg || 'bg-white/10'} flex items-center justify-center`}>
                        {Icon && <Icon className="w-[18px] h-[18px] text-emerald-400" />}
                    </div>
                    <h2 className="text-base font-bold text-white tracking-tight">{title}</h2>
                    {count !== undefined && (
                        <span className="px-2 py-0.5 bg-emerald-500/20 border border-emerald-500/30 rounded text-emerald-300 text-xs font-black uppercase tracking-wider">{count}</span>
                    )}
                </div>
                <div className="p-1 rounded-md hover:bg-white/10 transition-colors">
                    {open ? <ChevronUpIcon className="w-5 h-5 text-slate-400" /> : <ChevronDownIcon className="w-5 h-5 text-slate-400" />}
                </div>
            </div>
            {open && <div className="p-5">{children}</div>}
        </div>
    );
};

const Bullet = ({ text, color = 'bg-emerald-500' }) => (
    <div className="flex items-start gap-3 p-3 rounded-xl bg-slate-50 border border-slate-100 hover:border-emerald-200 hover:bg-emerald-50/30 transition-all">
        <div className={`w-2 h-2 rounded-full ${color} flex-shrink-0 mt-1.5 shadow-sm`} />
        <span className="text-sm text-slate-700 font-medium leading-snug">{text}</span>
    </div>
);

const Comparison = ({ comparisonData }) => {
    if (!comparisonData) {
        return (
            <div className="bg-white rounded-lg shadow p-8 text-center text-slate-500">
                <p>No comparison data available</p>
                <p className="text-sm mt-2">Comparison requires 2 or more URLs</p>
            </div>
        );
    }

    if (comparisonData.status === 'processing') {
        return (
            <div className="bg-white rounded-lg shadow p-8 text-center">
                <div className="animate-spin rounded-full h-12 w-12 border-b-4 border-emerald-500 mx-auto mb-4" />
                <p className="text-slate-600">Generating competitive gap analysis with AI…</p>
            </div>
        );
    }

    if (comparisonData.status === 'not_applicable') {
        return (
            <div className="bg-white rounded-lg shadow p-8 text-center text-slate-500">
                <p className="text-lg mb-2">⚠️ Comparison Not Available</p>
                <p className="text-sm">Comparison requires analyzing 2 or more URLs</p>
            </div>
        );
    }

    const {
        gap_summary,
        topic_gaps = [],
        entity_gaps = [],
        quick_wins = [],
        content_opportunities = [],
        recommended_articles = [],
    } = comparisonData;

    const hasNewFormat = gap_summary || topic_gaps.length || quick_wins.length || recommended_articles.length;

    // Fallback: if only old-format data exists, show a simplified view
    if (!hasNewFormat) {
        return (
            <div className="bg-white rounded-2xl border border-slate-200 p-8 text-center text-slate-500">
                <SparklesIcon className="w-10 h-10 mx-auto mb-3 text-slate-300" />
                <p className="font-semibold">Run a new analysis to see the competitor gap report.</p>
                <p className="text-sm mt-1">Old results used the previous comparison format.</p>
            </div>
        );
    }

    const p1 = recommended_articles.filter(a => a.priority === 1);
    const p2 = recommended_articles.filter(a => a.priority === 2);
    const p3 = recommended_articles.filter(a => a.priority === 3);

    return (
        <div className="space-y-6">

            {/* Executive Summary */}
            {gap_summary && (
                <div className="bg-gradient-to-br from-slate-900 to-slate-800 rounded-2xl p-6 border border-slate-700/50 shadow-lg">
                    <div className="flex items-center gap-3 mb-4">
                        <div className="w-9 h-9 rounded-xl bg-emerald-500/20 flex items-center justify-center">
                            <SparklesIcon className="w-5 h-5 text-emerald-400" />
                        </div>
                        <div>
                            <p className="text-[10px] font-black uppercase tracking-widest text-emerald-400">AI Gap Analysis</p>
                            <h2 className="text-lg font-bold text-white">Executive Summary</h2>
                        </div>
                    </div>
                    <p className="text-slate-300 leading-relaxed text-sm">{gap_summary}</p>
                </div>
            )}

            {/* Quick Wins */}
            {quick_wins.length > 0 && (
                <Section title="Quick Wins" icon={BoltIcon} count={quick_wins.length} iconBg="bg-amber-500/20">
                    <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-4">Do these first to close the gap fastest:</p>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        {quick_wins.map((win, i) => (
                            <div key={i} className="flex items-start gap-3 p-3.5 rounded-xl bg-amber-50 border border-amber-100 hover:border-amber-300 transition-all">
                                <div className="w-6 h-6 rounded-full bg-amber-500/20 border border-amber-300/50 flex items-center justify-center flex-shrink-0 mt-0.5">
                                    <span className="text-[10px] font-black text-amber-700">{i + 1}</span>
                                </div>
                                <span className="text-sm text-slate-700 font-medium leading-snug">{win}</span>
                            </div>
                        ))}
                    </div>
                </Section>
            )}

            {/* Topic Gaps */}
            {topic_gaps.length > 0 && (
                <Section title="Topic Gaps" icon={ExclamationTriangleIcon} count={topic_gaps.length}>
                    <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-4">Topics competitors cover that your primary site does NOT:</p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
                        {topic_gaps.map((gap, i) => (
                            <div key={i} className="flex items-center gap-2.5 px-3.5 py-2.5 bg-rose-50 border border-rose-100 rounded-xl hover:border-rose-300 transition-all">
                                <div className="w-1.5 h-1.5 rounded-full bg-rose-400 flex-shrink-0" />
                                <span className="text-sm text-slate-700 font-semibold">{gap}</span>
                            </div>
                        ))}
                    </div>
                </Section>
            )}

            {/* Entity Gaps */}
            {entity_gaps.length > 0 && (
                <Section title="Semantic Entity Gaps" icon={LightBulbIcon} count={entity_gaps.length} defaultOpen={false}>
                    <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-4">Concepts & entities strong in competitor content but weak or absent on primary site:</p>
                    <div className="flex flex-wrap gap-2">
                        {entity_gaps.map((entity, i) => (
                            <span key={i} className="px-3 py-1.5 bg-violet-50 border border-violet-200 text-violet-700 rounded-lg text-sm font-bold hover:bg-violet-100 transition-all">
                                {entity}
                            </span>
                        ))}
                    </div>
                </Section>
            )}

            {/* Recommended Articles */}
            {recommended_articles.length > 0 && (
                <Section title="Recommended Articles to Create" icon={DocumentTextIcon} count={recommended_articles.length} iconBg="bg-emerald-500/20">
                    <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-5">Create these articles to close competitor gaps and build topical authority:</p>

                    {[{ label: '🔴 High Priority', articles: p1 }, { label: '🟡 Medium Priority', articles: p2 }, { label: '⚪ Nice to Have', articles: p3 }]
                        .filter(g => g.articles.length > 0)
                        .map(group => (
                            <div key={group.label} className="mb-6 last:mb-0">
                                <p className="text-xs font-black text-slate-500 uppercase tracking-widest mb-3">{group.label}</p>
                                <div className="space-y-3">
                                    {group.articles.map((article, i) => (
                                        <div key={i} className="p-4 rounded-xl bg-slate-50 border border-slate-200 hover:border-emerald-300 hover:bg-white hover:shadow-sm transition-all">
                                            <div className="flex items-start justify-between gap-3 mb-1.5">
                                                <p className="text-sm font-bold text-slate-900 leading-snug">{article.title}</p>
                                                <span className={`flex-shrink-0 px-2 py-0.5 rounded-md text-[10px] font-black border ${PRIORITY_LABELS[article.priority]?.color || 'bg-slate-100 text-slate-500 border-slate-200'}`}>
                                                    P{article.priority}
                                                </span>
                                            </div>
                                            <p className="text-xs text-slate-500 leading-relaxed">{article.reason}</p>
                                            {article.competitor_source && (
                                                <p className="text-[11px] text-slate-400 mt-1.5 font-medium">
                                                    📎 Competitor covers this: <span className="text-emerald-600">{article.competitor_source}</span>
                                                </p>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            </div>
                        ))
                    }
                </Section>
            )}

            {/* Content Opportunities */}
            {content_opportunities.length > 0 && (
                <Section title="Strategic Content Opportunities" icon={ArrowTrendingUpIcon} count={content_opportunities.length} defaultOpen={false}>
                    <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-4">Longer-term investments to build lasting topical authority:</p>
                    <div className="space-y-2.5">
                        {content_opportunities.map((opp, i) => (
                            <Bullet key={i} text={opp} color="bg-teal-500" />
                        ))}
                    </div>
                </Section>
            )}
        </div>
    );
};

export default Comparison;

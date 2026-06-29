import { useState, useEffect, useCallback } from 'react';
import toast from 'react-hot-toast';
import {
    MagnifyingGlassIcon, WrenchScrewdriverIcon, ArrowDownTrayIcon,
} from '@heroicons/react/24/outline';
import api from '../api/axios';
import EmptyState from '../components/ui/EmptyState';
import SearchableSelect from '../components/ui/SearchableSelect';
import { downloadCSV } from '../utils/exportTable';

const SEV_STYLE = {
    critical: 'bg-red-50 border-red-200 text-red-700',
    warning: 'bg-amber-50 border-amber-200 text-amber-700',
    info: 'bg-sky-50 border-sky-200 text-sky-700',
};

const scoreColor = (s) =>
    s >= 90 ? 'text-emerald-600' : s >= 70 ? 'text-amber-600' : 'text-red-600';

export default function TechnicalAuditPage() {
    const [properties, setProperties] = useState([]);
    const [selected, setSelected] = useState('');
    const [running, setRunning] = useState(false);
    const [progress, setProgress] = useState(null);
    const [result, setResult] = useState(null);

    useEffect(() => {
        api.get('/auth/gsc/properties')
            .then((r) => {
                const props = r.data.properties || [];
                setProperties(props);
                if (props.length) setSelected(props[0].url);
            })
            .catch(() => { /* not connected */ });
    }, []);

    const fetchResult = useCallback(async (auditId) => {
        try {
            const { data } = await api.get(`/api/audit/${auditId}`);
            setResult(data);
        } catch {
            toast.error('Failed to load audit results');
        }
    }, []);

    const startAudit = async () => {
        if (!selected) return;
        setRunning(true);
        setResult(null);
        setProgress({ percentage: 0, message: 'Starting…' });
        try {
            const { data } = await api.post('/api/audit', { property_url: selected, max_pages: 100 });
            const auditId = data.audit_id;

            // Stream progress via the shared SSE endpoint.
            const token = localStorage.getItem('access_token');
            let baseURL = import.meta.env.VITE_API_BASE_URL || '';
            if (!baseURL.startsWith('http')) {
                baseURL = window.location.hostname.includes('localhost')
                    ? `http://${window.location.hostname}:8000`
                    : window.location.origin;
            }
            const es = new EventSource(
                `${baseURL.replace(/\/$/, '')}/api/progress/${auditId}?token=${encodeURIComponent(token)}`
            );
            es.onmessage = (e) => {
                try {
                    const d = JSON.parse(e.data);
                    setProgress(d);
                    if (d.status === 'complete') {
                        es.close();
                        fetchResult(auditId);
                        setRunning(false);
                    } else if (d.status === 'failed') {
                        es.close();
                        toast.error(d.message || 'Audit failed');
                        setRunning(false);
                    }
                } catch { /* ignore keepalive frames */ }
            };
            es.onerror = () => { es.close(); setRunning(false); };
        } catch {
            toast.error('Could not start audit');
            setRunning(false);
        }
    };

    const exportIssues = () => {
        if (!result?.issues?.length) return;
        const rows = result.issues.map((i) => ({
            severity: i.severity,
            issue: i.message,
            pages_affected: i.count,
            example_urls: (i.urls || []).slice(0, 5).join(' | '),
        }));
        downloadCSV(rows, 'technical_audit_issues.csv');
    };

    const summary = result?.summary;

    return (
        <div className="min-h-screen bg-[#f5f6f8]">
            <div className="px-8 pt-7 pb-5 bg-white border-b border-slate-200">
                <h1 className="text-[22px] font-black text-slate-800 tracking-tight flex items-center gap-2">
                    <WrenchScrewdriverIcon className="w-6 h-6 text-indigo-500" aria-hidden="true" />
                    Technical SEO Audit
                </h1>
                <p className="text-[13px] text-slate-500 mt-1">
                    Crawl a property to find broken pages, missing tags, thin content, and Core Web Vitals.
                </p>

                <div className="mt-4 flex items-center gap-3">
                    <SearchableSelect
                        options={properties.map((p) => ({ value: p.url, label: p.display || p.url }))}
                        value={selected}
                        onChange={setSelected}
                        disabled={running}
                        placeholder="Search properties…"
                    />
                    <button
                        onClick={startAudit}
                        disabled={running || !selected}
                        className="flex items-center gap-2 px-4 h-9 text-[13px] font-bold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg disabled:opacity-50 transition-colors"
                    >
                        <MagnifyingGlassIcon className="w-4 h-4" aria-hidden="true" />
                        {running ? 'Auditing…' : 'Run audit'}
                    </button>
                </div>
            </div>

            <div className="p-8">
                {/* Progress */}
                {running && progress && (
                    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 mb-6">
                        <div className="flex items-center justify-between mb-2">
                            <span className="text-[13px] font-semibold text-slate-700">{progress.message}</span>
                            <span className="text-[13px] font-bold text-indigo-600">{progress.percentage || 0}%</span>
                        </div>
                        <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                            <div
                                className="h-full bg-indigo-500 rounded-full transition-all duration-500"
                                style={{ width: `${progress.percentage || 0}%` }}
                            />
                        </div>
                    </div>
                )}

                {/* Empty initial state */}
                {!running && !result && (
                    <EmptyState
                        icon="🔍"
                        title="No audit yet"
                        description="Pick a property and run an audit to see technical issues and a health score."
                    />
                )}

                {/* Results */}
                {result && summary && (
                    <div className="space-y-6">
                        {/* Scorecard */}
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 text-center">
                                <div className={`text-4xl font-black ${scoreColor(summary.score)}`}>{summary.score}</div>
                                <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wide mt-1">Health score</div>
                            </div>
                            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 text-center">
                                <div className="text-4xl font-black text-slate-800">{summary.pages_crawled}</div>
                                <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wide mt-1">Pages crawled</div>
                            </div>
                            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 text-center">
                                <div className="text-4xl font-black text-red-600">{summary.counts?.critical || 0}</div>
                                <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wide mt-1">Critical issues</div>
                            </div>
                            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 text-center">
                                <div className="text-4xl font-black text-amber-600">{summary.counts?.warning || 0}</div>
                                <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wide mt-1">Warnings</div>
                            </div>
                        </div>

                        {/* Core Web Vitals */}
                        {summary.core_web_vitals?.length > 0 && (
                            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
                                <h3 className="text-sm font-bold text-slate-800 mb-3">Core Web Vitals (sample)</h3>
                                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                                    {summary.core_web_vitals.map((c) => (
                                        <div key={c.url} className="border border-slate-100 rounded-xl p-3">
                                            <div className="text-[11px] text-slate-400 truncate mb-1" title={c.url}>{c.url}</div>
                                            <div className="flex items-center gap-3 text-[12px]">
                                                <span className="font-bold text-slate-700">Perf {c.performance_score ?? '—'}</span>
                                                <span className="text-slate-500">LCP {c.lcp || '—'}</span>
                                                <span className="text-slate-500">CLS {c.cls || '—'}</span>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* Issues */}
                        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm">
                            <div className="flex items-center justify-between px-5 py-3 border-b border-slate-100">
                                <span className="text-sm font-bold text-slate-800">Issues ({result.issues?.length || 0})</span>
                                {result.issues?.length > 0 && (
                                    <button
                                        onClick={exportIssues}
                                        title="Download CSV"
                                        className="flex items-center gap-1.5 text-[12px] font-semibold text-slate-500 hover:text-slate-700"
                                    >
                                        <ArrowDownTrayIcon className="w-4 h-4" aria-hidden="true" /> Export
                                    </button>
                                )}
                            </div>
                            {result.issues?.length === 0 ? (
                                <EmptyState icon="✅" title="No issues found" description="This property passed all on-page checks." />
                            ) : (
                                <ul className="divide-y divide-slate-50">
                                    {result.issues.map((i, idx) => (
                                        <li key={`${i.type}-${idx}`} className="flex items-start gap-3 px-5 py-3.5">
                                            <span className={`mt-0.5 text-[10px] font-bold uppercase px-2 py-0.5 rounded border ${SEV_STYLE[i.severity] || 'bg-slate-50 border-slate-200 text-slate-600'}`}>
                                                {i.severity}
                                            </span>
                                            <div className="min-w-0">
                                                <div className="text-[13px] font-semibold text-slate-700">{i.message}</div>
                                                <div className="text-[12px] text-slate-400">{i.count} page{i.count === 1 ? '' : 's'} affected</div>
                                            </div>
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}

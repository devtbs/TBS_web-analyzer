import { useState, useEffect, useCallback } from 'react';
import toast from 'react-hot-toast';
import { BellAlertIcon, ArrowPathIcon } from '@heroicons/react/24/outline';
import api from '../api/axios';
import EmptyState from '../components/ui/EmptyState';

const SEV_STYLE = {
    critical: 'bg-red-50 border-red-200 text-red-700',
    warning: 'bg-amber-50 border-amber-200 text-amber-700',
    info: 'bg-sky-50 border-sky-200 text-sky-700',
};

const METRIC_LABEL = { clicks: 'Clicks', impressions: 'Impressions', ctr: 'CTR', position: 'Avg position' };
const DIR_LABEL = { drop: 'drops by', spike: 'jumps by', worsen: 'worsens by' };

export default function AlertsPage() {
    const [alerts, setAlerts] = useState([]);
    const [rules, setRules] = useState([]);
    const [usingDefaults, setUsingDefaults] = useState(true);
    const [loading, setLoading] = useState(true);
    const [evaluating, setEvaluating] = useState(false);

    const load = useCallback(async () => {
        try {
            const [a, r] = await Promise.all([
                api.get('/api/alerts', { params: { limit: 100 } }),
                api.get('/api/alert-rules'),
            ]);
            setAlerts(a.data.alerts || []);
            setRules(r.data.rules || []);
            setUsingDefaults(r.data.using_defaults);
        } catch {
            toast.error('Failed to load alerts');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { load(); }, [load]);

    const runNow = async () => {
        setEvaluating(true);
        try {
            const { data } = await api.post('/api/alerts/evaluate');
            toast.success(data.created ? `${data.created} new alert(s)` : 'No new alerts — all clear');
            await load();
        } catch {
            toast.error('Evaluation failed');
        } finally {
            setEvaluating(false);
        }
    };

    const markAllRead = async () => {
        try {
            await api.post('/api/alerts/read-all');
            setAlerts((prev) => prev.map((x) => ({ ...x, read: true })));
        } catch { toast.error('Failed'); }
    };

    // Persist a rule edit. Defaults have no id → POST to create a custom rule.
    const saveRule = async (rule, patch) => {
        const next = { ...rule, ...patch };
        const body = {
            metric: next.metric,
            direction: next.direction,
            threshold_pct: Number(next.threshold_pct),
            property_url: next.property_url ?? null,
            enabled: next.enabled,
        };
        try {
            if (next.id) {
                await api.put(`/api/alert-rules/${next.id}`, body);
            } else {
                await api.post('/api/alert-rules', body);
            }
            toast.success('Rule saved');
            await load();
        } catch {
            toast.error('Failed to save rule');
        }
    };

    return (
        <div className="min-h-screen bg-[#f5f6f8]">
            <div className="px-8 pt-7 pb-5 bg-white border-b border-slate-200 flex items-center justify-between">
                <div>
                    <h1 className="text-[22px] font-black text-slate-800 tracking-tight flex items-center gap-2">
                        <BellAlertIcon className="w-6 h-6 text-indigo-500" aria-hidden="true" />
                        Alerts
                    </h1>
                    <p className="text-[13px] text-slate-500 mt-1">Notable changes in your traffic and rankings.</p>
                </div>
                <button
                    onClick={runNow}
                    disabled={evaluating}
                    className="flex items-center gap-2 px-4 h-9 text-[13px] font-bold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg disabled:opacity-50 transition-colors"
                >
                    <ArrowPathIcon className={`w-4 h-4 ${evaluating ? 'animate-spin' : ''}`} aria-hidden="true" />
                    Check now
                </button>
            </div>

            <div className="p-8 grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Rules */}
                <div className="lg:col-span-1">
                    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
                        <h2 className="text-sm font-bold text-slate-800 mb-1">Alert rules</h2>
                        <p className="text-[11px] text-slate-400 mb-4">
                            {usingDefaults ? 'Using sensible defaults. Adjust to create your own.' : 'Your custom thresholds.'}
                        </p>
                        <div className="space-y-3">
                            {rules.map((r, i) => (
                                <div key={r.id || `${r.metric}-${r.direction}-${i}`} className="flex items-center gap-2 text-[12px]">
                                    <input
                                        type="checkbox"
                                        checked={r.enabled}
                                        onChange={(e) => saveRule(r, { enabled: e.target.checked })}
                                        className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                                    />
                                    <span className="flex-1 text-slate-600">
                                        {METRIC_LABEL[r.metric]} {DIR_LABEL[r.direction]}
                                    </span>
                                    <input
                                        type="number"
                                        defaultValue={r.threshold_pct}
                                        onBlur={(e) => {
                                            const v = Number(e.target.value);
                                            if (v !== r.threshold_pct) saveRule(r, { threshold_pct: v });
                                        }}
                                        className="w-16 px-2 py-1 text-right border border-slate-200 rounded-md focus:border-indigo-400 focus:outline-none"
                                    />
                                    <span className="text-slate-400">%</span>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>

                {/* Alert list */}
                <div className="lg:col-span-2">
                    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm">
                        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-100">
                            <span className="text-sm font-bold text-slate-800">Recent alerts</span>
                            {alerts.some((a) => !a.read) && (
                                <button onClick={markAllRead} className="text-[12px] font-semibold text-indigo-600 hover:text-indigo-700">
                                    Mark all read
                                </button>
                            )}
                        </div>
                        {loading ? (
                            <div className="flex items-center justify-center py-16">
                                <div className="w-8 h-8 border-4 border-slate-200 border-t-indigo-600 rounded-full animate-spin" />
                            </div>
                        ) : alerts.length === 0 ? (
                            <EmptyState
                                icon="🔔"
                                title="No alerts yet"
                                description="When your clicks, impressions, or rankings change notably, they'll appear here. Hit “Check now” to run a scan."
                            />
                        ) : (
                            <ul className="divide-y divide-slate-50">
                                {alerts.map((a) => (
                                    <li key={a.id} className={`flex items-start gap-3 px-5 py-3.5 ${a.read ? 'opacity-60' : ''}`}>
                                        <span className={`mt-0.5 text-[10px] font-bold uppercase px-2 py-0.5 rounded border ${SEV_STYLE[a.severity] || 'bg-slate-50 border-slate-200 text-slate-600'}`}>
                                            {a.severity}
                                        </span>
                                        <span className="text-[13px] text-slate-700 leading-snug">{a.message}</span>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}

import { useState, useMemo } from 'react';
import {
    ResponsiveContainer, ComposedChart, Bar, Line, LineChart, BarChart,
    ScatterChart, Scatter, ZAxis, PieChart, Pie, XAxis, YAxis, CartesianGrid, Tooltip, Legend, Cell, ReferenceLine,
} from 'recharts';
import { ArrowPathIcon, SparklesIcon } from '@heroicons/react/24/outline';

/*
 * LookerStudioTables — renders the "TBS NEW GA4 & GSC" Looker-template tiles inside the
 * GSC dashboard. Presentational only: the parent (SEOAnalytics) fetches the export payload
 * (see backend/services/looker_export_service.py) and passes it in, so the whole dashboard
 * can block-load as one unit. Props:
 *   data          — the export response { tables, schemas, warnings, ... } or null
 *   brand         — current brand regex string
 *   onBrandChange — (str) => void
 *   onRefresh     — () => void (re-runs the export with the current brand)
 */

const CARD = "bg-white border border-slate-200/80 rounded-2xl p-5 shadow-[0_1px_3px_rgba(15,23,42,0.04),0_8px_24px_-12px_rgba(15,23,42,0.12)] transition-shadow hover:shadow-[0_2px_6px_rgba(15,23,42,0.06),0_12px_32px_-12px_rgba(15,23,42,0.18)]";
const H3 = "text-[14px] font-bold text-slate-800";
const fmt = (n) => (n == null ? '—' : Number(n).toLocaleString());
const pct = (n) => (n == null ? '' : `${n > 0 ? '▲' : n < 0 ? '▼' : ''} ${Math.abs(n)}%`);
const pctColor = (n, lowerIsBetter = false) => {
    if (n == null || n === 0) return 'text-slate-400';
    const good = lowerIsBetter ? n < 0 : n > 0;
    return good ? 'text-emerald-600' : 'text-rose-500';
};
const pctPill = (n, lowerIsBetter = false) => {
    if (n == null || n === 0) return 'bg-slate-100 text-slate-400';
    const good = lowerIsBetter ? n < 0 : n > 0;
    return good ? 'bg-emerald-50 text-emerald-600' : 'bg-rose-50 text-rose-500';
};
const DEVICE_COLORS = ['#0ea5e9', '#6366f1', '#f59e0b', '#94a3b8'];

// Decode a full URL to a readable path. GSC returns non-ASCII (e.g. Thai) paths
// percent-encoded — `/blog/%E0%B8%A3…` → `/blog/ราคา…`. Falls back to the raw value if the
// URL or the %-sequence is malformed.
const prettyPath = (url) => {
    try { return decodeURIComponent(new URL(url).pathname) || '/'; }
    catch {
        try { return decodeURIComponent(url); } catch { return url; }
    }
};
const prettyUrl = (url) => { try { return decodeURIComponent(url); } catch { return url; } };

/* Small reusable KPI scorecard with % + absolute change. */
const Kpi = ({ metric, value, pct_change, abs_change, suffix = '', lowerIsBetter = false }) => (
    <div className={`${CARD} flex flex-col gap-1.5`}>
        <span className="text-[10.5px] font-bold text-slate-400 uppercase tracking-[0.12em]">{metric}</span>
        <span className="text-[24px] font-black text-slate-800 leading-none tracking-tight">{fmt(value)}{suffix}</span>
        <div className="flex items-center gap-2">
            <span className={`text-[11px] font-bold px-1.5 py-0.5 rounded-md ${pctPill(pct_change, lowerIsBetter)}`}>{pct(pct_change) || '—'}</span>
            {abs_change != null && <span className="text-[11px] font-semibold text-slate-400">{abs_change > 0 ? '+' : ''}{fmt(abs_change)}</span>}
        </div>
    </div>
);

const SectionTitle = ({ children }) => (
    <h2 className="flex items-center gap-2.5 text-[16px] font-black text-slate-800 mt-2">
        <span className="w-1 h-5 rounded-full bg-gradient-to-b from-emerald-400 to-teal-600" />
        {children}
    </h2>
);

/* Tooltip for the keyword bubble chart — query name header + the three metrics, styled as a
   clean card to match the Looker template. */
const BubbleTooltip = ({ active, payload }) => {
    if (!active || !payload?.length) return null;
    const d = payload[0].payload;
    return (
        <div className="bg-white rounded-xl border border-slate-200 shadow-lg px-4 py-3 text-[13px]">
            <div className="text-slate-500 mb-2">Query: <span className="font-bold text-slate-800">{d.query}</span></div>
            <div className="text-slate-500">Average Position: <span className="font-bold text-slate-800">{d.position}</span></div>
            <div className="text-slate-500">Clicks: <span className="font-bold text-slate-800">{fmt(d.clicks)}</span></div>
            <div className="text-slate-500">Impressions: <span className="font-bold text-slate-800">{fmt(d.impressions)}</span></div>
        </div>
    );
};

export default function LookerStudioTables({ data, loading, brand, onBrandChange, onRefresh }) {
    const [posTier, setPosTier] = useState('Top 3');

    const t = data?.tables || {};

    const monthly = t.gsc_monthly || [];
    const gscKpis = t.gsc_kpis || [];
    const timeseries = t.gsc_timeseries || [];
    const brandGeneric = t.gsc_brand_generic || [];
    const posBuckets = t.gsc_position_buckets_summary || [];
    const bubble = t.gsc_keyword_bubble || [];
    const landingPages = t.landing_pages || [];
    const striking = t.striking_distance || [];
    const ctrGaps = t.ctr_gaps || [];
    const summary = data?.summary || null;
    const ga4Kpis = t.ga4_kpis || [];
    const ga4Series = t.ga4_sessions_timeseries || [];
    const ga4Channels = t.ga4_channels || [];
    const ga4Countries = t.ga4_countries || [];
    const ga4Devices = t.ga4_devices || [];

    // Scatter declutter: top ~60 by impressions, split by brand segment, with a median
    // impressions reference line. Filter impressions>0 so the log axis is valid.
    const scatter = useMemo(() => {
        const pts = bubble.filter(b => b.impressions > 0).slice(0, 60);
        const branded = pts.filter(b => b.brand_segment === 'Branded');
        const generic = pts.filter(b => b.brand_segment !== 'Branded');
        const imps = pts.map(b => b.impressions).sort((a, b) => a - b);
        const median = imps.length ? imps[Math.floor(imps.length / 2)] : 0;
        return { branded, generic, median, hasBrand: branded.length > 0 };
    }, [bubble]);

    const activeTier = useMemo(
        () => posBuckets.find(b => b.bucket === posTier) || posBuckets[0],
        [posBuckets, posTier]
    );

    // The page's hero row already shows Search Traffic/Volume/CTR/Position, so only surface
    // the genuinely new GSC KPIs here (Unique Pages, Unique Keywords) to avoid duplication.
    const gscKpisExtra = useMemo(
        () => gscKpis.filter(k => k.metric === 'Unique Pages' || k.metric === 'Unique Keywords'),
        [gscKpis]
    );

    // Non-blocking: while the (slow) export loads, show just a compact inline placeholder so
    // the rest of the dashboard stays interactive and renders immediately.
    if (!data) {
        if (!loading) return null;
        return (
            <div className="space-y-3">
                <div className="bg-white border border-slate-200/80 rounded-2xl p-8 flex items-center justify-center gap-3 text-slate-400">
                    <div className="w-5 h-5 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
                    <span className="text-[13px] font-semibold">Building report tables…</span>
                </div>
            </div>
        );
    }

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-end flex-wrap gap-2">
                <div className="flex items-center gap-2">
                    {loading && <div className="w-4 h-4 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />}
                    <label className="text-[11px] font-bold text-slate-400 uppercase tracking-widest">Brand regex</label>
                    <input
                        value={brand}
                        onChange={(e) => onBrandChange?.(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') onRefresh?.(); }}
                        placeholder="brand|brand name"
                        className="text-[12px] border border-slate-200 rounded-lg px-2.5 py-1.5 outline-none focus:ring-1 focus:ring-emerald-500/40 w-44"
                    />
                    <button
                        onClick={() => onRefresh?.()}
                        className="text-[12px] font-bold text-emerald-700 hover:text-emerald-800 border border-emerald-200 rounded-lg px-3 py-1.5 flex items-center gap-1.5"
                    >
                        <ArrowPathIcon className="w-3.5 h-3.5" /> Apply
                    </button>
                </div>
            </div>

            <>
                    {/* ── Executive Summary (AI insights) — plain-English findings for stakeholders ── */}
                    {summary && (
                        <div className="bg-gradient-to-br from-slate-900 to-slate-800 rounded-2xl p-5 shadow-lg">
                            <div className="flex items-center gap-2 mb-2">
                                <SparklesIcon className="w-4 h-4 text-emerald-400" />
                                <h3 className="text-[14px] font-bold text-white">Executive Summary</h3>
                                <span className="text-[10px] text-slate-400 font-semibold uppercase tracking-widest ml-1">last {summary.period_days} days</span>
                            </div>
                            {summary.headline && (
                                <p className="text-[13px] text-slate-200 leading-relaxed mb-3">{summary.headline}</p>
                            )}
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                                {summary.brand_split && (
                                    <ExecStat label="Branded share" value={`${summary.brand_split.branded_share_pct}%`} sub={`${fmt(summary.brand_split.branded_clicks)} branded clicks`} />
                                )}
                                <ExecStat label="Striking distance" value={fmt(summary.striking_distance_opportunities)} sub={`~${fmt(summary.striking_distance_potential_clicks)} clicks if pushed to pg 1`} />
                                {summary.biggest_gainers?.[0] && (
                                    <ExecStat label="Top gainer" value={summary.biggest_gainers[0].query} sub={`▲ ${Math.abs(summary.biggest_gainers[0].position_delta)} to pos ${summary.biggest_gainers[0].position_current}`} good />
                                )}
                                {summary.biggest_losers?.[0] && (
                                    <ExecStat label="Biggest drop" value={summary.biggest_losers[0].query} sub={`▼ ${Math.abs(summary.biggest_losers[0].position_delta)} to pos ${summary.biggest_losers[0].position_current}`} bad />
                                )}
                            </div>
                        </div>
                    )}

                    {/* ── GSC KPIs ── only the ones NOT already in the page's hero KPI row
                        (Clicks/Impressions/CTR/Position); i.e. Unique Pages & Unique Keywords. ── */}
                    {gscKpisExtra.length > 0 && (
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                            {gscKpisExtra.map((k) => (
                                <Kpi key={k.metric} {...k} />
                            ))}
                        </div>
                    )}

                    {/* ── Monthly performance combo ── */}
                    {monthly.length > 0 && (
                        <div className={CARD}>
                            <h3 className={H3}>Performance Over Time (Monthly)</h3>
                            <div className="h-[300px] mt-4">
                                <ResponsiveContainer width="100%" height="100%">
                                    <ComposedChart data={monthly}>
                                        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                                        <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#94a3b8' }} />
                                        <YAxis yAxisId="left" tick={{ fontSize: 11, fill: '#94a3b8' }} />
                                        <YAxis yAxisId="right" orientation="right" reversed tick={{ fontSize: 11, fill: '#94a3b8' }} />
                                        <Tooltip />
                                        <Legend />
                                        <Bar yAxisId="left" dataKey="impressions" name="Impressions" fill="#bbf7d0" radius={[4, 4, 0, 0]} />
                                        <Line yAxisId="left" dataKey="clicks" name="Clicks" stroke="#115e59" strokeWidth={2} dot={false} />
                                        <Line yAxisId="right" dataKey="position" name="Avg Position" stroke="#f59e0b" strokeWidth={2} dot={false} />
                                    </ComposedChart>
                                </ResponsiveContainer>
                            </div>
                        </div>
                    )}

                    {/* ── Weekly traffic vs previous period + Brand/Generic ── */}
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                        {timeseries.length > 0 && (
                            <div className={CARD}>
                                <h3 className={H3}>Search Traffic — Current vs Previous</h3>
                                <div className="h-[260px] mt-4">
                                    <ResponsiveContainer width="100%" height="100%">
                                        <LineChart data={timeseries}>
                                            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                                            <XAxis dataKey="week_start" tick={{ fontSize: 10, fill: '#94a3b8' }} />
                                            <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} />
                                            <Tooltip />
                                            <Legend />
                                            <Line dataKey="search_traffic" name="Current" stroke="#115e59" strokeWidth={2} dot={false} />
                                            <Line dataKey="search_traffic_prev" name="Previous" stroke="#94a3b8" strokeWidth={2} strokeDasharray="4 4" dot={false} />
                                        </LineChart>
                                    </ResponsiveContainer>
                                </div>
                            </div>
                        )}

                        {brandGeneric.length > 0 && (
                            <div className={CARD}>
                                <h3 className={H3}>Performance By Brand / Generic</h3>
                                <div className="h-[260px] mt-4">
                                    <ResponsiveContainer width="100%" height="100%">
                                        <BarChart data={brandGeneric} layout="vertical">
                                            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                                            <XAxis type="number" tick={{ fontSize: 11, fill: '#94a3b8' }} />
                                            <YAxis type="category" dataKey="segment" tick={{ fontSize: 12, fill: '#475569' }} width={70} />
                                            <Tooltip />
                                            <Bar dataKey="clicks" name="Clicks" radius={[0, 4, 4, 0]}>
                                                {brandGeneric.map((b, i) => (
                                                    <Cell key={i} fill={b.segment === 'Branded' ? '#115e59' : '#7dd3fc'} />
                                                ))}
                                            </Bar>
                                        </BarChart>
                                    </ResponsiveContainer>
                                </div>
                                <div className="flex gap-6 justify-center mt-2 text-[12px]">
                                    {brandGeneric.map((b) => (
                                        <span key={b.segment} className="font-bold text-slate-600">
                                            {b.segment}: {fmt(b.clicks)} <span className={pctColor(b.clicks_delta_pct)}>{pct(b.clicks_delta_pct)}</span>
                                        </span>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>

                    {/* ── Position Tracking tiers + Keyword bubble ── */}
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                        {posBuckets.length > 0 && activeTier && (
                            <div className={CARD}>
                                <div className="flex items-center justify-between mb-4">
                                    <h3 className={H3}>Position Tracking</h3>
                                    <div className="flex bg-slate-50 border border-slate-200 rounded-lg p-0.5">
                                        {posBuckets.map((b) => (
                                            <button key={b.bucket} onClick={() => setPosTier(b.bucket)}
                                                className={`px-2.5 py-1 text-[11px] font-bold rounded-md transition-all ${posTier === b.bucket ? 'bg-white text-slate-800 shadow-sm border border-slate-200' : 'text-slate-500 hover:text-slate-700'}`}>
                                                {b.bucket}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                                <div className="grid grid-cols-3 gap-3">
                                    <Stat label="Unique Keywords" value={activeTier.unique_keywords} delta={activeTier.unique_keywords_delta} />
                                    <Stat label="Search Volume" value={activeTier.search_volume} deltaPct={activeTier.search_volume_delta_pct} />
                                    <Stat label="Search Traffic" value={activeTier.search_traffic} deltaPct={activeTier.search_traffic_delta_pct} />
                                    <Stat label="Avg Position" value={activeTier.avg_position} delta={activeTier.avg_position_delta} lowerIsBetter />
                                    <Stat label="Brand %" value={`${activeTier.brand_pct}%`} />
                                    <Stat label="Long-tail %" value={`${activeTier.long_tail_pct}%`} />
                                </div>
                            </div>
                        )}

                        {bubble.length > 0 && (
                            <div className={CARD}>
                                <div className="flex items-center justify-between flex-wrap gap-1">
                                    <h3 className={H3}>Keyword Position &amp; Search Volume</h3>
                                    <span className="text-[10.5px] text-slate-400 font-semibold">top {scatter.branded.length + scatter.generic.length} by volume · ← better rank</span>
                                </div>
                                <div className="h-[300px] mt-4">
                                    <ResponsiveContainer width="100%" height="100%">
                                        <ScatterChart margin={{ top: 10, right: 16, bottom: 14, left: 0 }}>
                                            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                                            <XAxis type="number" dataKey="position" name="Avg Position" reversed domain={[0, 'dataMax']}
                                                tick={{ fontSize: 11, fill: '#94a3b8' }} label={{ value: 'Avg Position (← better)', position: 'insideBottom', offset: -6, fontSize: 11, fill: '#94a3b8' }} />
                                            {/* Log scale spreads the long tail; impressions are >=1 so log is valid */}
                                            <YAxis type="number" dataKey="impressions" name="Impressions" scale="log" domain={[1, 'auto']} allowDataOverflow
                                                tick={{ fontSize: 11, fill: '#94a3b8' }} tickFormatter={(v) => v >= 1000 ? `${Math.round(v / 1000)}k` : v} />
                                            <ZAxis type="number" dataKey="clicks" range={[40, 420]} name="Clicks" />
                                            {/* Page-1 boundary (position 10) + median volume → quadrants */}
                                            <ReferenceLine x={10} stroke="#cbd5e1" strokeDasharray="4 4"
                                                label={{ value: 'Page 1', position: 'top', fontSize: 10, fill: '#94a3b8' }} />
                                            {scatter.median > 0 && (
                                                <ReferenceLine y={scatter.median} stroke="#cbd5e1" strokeDasharray="4 4" />
                                            )}
                                            <Tooltip cursor={{ strokeDasharray: '3 3' }} content={<BubbleTooltip />} />
                                            <Scatter name="Generic" data={scatter.generic} fill="#38bdf8" fillOpacity={0.55} />
                                            {scatter.hasBrand && <Scatter name="Branded" data={scatter.branded} fill="#6366f1" fillOpacity={0.7} />}
                                            <Legend wrapperStyle={{ fontSize: 11 }} />
                                        </ScatterChart>
                                    </ResponsiveContainer>
                                </div>
                                <p className="text-[10.5px] text-slate-400 mt-1">Top-left (page 1, high volume) = priority terms · bubble size = clicks</p>
                            </div>
                        )}
                    </div>

                    {/* ── Top Landing Pages: GSC rankings → GA4 outcomes ── */}
                    {landingPages.length > 0 && (
                        <div className={CARD}>
                            <h3 className={H3}>Top Landing Pages — Search → Site</h3>
                            <p className="text-[11px] text-slate-400 mb-1">Organic clicks (GSC) blended with sessions &amp; conversions (GA4)</p>
                            <SimpleTable
                                cols={['Page', 'Clicks', 'Position', 'Sessions', 'Conv.', 'Conv. Rate']}
                                rows={landingPages.slice(0, 15).map((p) => {
                                    return [
                                        <span className="truncate block max-w-[360px]" title={prettyUrl(p.page)}>{prettyPath(p.page)}</span>,
                                        fmt(p.clicks),
                                        p.position,
                                        p.sessions == null ? '—' : fmt(p.sessions),
                                        p.conversions == null ? '—' : fmt(p.conversions),
                                        p.conv_rate == null ? '—' : `${p.conv_rate}%`,
                                    ];
                                })}
                            />
                        </div>
                    )}

                    {/* ── Actionable opportunity tiles (reuse existing export tables) ── */}
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                        {striking.length > 0 && (
                            <div className={CARD}>
                                <h3 className={H3}>Quick Wins — Striking Distance (pos 11–20)</h3>
                                <p className="text-[11px] text-slate-400 mb-1">Keywords just off page 1 — small gains unlock big traffic</p>
                                <SimpleTable
                                    cols={['Query', 'Pos', 'Impr.', 'Potential']}
                                    rows={striking.slice(0, 10).map((s) => [
                                        <span title={s.query} className="truncate block max-w-[220px]">{s.query}</span>,
                                        s.position, fmt(s.impressions),
                                        <span className="text-emerald-600">+{fmt(s.potential_clicks)}</span>,
                                    ])}
                                />
                            </div>
                        )}
                        {ctrGaps.length > 0 && (
                            <div className={CARD}>
                                <h3 className={H3}>Title/Meta Opportunities — CTR Gaps</h3>
                                <p className="text-[11px] text-slate-400 mb-1">High impressions, low CTR vs benchmark — rewrite titles</p>
                                <SimpleTable
                                    cols={['Query', 'Pos', 'CTR', 'Missed']}
                                    rows={ctrGaps.slice(0, 10).map((c) => [
                                        <span title={c.query} className="truncate block max-w-[220px]">{c.query}</span>,
                                        c.position,
                                        <span><span className="text-rose-500">{c.actual_ctr}%</span> <span className="text-slate-300">/ {c.expected_ctr}%</span></span>,
                                        <span className="text-amber-600">{fmt(c.missed_clicks)}</span>,
                                    ])}
                                />
                            </div>
                        )}
                    </div>

                    {/* ════════════ GA4 SECTION ════════════ */}
                    {ga4Kpis.length > 0 && (
                        <>
                            <SectionTitle>Google Analytics (GA4)</SectionTitle>

                            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
                                {ga4Kpis.map((k) => (
                                    <Kpi key={k.metric} {...k}
                                        suffix={k.metric === 'Engagement Rate' || k.metric === 'Goal Conversion Rate' ? '%' : ''}
                                        lowerIsBetter={false} />
                                ))}
                            </div>

                            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                                {ga4Series.length > 0 && (
                                    <div className={CARD}>
                                        <h3 className={H3}>Sessions Over Time</h3>
                                        <div className="h-[260px] mt-4">
                                            <ResponsiveContainer width="100%" height="100%">
                                                <LineChart data={ga4Series}>
                                                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                                                    <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#94a3b8' }} />
                                                    <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} />
                                                    <Tooltip />
                                                    <Legend />
                                                    <Line dataKey="sessions" name="Sessions" stroke="#2563eb" strokeWidth={2} dot={false} />
                                                    <Line dataKey="sessions_prev" name="Previous" stroke="#93c5fd" strokeWidth={2} strokeDasharray="4 4" dot={false} />
                                                </LineChart>
                                            </ResponsiveContainer>
                                        </div>
                                    </div>
                                )}

                                {ga4Channels.length > 0 && (
                                    <div className={CARD}>
                                        <h3 className={H3}>Sessions By Channel</h3>
                                        <div className="h-[260px] mt-4">
                                            <ResponsiveContainer width="100%" height="100%">
                                                <BarChart data={ga4Channels}>
                                                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                                                    <XAxis dataKey="channel" tick={{ fontSize: 10, fill: '#94a3b8' }} interval={0} angle={-15} textAnchor="end" height={50} />
                                                    <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} />
                                                    <Tooltip />
                                                    <Bar dataKey="sessions" name="Sessions" fill="#7dd3fc" radius={[4, 4, 0, 0]} />
                                                </BarChart>
                                            </ResponsiveContainer>
                                        </div>
                                    </div>
                                )}
                            </div>

                            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                                {ga4Countries.length > 0 && (
                                    <div className={CARD}>
                                        <h3 className={H3}>Sessions By Country</h3>
                                        <SimpleTable
                                            cols={['Country', 'Sessions', 'Change']}
                                            rows={ga4Countries.slice(0, 10).map((c) => [
                                                c.country, fmt(c.sessions),
                                                <span className={pctColor(c.sessions_delta_pct)}>{pct(c.sessions_delta_pct)}</span>,
                                            ])}
                                        />
                                    </div>
                                )}
                                {ga4Devices.length > 0 && (
                                    <div className={CARD}>
                                        <h3 className={H3}>Sessions By Device</h3>
                                        <div className="flex items-center gap-4 mt-2">
                                            <div className="h-[180px] w-[180px] flex-shrink-0">
                                                <ResponsiveContainer width="100%" height="100%">
                                                    <PieChart>
                                                        <Pie data={ga4Devices} dataKey="sessions" nameKey="device"
                                                            innerRadius={50} outerRadius={80} paddingAngle={2} stroke="none">
                                                            {ga4Devices.map((d, i) => (
                                                                <Cell key={d.device} fill={DEVICE_COLORS[i % DEVICE_COLORS.length]} />
                                                            ))}
                                                        </Pie>
                                                        <Tooltip formatter={(v, n) => [fmt(v), n]} />
                                                    </PieChart>
                                                </ResponsiveContainer>
                                            </div>
                                            <div className="flex-1 space-y-2">
                                                {ga4Devices.map((d, i) => (
                                                    <div key={d.device} className="flex items-center justify-between gap-2">
                                                        <div className="flex items-center gap-2 min-w-0">
                                                            <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: DEVICE_COLORS[i % DEVICE_COLORS.length] }} />
                                                            <span className="text-[12px] font-bold text-slate-700 capitalize truncate">{d.device}</span>
                                                        </div>
                                                        <div className="flex items-center gap-2 flex-shrink-0">
                                                            <span className="text-[12px] font-black text-slate-800">{fmt(d.sessions)}</span>
                                                            <span className="text-[11px] text-slate-400 w-10 text-right">{d.session_share_pct}%</span>
                                                            <span className={`text-[11px] font-bold w-14 text-right ${pctColor(d.sessions_delta_pct)}`}>{pct(d.sessions_delta_pct)}</span>
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    </div>
                                )}
                            </div>
                        </>
                    )}

                    {data.warnings?.length > 0 && (
                        <p className="text-[11px] text-slate-400">
                            Some tiles degraded: {data.warnings.join('; ')}
                        </p>
                    )}
            </>
        </div>
    );
}

/* Dark-card stat for the Executive Summary. */
const ExecStat = ({ label, value, sub, good, bad }) => (
    <div className="bg-white/5 rounded-xl px-3 py-2.5">
        <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{label}</div>
        <div className={`text-[14px] font-black leading-tight truncate ${good ? 'text-emerald-400' : bad ? 'text-rose-400' : 'text-white'}`} title={String(value)}>{value}</div>
        {sub && <div className="text-[10.5px] text-slate-400 truncate" title={sub}>{sub}</div>}
    </div>
);

/* Compact stat cell for the Position Tracking grid. */
const Stat = ({ label, value, delta, deltaPct, lowerIsBetter = false }) => (
    <div className="bg-slate-50 rounded-lg p-3">
        <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{label}</div>
        <div className="text-[18px] font-black text-slate-800 leading-tight">{typeof value === 'number' ? fmt(value) : value}</div>
        {(delta != null || deltaPct != null) && (
            <div className={`text-[11px] font-bold ${pctColor(deltaPct != null ? deltaPct : delta, lowerIsBetter)}`}>
                {deltaPct != null ? pct(deltaPct) : `${delta > 0 ? '+' : ''}${delta}`}
            </div>
        )}
    </div>
);

/* Minimal table used for the GA4 country/device tiles. */
const SimpleTable = ({ cols, rows }) => (
    <table className="w-full text-left mt-4">
        <thead>
            <tr className="border-b border-slate-200">
                {cols.map((c, i) => (
                    <th key={i} className={`pb-3 text-[10px] font-bold text-slate-400 uppercase tracking-widest ${i === 0 ? '' : 'text-right'}`}>{c}</th>
                ))}
            </tr>
        </thead>
        <tbody>
            {rows.map((r, i) => (
                <tr key={i} className="border-b border-slate-100 last:border-0 hover:bg-slate-50 transition-colors">
                    {r.map((cell, j) => (
                        <td key={j} className={`py-3 text-[12px] font-bold text-slate-700 ${j === 0 ? '' : 'text-right'}`}>{cell}</td>
                    ))}
                </tr>
            ))}
        </tbody>
    </table>
);

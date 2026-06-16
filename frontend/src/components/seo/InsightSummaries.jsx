import { useState } from 'react';
import {
    ResponsiveContainer, BarChart, ComposedChart, Bar, Line, XAxis, YAxis,
    Tooltip, Legend, CartesianGrid, Cell,
} from 'recharts';

/* ── Small building blocks ───────────────────────────────── */
const Kpi = ({ label, value, sub, accent = 'text-slate-900' }) => (
    <div className="bg-white border border-slate-200 rounded-xl shadow-sm px-5 py-4 flex-1 min-w-[140px]">
        <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">{label}</p>
        <p className={`text-[26px] font-black leading-tight mt-1 ${accent}`}>{value}</p>
        {sub && <p className="text-[12px] text-slate-400 font-medium mt-0.5">{sub}</p>}
    </div>
);

const ChartCard = ({ title, children, right = null, height = 240 }) => (
    <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-5">
        <div className="flex items-center justify-between mb-3 gap-3 flex-wrap">
            <p className="text-[13px] font-bold text-slate-700">{title}</p>
            {right}
        </div>
        <div style={{ width: '100%', height }}>
            <ResponsiveContainer>{children}</ResponsiveContainer>
        </div>
    </div>
);

const trunc = (s, n = 18) => (s && s.length > n ? s.slice(0, n) + '…' : s);
const sum = (arr, k) => arr.reduce((a, r) => a + (r[k] || 0), 0);
const tooltipStyle = { fontSize: 12, borderRadius: 8, border: '1px solid #e2e8f0' };

/* ════════════════════ Striking Distance ════════════════════ */
export function StrikingSummary({ rows }) {
    const bands = [
        { name: '4–5', count: 0 }, { name: '6–10', count: 0 },
        { name: '11–15', count: 0 }, { name: '16–20', count: 0 },
    ];
    rows.forEach(r => {
        const p = r.position;
        if (p <= 5) bands[0].count++;
        else if (p <= 10) bands[1].count++;
        else if (p <= 15) bands[2].count++;
        else bands[3].count++;
    });
    return (
        <div className="space-y-4">
            <div className="flex flex-wrap gap-3">
                <Kpi label="Quick-win keywords" value={rows.length.toLocaleString()} accent="text-amber-600" />
                <Kpi label="Total potential clicks" value={`+${sum(rows, 'potential_clicks').toLocaleString()}`} accent="text-emerald-600" sub="if pushed to top 3" />
                <Kpi label="Total impressions" value={sum(rows, 'impressions').toLocaleString()} />
            </div>
            <ChartCard title="Keywords by position band (closer to page 1 = easier wins)">
                <BarChart data={bands} margin={{ top: 8, right: 12, left: -10, bottom: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                    <XAxis dataKey="name" tick={{ fontSize: 12, fill: '#64748b' }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 12, fill: '#94a3b8' }} axisLine={false} tickLine={false} allowDecimals={false} />
                    <Tooltip contentStyle={tooltipStyle} />
                    <Bar dataKey="count" radius={[6, 6, 0, 0]} name="Keywords">
                        {bands.map((_, i) => <Cell key={i} fill={['#16a34a', '#22c55e', '#f59e0b', '#f43f5e'][i]} />)}
                    </Bar>
                </BarChart>
            </ChartCard>
        </div>
    );
}

/* ════════════════════ CTR Analysis ════════════════════════ */
/* Published organic CTR-by-position benchmarks (approximate, %). */
const BENCHMARKS = {
    'AWR (2026)':           { color: '#f59e0b', data: [32.0, 17.0, 10.5, 7.3, 5.2, 4.0, 3.2, 2.6, 2.3, 2.1, 1.4, 1.2, 1.0, 0.9, 0.8, 0.8, 0.7, 0.6, 0.6, 0.5] },
    'FirstPageSage (2026)': { color: '#10b981', data: [39.8, 18.7, 10.2, 7.2, 5.1, 4.4, 3.0, 2.1, 1.9, 1.6, 1.2, 1.0, 0.9, 0.8, 0.7, 0.6, 0.6, 0.5, 0.5, 0.4] },
    'Sistrix (2024)':       { color: '#8b5cf6', data: [28.5, 15.7, 11.0, 8.0, 7.2, 5.1, 4.0, 3.2, 2.8, 2.5, 1.5, 1.3, 1.1, 1.0, 0.9, 0.8, 0.7, 0.7, 0.6, 0.6] },
    'Backlinko (2019)':     { color: '#ec4899', data: [31.7, 24.7, 18.7, 13.6, 9.5, 6.2, 4.2, 3.1, 3.0, 3.1, 1.8, 1.5, 1.3, 1.2, 1.1, 0.9, 0.8, 0.7, 0.6, 0.6] },
};

export function CtrSummary({ rows, meta }) {
    const [selected, setSelected] = useState(['AWR (2026)', 'Backlinko (2019)']);
    const toggle = (name) => setSelected(s => s.includes(name) ? s.filter(x => x !== name) : [...s, name]);

    const curve = meta?.curve || [];
    const data = Array.from({ length: 20 }, (_, i) => {
        const row = { position: i + 1, site: curve[i]?.ctr ?? null };
        for (const name of selected) row[name] = BENCHMARKS[name].data[i];
        return row;
    });

    const below = rows.filter(r => r.vs_expected < 0).length;
    const beating = rows.length - below;

    const chips = (
        <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-[11px] font-bold text-slate-400 mr-1">Benchmarks:</span>
            {Object.entries(BENCHMARKS).map(([name, { color }]) => {
                const on = selected.includes(name);
                return (
                    <button key={name} onClick={() => toggle(name)}
                        className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold border transition-all ${on ? 'border-slate-300 bg-white text-slate-700 shadow-sm' : 'border-slate-200 bg-slate-50 text-slate-400'}`}>
                        <span className="w-2 h-2 rounded-full" style={{ background: on ? color : '#cbd5e1' }} />
                        {name}
                    </button>
                );
            })}
        </div>
    );

    return (
        <div className="space-y-4">
            <div className="flex flex-wrap gap-3">
                <Kpi label="Queries analyzed" value={rows.length.toLocaleString()} accent="text-indigo-600" />
                <Kpi label="Below benchmark" value={below.toLocaleString()} accent="text-rose-600" sub="title/description to improve" />
                <Kpi label="Beating benchmark" value={beating.toLocaleString()} accent="text-emerald-600" />
            </div>
            <ChartCard title="Average CTR by position (1–20) — your site vs industry benchmarks" right={chips} height={300}>
                <ComposedChart data={data} margin={{ top: 8, right: 16, left: -6, bottom: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                    <XAxis dataKey="position" tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 12, fill: '#94a3b8' }} axisLine={false} tickLine={false} unit="%" />
                    <Tooltip contentStyle={tooltipStyle} formatter={(v) => v == null ? '—' : `${v}%`} labelFormatter={(l) => `Position ${l}`} />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Bar dataKey="site" name="This site" fill="#3b82f6" radius={[3, 3, 0, 0]} barSize={18} />
                    {selected.map(name => (
                        <Line key={name} type="monotone" dataKey={name} stroke={BENCHMARKS[name].color}
                            strokeWidth={2} strokeDasharray="5 4" dot={false} />
                    ))}
                </ComposedChart>
            </ChartCard>
        </div>
    );
}

/* ════════════════════ Cannibalization ════════════════════ */
export function CannibalSummary({ rows }) {
    const top = [...rows].sort((a, b) => b.total_impressions - a.total_impressions).slice(0, 8)
        .map(r => ({ name: trunc(r.query), pages: r.page_count }));
    return (
        <div className="space-y-4">
            <div className="flex flex-wrap gap-3">
                <Kpi label="Cannibalized keywords" value={rows.length.toLocaleString()} accent="text-rose-600" />
                <Kpi label="Pages involved" value={sum(rows, 'page_count').toLocaleString()} sub="competing with each other" />
                <Kpi label="Impressions affected" value={sum(rows, 'total_impressions').toLocaleString()} />
            </div>
            <ChartCard title="Most-contested keywords (number of competing pages)">
                <BarChart data={top} margin={{ top: 8, right: 12, left: -10, bottom: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                    <XAxis dataKey="name" tick={{ fontSize: 10, fill: '#64748b' }} axisLine={false} tickLine={false} interval={0} angle={-20} textAnchor="end" height={60} />
                    <YAxis tick={{ fontSize: 12, fill: '#94a3b8' }} axisLine={false} tickLine={false} allowDecimals={false} />
                    <Tooltip contentStyle={tooltipStyle} />
                    <Bar dataKey="pages" fill="#f59e0b" radius={[4, 4, 0, 0]} name="Competing pages" />
                </BarChart>
            </ChartCard>
        </div>
    );
}

/* ════════════════════ Topic Clusters ════════════════════ */
export function ClusterSummary({ rows }) {
    const top = [...rows].sort((a, b) => b.clicks - a.clicks).slice(0, 8)
        .map(r => ({ name: trunc(r.topic, 16), clicks: r.clicks }));
    return (
        <div className="space-y-4">
            <div className="flex flex-wrap gap-3">
                <Kpi label="Topics" value={rows.length.toLocaleString()} accent="text-indigo-600" />
                <Kpi label="Total clicks" value={sum(rows, 'clicks').toLocaleString()} accent="text-emerald-600" />
                <Kpi label="Total keywords" value={sum(rows, 'query_count').toLocaleString()} />
            </div>
            <ChartCard title="Top themes by clicks">
                <BarChart data={top} margin={{ top: 8, right: 12, left: -10, bottom: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                    <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} interval={0} angle={-20} textAnchor="end" height={60} />
                    <YAxis tick={{ fontSize: 12, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                    <Tooltip contentStyle={tooltipStyle} />
                    <Bar dataKey="clicks" fill="#6366f1" radius={[4, 4, 0, 0]} />
                </BarChart>
            </ChartCard>
        </div>
    );
}

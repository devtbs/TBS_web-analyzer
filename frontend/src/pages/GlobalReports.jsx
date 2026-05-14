import { useState, useEffect, useMemo, useRef } from 'react';
import {
    AreaChart,
    Area,
    ResponsiveContainer,
    Tooltip,
    YAxis,
    XAxis,
    CartesianGrid,
} from 'recharts';
import {
    ClockIcon,
    ChevronDownIcon,
    EyeIcon,
    CursorArrowRaysIcon,
    CalendarIcon,
} from '@heroicons/react/24/outline';
import {
    ArrowTrendingUpIcon,
    ArrowTrendingDownIcon,
    CheckIcon,
} from '@heroicons/react/24/solid';
import api from '../api/axios';
import toast from 'react-hot-toast';

const presetToDays = (preset) => {
    switch (preset) {
        case 'Last 7 days':
        case 'Last Week': return 7;
        case 'Last 14 days': return 14;
        case 'Last 28 days': return 28;
        case 'This Month': {
            const now = new Date();
            const start = new Date(now.getFullYear(), now.getMonth(), 1);
            return Math.max(1, Math.ceil((now - start) / (1000 * 60 * 60 * 24)));
        }
        case 'Last Month': return 30;
        case 'This Quarter': {
            const now = new Date();
            const quarterStartMonth = Math.floor(now.getMonth() / 3) * 3;
            const start = new Date(now.getFullYear(), quarterStartMonth, 1);
            return Math.max(1, Math.ceil((now - start) / (1000 * 60 * 60 * 24)));
        }
        case 'Last Quarter': return 90;
        case 'Year to Date': {
            const now = new Date();
            const start = new Date(now.getFullYear(), 0, 1);
            return Math.max(1, Math.ceil((now - start) / (1000 * 60 * 60 * 24)));
        }
        case '3 months': return 90;
        case '6 months': return 180;
        case '8 months': return 240;
        case '12 months': return 365;
        case '16 months': return 480;
        default: return 28;
    }
};

/* ── sessionStorage TTL cache helpers ────────────────────── */
const SS_PROPS_KEY    = 'gsc_cache_properties';
const SS_ANALYTICS_KEY = 'gsc_cache_analytics';

const ssGet = (key) => {
    try {
        const raw = sessionStorage.getItem(key);
        if (!raw) return null;
        const { ts, data } = JSON.parse(raw);
        if (Date.now() - ts > 5 * 60 * 1000) return null;
        return data;
    } catch { return null; }
};
const ssGetData = (key) => {
    try {
        const raw = sessionStorage.getItem(key);
        if (!raw) return null;
        const { ts, data } = JSON.parse(raw);
        if (Date.now() - ts > 15 * 60 * 1000) return null;
        return data;
    } catch { return null; }
};
const ssSet = (key, data) => {
    try { sessionStorage.setItem(key, JSON.stringify({ ts: Date.now(), data })); } catch {}
};

/* ── Custom Chart Tooltip ──────────────────────────────────── */
const CustomTooltip = ({ active, payload, label }) => {
    if (active && payload && payload.length) {
        return (
            <div className="bg-white border border-slate-100 shadow-[0_8px_30px_rgb(0,0,0,0.12)] rounded-xl p-4 min-w-[210px]">
                <p className="text-[12px] font-bold text-slate-400 mb-3 tracking-wide uppercase">
                    {label}
                </p>
                {payload.map((entry, i) => (
                    <div key={i} className="flex items-center justify-between gap-6 mb-1.5 last:mb-0">
                        <div className="flex items-center gap-2">
                            <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: entry.color }} />
                            <span className="text-[13px] font-semibold text-slate-600">{entry.name}</span>
                        </div>
                        <span className="text-[13px] font-extrabold text-slate-900">
                            {typeof entry.value === 'number' ? entry.value.toLocaleString() : entry.value}
                        </span>
                    </div>
                ))}
            </div>
        );
    }
    return null;
};

/* ── Delta Badge ───────────────────────────────────────────── */
const DeltaBadge = ({ delta, isPositiveGood = true, isCTR = false, isPosition = false }) => {
    if (delta === null || delta === undefined) return null;
    const isGood = isPosition ? delta <= 0 : (isPositiveGood ? delta >= 0 : delta <= 0);
    const isUp = delta > 0;
    const Icon = isUp ? ArrowTrendingUpIcon : ArrowTrendingDownIcon;
    const absVal = Math.abs(delta);
    const formatted = isCTR || isPosition ? `${absVal.toFixed(2)}pp` : `${absVal.toFixed(1)}%`;

    return (
        <span className={`inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-full ${
            isGood ? 'text-emerald-500' : 'text-rose-500'
        }`}>
            <Icon className="w-3 h-3" />
            {formatted}
        </span>
    );
};


/* ── Page Component ────────────────────────────────────────── */
export default function GlobalReports() {
    const [properties, setProperties] = useState([]);
    const [loading, setLoading] = useState(true);
    const [isUpdating, setIsUpdating] = useState(false);
    const [aggregatedData, setAggregatedData] = useState(null);
    const [isDatePickerOpen, setIsDatePickerOpen] = useState(false);
    const [failedSites, setFailedSites] = useState([]); // sites that returned 403 / permission error
    const datePickerRef = useRef(null);

    // Date Picker UI State
    const [dateTab, setDateTab] = useState('Day');
    const [selectedPreset, setSelectedPreset] = useState('Last 28 days');
    const [days, setDays] = useState(28);

    useEffect(() => {
        const handleClickOutside = (event) => {
            if (datePickerRef.current && !datePickerRef.current.contains(event.target)) {
                setIsDatePickerOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    useEffect(() => {
        const loadData = async () => {
            try {
                if (!aggregatedData) {
                    setLoading(true);
                } else {
                    setIsUpdating(true);
                }
                const token = localStorage.getItem('access_token');
                if (!token) { setLoading(false); return; }

                // 1. Get properties
                const cachedProps = ssGet(SS_PROPS_KEY);
                const props = cachedProps || await (async () => {
                    const res = await api.get('/auth/gsc/properties');
                    const p = res.data.properties || [];
                    ssSet(SS_PROPS_KEY, p);
                    return p;
                })();
                setProperties(props);

                // 2. Get analytics
                if (props.length > 0) {
                    const cacheKey = `${SS_ANALYTICS_KEY}_${days}`;
                    let map = ssGetData(cacheKey);
                    if (!map) {
                        const results = await Promise.allSettled(
                            props.map(p =>
                                api.get(`/auth/gsc/analytics/${encodeURIComponent(p.url)}`, {
                                    params: { group_by: 'daily', days: days }
                                }).then(r => ({ url: p.url, data: r.data.analytics }))
                            )
                        );
                        map = {};
                        const failed = [];
                        results.forEach((r, idx) => {
                            if (r.status === 'fulfilled') {
                                map[r.value.url] = r.value.data;
                            } else {
                                const url = props[idx]?.url || 'Unknown';
                                const status = r.reason?.response?.status;
                                failed.push({
                                    url,
                                    domain: url.replace(/^https?:\/\//, '').replace(/\/$/, ''),
                                    reason: status === 403
                                        ? 'Permission denied (403) — verify GSC access'
                                        : status === 401
                                        ? 'Not authorised (401) — reconnect Search Console'
                                        : `Error ${status || 'unknown'}`,
                                    is403: status === 403,
                                });
                            }
                        });
                        setFailedSites(failed);
                        ssSet(cacheKey, map);
                    }

                    // 3. Aggregate everything
                    let totalClicks = 0;
                    let totalImpressions = 0;
                    let totalPos = 0;
                    let totalCtr = 0;
                    
                    let prevClicksTotal = 0;
                    let prevImpressions = 0;
                    let prevPos = 0;
                    let prevCtr = 0;

                    let chartMap = {};

                    let validSites = 0;

                    let propertyBreakdown = [];

                    Object.entries(map).forEach(([url, data]) => {
                        if (!data) return;
                        validSites++;
                        
                        const cur = data.totals || {};
                        const prev = data.previous_totals || {};

                        const clicks = cur.clicks || 0;
                        const impressions = cur.impressions || 0;
                        const position = cur.position || 0;
                        const ctr = cur.ctr || 0;

                        const prevClicks = prev.clicks || 0;
                        let clickDelta = 0;
                        if (prevClicks > 0) {
                            clickDelta = ((clicks - prevClicks) / prevClicks) * 100;
                        } else if (clicks > 0 && prevClicks === 0) {
                            clickDelta = 100;
                        }

                        propertyBreakdown.push({
                            domain: url.replace(/^https?:\/\//, '').replace(/\/$/, ''),
                            clicks,
                            impressions,
                            ctr: ctr,
                            position,
                            clickDelta
                        });

                        totalClicks += clicks;
                        totalImpressions += impressions;
                        totalPos += position;
                        totalCtr += ctr;

                        prevClicksTotal += prevClicks;
                        prevImpressions += prev.impressions || 0;
                        prevPos += prev.position || 0;
                        prevCtr += prev.ctr || 0;

                        (data.chart_data || []).forEach((point, i) => {
                            const dateStr = point.month;
                            if (!chartMap[dateStr]) {
                                chartMap[dateStr] = { dateStr, clicks: 0, impressions: 0, sortIndex: i };
                            }
                            chartMap[dateStr].clicks += point.clicks || 0;
                            chartMap[dateStr].impressions += point.impressions || 0;
                        });
                    });

                    let avgPos = validSites > 0 ? totalPos / validSites : 0;
                    let avgCtr = totalImpressions > 0 ? totalClicks / totalImpressions : 0;

                    let prevAvgPos = validSites > 0 ? prevPos / validSites : 0;
                    let prevAvgCtr = prevImpressions > 0 ? prevClicksTotal / prevImpressions : 0;

                    const deltas = {
                        clicks: prevClicksTotal ? ((totalClicks - prevClicksTotal) / prevClicksTotal) * 100 : 0,
                        impressions: prevImpressions ? ((totalImpressions - prevImpressions) / prevImpressions) * 100 : 0,
                        position: avgPos - prevAvgPos,
                        ctr: (avgCtr - prevAvgCtr) * 100,
                    };

                    propertyBreakdown = propertyBreakdown.map(p => ({
                        ...p,
                        share: totalClicks > 0 ? (p.clicks / totalClicks) * 100 : 0
                    })).sort((a, b) => b.clicks - a.clicks);

                    const sortedChartData = Object.values(chartMap).sort((a, b) => a.sortIndex - b.sortIndex);
                    const finalChartData = sortedChartData.map(d => ({
                        name: d.dateStr,
                        clicks: d.clicks,
                        impressions: d.impressions
                    }));

                    setAggregatedData({
                        totals: { clicks: totalClicks, impressions: totalImpressions, position: avgPos, ctr: avgCtr },
                        deltas,
                        chartData: finalChartData,
                        propertyBreakdown
                    });
                }
            } catch (error) {
                console.error("Failed to load global reports:", error);
            } finally {
                setLoading(false);
                setIsUpdating(false);
            }
        };

        loadData();
    }, [days]);

    if (loading) {
        return (
            <div className="p-8 flex justify-center mt-20">
                <div className="w-8 h-8 border-4 border-emerald-500 border-t-transparent rounded-full animate-spin"></div>
            </div>
        );
    }

    if (!aggregatedData) {
        return (
            <div className="p-8 text-center mt-20 text-slate-500">
                No data available or Search Console not connected.
            </div>
        );
    }

    const { totals, deltas, chartData } = aggregatedData;

    return (
        <div className="flex-1 bg-[#f5f6f8] p-8 w-full">
            
            {/* Header */}
            <div className="flex items-start justify-between mb-6">
                <div>
                    <h1 className="text-[24px] font-black text-slate-900 tracking-tight mb-1">
                        Global Reports
                    </h1>
                    <p className="text-[13px] text-slate-500 font-medium">
                        Cross-property metrics across all your sites ({properties.length} properties)
                    </p>
                </div>
                <div className="flex items-center gap-4">
                    <div className="relative" ref={datePickerRef}>
                        <button 
                            disabled={isUpdating}
                            onClick={() => setIsDatePickerOpen(!isDatePickerOpen)}
                            className="flex items-center gap-1.5 px-3 py-1.5 border border-slate-200 rounded-lg text-[13px] font-semibold text-slate-600 bg-white shadow-sm hover:bg-slate-50 transition-colors disabled:opacity-70 disabled:cursor-wait"
                        >
                            {isUpdating ? (
                                <div className="w-4 h-4 border-[2px] border-slate-400 border-t-transparent rounded-full animate-spin shrink-0"></div>
                            ) : (
                                <ClockIcon className="w-4 h-4 text-slate-400 shrink-0" />
                            )}
                            <span className="truncate max-w-[120px]">{selectedPreset}</span>
                            <ChevronDownIcon className="w-4 h-4 text-slate-400 shrink-0" />
                        </button>

                        {isDatePickerOpen && (
                            <div className="absolute right-0 top-full mt-2 bg-white border border-slate-200 rounded-2xl shadow-[0_12px_40px_rgb(0,0,0,0.12)] z-50 flex w-[380px] overflow-hidden text-left origin-top-right animate-in fade-in zoom-in-95 duration-200">
                                {/* Right Section */}
                                <div className="flex-1 p-6 flex flex-col">
                                    {/* Tabs */}
                                    <div className="flex p-1 bg-[#f1f5f9] rounded-xl mb-6">
                                        {['Day', 'Week', 'Month'].map(tab => (
                                            <button key={tab} onClick={() => setDateTab(tab)} className={`flex-1 py-2 text-[13px] font-bold rounded-lg transition-all ${dateTab === tab ? 'bg-white text-slate-800 shadow-sm' : 'text-[#64748b] hover:text-slate-800'}`}>{tab}</button>
                                        ))}
                                    </div>
                                    
                                    {/* Presets Grid */}
                                    <div className="grid grid-cols-2 gap-x-6 gap-y-1 mb-2">
                                        {(dateTab === 'Day' ? [
                                            'Last 7 days', 'Last 14 days',
                                            'Last 28 days', 'Year to Date',
                                            '3 months', '6 months',
                                            '8 months', '12 months',
                                            '16 months'
                                        ] : dateTab === 'Week' ? [
                                            'Last Week', 'Year to Date',
                                            '3 months', '6 months',
                                            '8 months', '12 months',
                                            '16 months'
                                        ] : [
                                            'This Month', 'Last Month',
                                            'This Quarter', 'Last Quarter',
                                            'Year to Date', '3 months',
                                            '6 months', '8 months',
                                            '12 months', '16 months'
                                        ]).map(preset => (
                                            <button 
                                                key={preset} 
                                                onClick={() => {
                                                    setSelectedPreset(preset);
                                                    setDays(presetToDays(preset));
                                                    setIsDatePickerOpen(false);
                                                }} 
                                                className={`text-left px-3.5 py-2.5 rounded-lg text-[13px] font-bold transition-all ${selectedPreset === preset ? 'bg-[#eef2f0] text-[#10705a]' : 'text-[#334155] hover:bg-[#f1f5f9]'}`}
                                            >
                                                {preset}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* 403 / permission error banner */}
            {failedSites.length > 0 && (
                <div className="mb-6 bg-amber-50 border border-amber-200 rounded-xl p-4">
                    <div className="flex items-start gap-3">
                        <div className="w-5 h-5 mt-0.5 flex-shrink-0 text-amber-500">
                            <svg fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
                            </svg>
                        </div>
                        <div className="flex-1">
                            <p className="text-[13px] font-bold text-amber-800 mb-1">
                                {failedSites.length} {failedSites.length === 1 ? 'property' : 'properties'} could not be loaded
                            </p>
                            <p className="text-[12px] text-amber-700 mb-3">
                                Data below is based on {properties.length - failedSites.length} of {properties.length} properties. Fix permissions in Google Search Console to include the missing sites.
                            </p>
                            <div className="space-y-1.5">
                                {failedSites.map((s, i) => (
                                    <div key={i} className="flex items-center gap-2 text-[12px]">
                                        <span className={`px-2 py-0.5 rounded font-black text-[10px] ${
                                            s.is403 ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'
                                        }`}>
                                            {s.is403 ? '403' : 'ERR'}
                                        </span>
                                        <span className="font-semibold text-amber-900">{s.domain}</span>
                                        <span className="text-amber-600">— {s.reason}</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                        <button
                            onClick={() => setFailedSites([])}
                            className="text-amber-400 hover:text-amber-600 transition-colors p-1 rounded flex-shrink-0"
                            title="Dismiss"
                        >
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                            </svg>
                        </button>
                    </div>
                </div>
            )}

            <div className={`relative transition-opacity duration-300 ${isUpdating ? 'opacity-80 pointer-events-none' : ''}`}>
                
                {/* KPI Cards */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
                
                {/* Total Clicks */}
                <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
                    <div className="flex items-center gap-1.5 text-slate-500 mb-2">
                        <CursorArrowRaysIcon className="w-4 h-4" />
                        <span className="text-[12px] font-semibold">Total Clicks</span>
                    </div>
                    <div className="text-[28px] font-black text-slate-900 leading-none mb-2">
                        {totals.clicks.toLocaleString()}
                    </div>
                    <div className="-ml-1">
                        <DeltaBadge delta={deltas.clicks} />
                    </div>
                </div>

                {/* Total Impressions */}
                <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
                    <div className="flex items-center gap-1.5 text-slate-500 mb-2">
                        <EyeIcon className="w-4 h-4" />
                        <span className="text-[12px] font-semibold">Total Impressions</span>
                    </div>
                    <div className="text-[28px] font-black text-slate-900 leading-none mb-2">
                        {totals.impressions.toLocaleString()}
                    </div>
                    <div className="-ml-1">
                        <DeltaBadge delta={deltas.impressions} />
                    </div>
                </div>

                {/* Avg CTR */}
                <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
                    <div className="flex items-center gap-1.5 text-slate-500 mb-2">
                        <span className="text-[12px] font-semibold">Avg CTR</span>
                    </div>
                    <div className="text-[28px] font-black text-slate-900 leading-none mb-2">
                        {(totals.ctr * 100).toFixed(2)}%
                    </div>
                    <div className="-ml-1">
                        <DeltaBadge delta={deltas.ctr} isCTR={true} />
                    </div>
                </div>

                {/* Avg Position */}
                <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
                    <div className="flex items-center gap-1.5 text-slate-500 mb-2">
                        <span className="text-[12px] font-semibold">Avg Position</span>
                    </div>
                    <div className="text-[28px] font-black text-slate-900 leading-none mb-2">
                        {totals.position.toFixed(1)}
                    </div>
                    <div className="-ml-1">
                        <DeltaBadge delta={deltas.position} isPosition={true} />
                    </div>
                </div>

            </div>

            {/* Aggregated Daily Trend Chart */}
            <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm mb-6">
                <div className="flex items-center gap-2 mb-6">
                    <ArrowTrendingUpIcon className="w-5 h-5 text-slate-400" />
                    <h2 className="text-[14px] font-bold text-slate-800">Aggregated Daily Trend</h2>
                </div>
                <div className="h-[300px]">
                    {chartData && chartData.length > 0 ? (
                        <ResponsiveContainer width="100%" height={300}>
                            <AreaChart data={chartData} margin={{ top: 10, right: 0, left: -20, bottom: 0 }}>
                            <defs>
                                <linearGradient id="colorClicks" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="5%" stopColor="#0f766e" stopOpacity={0.15}/>
                                    <stop offset="95%" stopColor="#0f766e" stopOpacity={0}/>
                                </linearGradient>
                                <linearGradient id="colorImpressions" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="5%" stopColor="#34d399" stopOpacity={0.1}/>
                                    <stop offset="95%" stopColor="#34d399" stopOpacity={0}/>
                                </linearGradient>
                            </defs>
                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                            <XAxis 
                                dataKey="name" 
                                axisLine={false}
                                tickLine={false}
                                tick={{ fill: '#94a3b8', fontSize: 11, fontWeight: 500 }}
                                dy={10}
                            />
                            <YAxis 
                                yAxisId="left"
                                axisLine={false}
                                tickLine={false}
                                tick={{ fill: '#94a3b8', fontSize: 11, fontWeight: 500 }}
                            />
                            <YAxis 
                                yAxisId="right" 
                                orientation="right" 
                                axisLine={false}
                                tickLine={false}
                                tick={{ fill: '#94a3b8', fontSize: 11, fontWeight: 500 }}
                            />
                            <Tooltip content={<CustomTooltip />} cursor={{ stroke: '#cbd5e1', strokeWidth: 1, strokeDasharray: '4 4' }} />
                            <Area 
                                yAxisId="right"
                                type="monotone" 
                                dataKey="impressions" 
                                name="Impressions"
                                stroke="#34d399" 
                                strokeWidth={2}
                                fillOpacity={1} 
                                fill="url(#colorImpressions)" 
                                activeDot={false}
                            />
                            <Area 
                                yAxisId="left"
                                type="monotone" 
                                dataKey="clicks" 
                                name="Clicks"
                                stroke="#0f766e" 
                                strokeWidth={3}
                                fillOpacity={1} 
                                fill="url(#colorClicks)" 
                                activeDot={{ r: 5, fill: '#0f766e', stroke: '#fff', strokeWidth: 2 }}
                            />
                        </AreaChart>
                        </ResponsiveContainer>
                    ) : (
                        <div className="flex items-center justify-center h-full text-[13px] text-slate-400 font-medium">
                            No chart data available for this period.
                        </div>
                    )}
                </div>
            </div>

            {/* Bottom Row */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                
                {/* Traffic by Search Type */}
                <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm flex flex-col min-h-[320px]">
                    <div className="flex items-center gap-2 mb-auto">
                        <ChartBarIcon className="w-4 h-4 text-slate-500" />
                        <h2 className="text-[14px] font-extrabold text-slate-800">Traffic by Search Type</h2>
                    </div>
                    <div className="w-full flex flex-col flex-1">
                        <div className="mb-4 flex items-center justify-between text-[13px] font-bold">
                            <span className="text-slate-800">Web</span>
                            <span className="text-slate-600 tracking-tight">{totals.clicks.toLocaleString()} clicks <span className="text-slate-500 font-medium ml-0.5">({totals.clicks > 0 ? '100.0' : '0.0'}%)</span></span>
                        </div>
                        <div className="flex-1 min-h-[140px] -mx-2">
                            {chartData && chartData.length > 0 ? (
                                <ResponsiveContainer width="100%" height="100%">
                                    <AreaChart data={chartData} margin={{ top: 5, right: 5, left: 5, bottom: 0 }}>
                                        <defs>
                                            <linearGradient id="miniWebClicks" x1="0" y1="0" x2="0" y2="1">
                                                <stop offset="0%" stopColor="#10b981" stopOpacity={0.2} />
                                                <stop offset="100%" stopColor="#10b981" stopOpacity={0} />
                                            </linearGradient>
                                        </defs>
                                        <YAxis domain={['auto', 'auto']} hide />
                                        <Area
                                            type="monotone"
                                            dataKey="clicks"
                                            stroke="#10b981"
                                            strokeWidth={2}
                                            fill="url(#miniWebClicks)"
                                            dot={false}
                                            activeDot={false}
                                        />
                                    </AreaChart>
                                </ResponsiveContainer>
                            ) : (
                                <div className="h-full flex items-center justify-center text-[12px] text-slate-400">No trend data</div>
                            )}
                        </div>
                        <div className="mt-4 text-[12px] text-[#94a3b8] font-medium tracking-tight border-t border-slate-100 pt-4">
                            {totals.impressions.toLocaleString()} impressions
                        </div>
                    </div>
                    <div className="mt-auto"></div>
                </div>

                {/* Top Countries (Mock) */}
                <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm flex flex-col min-h-[320px]">
                    <div className="flex items-center justify-between mb-6">
                        <div className="flex items-center gap-2">
                            <GlobeAltIcon className="w-4 h-4 text-slate-500" />
                            <h2 className="text-[14px] font-extrabold text-slate-800">Top Countries</h2>
                        </div>
                    </div>
                    <div className="overflow-x-auto flex-1">
                        <table className="w-full text-left border-collapse">
                            <thead>
                                <tr>
                                    <th className="pb-3 text-[10px] font-bold text-[#94a3b8] uppercase tracking-[0.05em] border-b border-slate-100">Country</th>
                                    <th className="pb-3 text-[10px] font-bold text-[#94a3b8] uppercase tracking-[0.05em] border-b border-slate-100 text-right">Clicks</th>
                                    <th className="pb-3 text-[10px] font-bold text-[#94a3b8] uppercase tracking-[0.05em] border-b border-slate-100 text-right">Impressions</th>
                                    <th className="pb-3 text-[10px] font-bold text-[#94a3b8] uppercase tracking-[0.05em] border-b border-slate-100 text-right">Share</th>
                                </tr>
                            </thead>
                            <tbody>
                                {[
                                    { c: 'United States', code: '🇺🇸', clicks: Math.floor(totals.clicks * 0.321), imp: Math.floor(totals.impressions * 0.321), share: '32.1%' },
                                    { c: 'France', code: '🇫🇷', clicks: Math.floor(totals.clicks * 0.127), imp: Math.floor(totals.impressions * 0.127), share: '12.7%' },
                                    { c: 'Philippines', code: '🇵🇭', clicks: Math.floor(totals.clicks * 0.108), imp: Math.floor(totals.impressions * 0.108), share: '10.8%' },
                                    { c: 'United Kingdom', code: '🇬🇧', clicks: Math.floor(totals.clicks * 0.104), imp: Math.floor(totals.impressions * 0.104), share: '10.4%' },
                                    { c: 'India', code: '🇮🇳', clicks: Math.floor(totals.clicks * 0.066), imp: Math.floor(totals.impressions * 0.066), share: '6.6%' },
                                ].map((row, i) => (
                                    <tr key={i} className="group">
                                        <td className="py-3 text-[12px] font-bold text-slate-700 flex items-center gap-2">
                                            <span className="text-[14px] leading-none grayscale-[0.2]">{row.code}</span>
                                            {row.c}
                                        </td>
                                        <td className="py-3 text-[12px] font-black text-slate-800 text-right">{row.clicks.toLocaleString()}</td>
                                        <td className="py-3 text-[12px] font-medium text-[#64748b] text-right">{row.imp.toLocaleString()}</td>
                                        <td className="py-3 text-[12px] font-semibold text-[#94a3b8] text-right">{row.share}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>

            </div>

            {/* Property Breakdown Table */}
            <div className="mt-6 bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
                <div className="flex items-center justify-between p-6 border-b border-slate-100">
                    <div className="flex items-center gap-2">
                        <ChartBarIcon className="w-5 h-5 text-slate-400" />
                        <h2 className="text-[14px] font-bold text-slate-800">Property Breakdown</h2>
                    </div>
                </div>
                <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                        <thead>
                            <tr>
                                <th className="py-3 px-6 text-[11px] font-bold text-slate-400 uppercase tracking-wider border-b border-slate-100">#</th>
                                <th className="py-3 px-6 text-[11px] font-bold text-slate-400 uppercase tracking-wider border-b border-slate-100">Property</th>
                                <th className="py-3 px-6 text-[11px] font-bold text-slate-400 uppercase tracking-wider border-b border-slate-100 text-right">Clicks</th>
                                <th className="py-3 px-6 text-[11px] font-bold text-slate-400 uppercase tracking-wider border-b border-slate-100 text-right">Impressions</th>
                                <th className="py-3 px-6 text-[11px] font-bold text-slate-400 uppercase tracking-wider border-b border-slate-100 text-right">CTR</th>
                                <th className="py-3 px-6 text-[11px] font-bold text-slate-400 uppercase tracking-wider border-b border-slate-100 text-right">Position</th>
                                <th className="py-3 px-6 text-[11px] font-bold text-slate-400 uppercase tracking-wider border-b border-slate-100 text-right">Change</th>
                            </tr>
                        </thead>
                        <tbody>
                            {aggregatedData.propertyBreakdown.map((row, i) => (
                                <tr key={i} className="border-b border-slate-50 last:border-0 hover:bg-slate-50/50 transition-colors">
                                    <td className="py-4 px-6 text-[13px] font-bold text-slate-400">{i + 1}</td>
                                    <td className="py-4 px-6 text-[13px] font-bold text-slate-800">{row.domain}</td>
                                    <td className="py-4 px-6 text-[13px] font-bold text-slate-800 text-right">
                                        {row.clicks.toLocaleString()}
                                        <div className="text-[11px] text-slate-400 font-medium">{row.share.toFixed(1)}%</div>
                                    </td>
                                    <td className="py-4 px-6 text-[13px] font-bold text-slate-800 text-right">{row.impressions.toLocaleString()}</td>
                                    <td className="py-4 px-6 text-[13px] font-bold text-slate-800 text-right">{row.ctr.toFixed(2)}%</td>
                                    <td className="py-4 px-6 text-[13px] font-bold text-slate-800 text-right">{row.position.toFixed(1)}</td>
                                    <td className="py-4 px-6 text-[13px] font-bold text-right">
                                        {row.clickDelta === 0 ? (
                                            <span className="text-slate-400">~0%</span>
                                        ) : (
                                            <span className={`flex items-center justify-end gap-1 ${row.clickDelta > 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
                                                {row.clickDelta > 0 ? <ArrowTrendingUpIcon className="w-3 h-3" /> : <ArrowTrendingDownIcon className="w-3 h-3" />}
                                                {Math.abs(row.clickDelta).toFixed(0)}%
                                            </span>
                                        )}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
            </div>
        </div>
    );
}

function ChartBarIcon({ className }) {
    return (
        <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 0 1 3 19.875v-6.75ZM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V8.625ZM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V4.125Z" />
        </svg>
    );
}

function GlobeAltIcon({ className }) {
    return (
        <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 21a9.004 9.004 0 0 0 8.716-6.747M12 21a9.004 9.004 0 0 1-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m0 0a8.997 8.997 0 0 1 7.843 4.582M12 3a8.997 8.997 0 0 0-7.843 4.582m15.686 0A11.953 11.953 0 0 1 12 10.5c-2.998 0-5.74-1.1-7.843-2.918m15.686 0A8.959 8.959 0 0 1 21 12c0 .778-.099 1.533-.284 2.253m0 0A17.919 17.919 0 0 1 12 16.5c-3.162 0-6.133-.815-8.716-2.247m0 0A9.015 9.015 0 0 1 3 12c0-1.605.42-3.113 1.157-4.418" />
        </svg>
    );
}

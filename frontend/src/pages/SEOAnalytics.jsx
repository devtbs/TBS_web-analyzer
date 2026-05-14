import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import * as XLSX from 'xlsx';
import {
    ChevronDownIcon,
} from '@heroicons/react/20/solid';
import { ArrowPathIcon, LinkIcon, PlusIcon, ArrowTopRightOnSquareIcon, ArrowDownTrayIcon, ChartBarIcon, PencilIcon, MagnifyingGlassIcon, XMarkIcon, SparklesIcon, EyeIcon, FunnelIcon, ClockIcon } from '@heroicons/react/24/outline';
import {
    AreaChart,
    Area,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    ResponsiveContainer,
    ComposedChart,
    Line,
    BarChart,
    Bar,
    Cell,
    Legend,
    LineChart
} from 'recharts';
import { ArrowTrendingUpIcon, ArrowTrendingDownIcon } from '@heroicons/react/24/solid';
import api from '../api/axios';
import toast from 'react-hot-toast';
import Favicon from '../components/ui/Favicon';

/* ── sessionStorage cache (15-min TTL) ────────────────────── */
const ssGet = (key) => {
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

/* ── Skeleton primitives ───────────────────────────────── */
const Shimmer = ({ className = '' }) => (
    <div className={`bg-slate-100 rounded-lg animate-pulse ${className}`} />
);

const SkeletonStatCard = () => (
    <div className="flex items-center gap-3">
        <Shimmer className="w-12 h-12 rounded-2xl" />
        <div className="flex flex-col gap-2">
            <Shimmer className="w-20 h-6" />
            <Shimmer className="w-14 h-3" />
        </div>
    </div>
);

const SkeletonChart = () => (
    <div className="mb-10 bg-white border border-slate-100 rounded-3xl p-6 shadow-sm">
        <div className="flex gap-4 mb-6">
            {[140, 100, 120, 90].map((w, i) => <Shimmer key={i} className={`h-4`} style={{ width: w }} />)}
        </div>
        <Shimmer className="w-full h-[320px] rounded-2xl" />
    </div>
);

const SkeletonTableRow = ({ i }) => (
    <tr className="border-b border-slate-50">
        <td className="py-3.5 px-4"><Shimmer className="h-3" style={{ width: `${160 + (i % 5) * 40}px`, animationDelay: `${i * 40}ms` }} /></td>
        {[0,1,2,3].map(j => (
            <td key={j} className="py-3.5 px-4 text-right"><Shimmer className="h-3 w-14 ml-auto" style={{ animationDelay: `${i * 40 + j * 15}ms` }} /></td>
        ))}
    </tr>
);

const SkeletonWidget = ({ height = 'h-48' }) => (
    <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
        <Shimmer className="w-32 h-4 mb-4" />
        <Shimmer className={`w-full ${height} rounded-xl`} />
    </div>
);

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
const DeltaBadge = ({ delta, isPositiveGood = true, suffix = '%', isCTR = false, isPosition = false }) => {
    if (delta === null || delta === undefined) return null;
    // For position: lower is better — invert the colour logic
    const isGood = isPosition ? delta <= 0 : (isPositiveGood ? delta >= 0 : delta <= 0);
    const isUp = delta > 0;
    const Icon = isUp ? ArrowTrendingUpIcon : ArrowTrendingDownIcon;
    const absVal = Math.abs(delta);
    const formatted = isCTR || isPosition
        ? `${absVal.toFixed(2)}pp`
        : `${absVal.toFixed(1)}${suffix}`;

    return (
        <span className={`inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-full ${
            isGood
                ? 'bg-emerald-50 text-emerald-600'
                : 'bg-rose-50 text-rose-500'
        }`}>
            <Icon className="w-3 h-3" />
            {formatted}
        </span>
    );
};

const getDomain = (url) => {
    try { 
        let domain = new URL(url).hostname.replace('www.', ''); 
        return domain.length > 25 ? domain.substring(0, 22) + '...' : domain;
    }
    catch { 
        return url.length > 25 ? url.substring(0, 22) + '...' : url; 
    }
};

const getStatus = (avgPos) => {
    if (avgPos === 0 || avgPos > 100) return 'Unranked';
    if (avgPos < 4) return 'Top result';
    if (avgPos < 10) return 'Quick Win';
    if (avgPos < 30) return 'Opportunity';
    if (avgPos < 60) return 'Ranked';
    return 'Decay';
};

const handleDownloadCSV = (data, filename) => {
    if (!data || !data.length) return;
    const headers = Object.keys(data[0]);
    const csvContent = [
        headers.join(','),
        ...data.map(row => headers.map(header => {
            let val = row[header];
            if (typeof val === 'string') {
                return `"${val.replace(/"/g, '""')}"`;
            }
            return val;
        }).join(','))
    ].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.setAttribute('download', filename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
};

const getStatusInfo = (status) => {
    switch (status) {
        case 'Top result': return { color: 'bg-emerald-400', label: 'Top Result' };
        case 'Quick Win': return { color: 'bg-cyan-300', label: 'Quick Win' };
        case 'Opportunity': return { color: 'bg-amber-300', label: 'Opportunity' };
        case 'Ranked': return { color: 'bg-slate-200', label: 'Ranked' };
        case 'Decay': return { color: 'bg-rose-300', label: 'Decay' };
        case 'Unranked': return { color: 'bg-indigo-100', label: 'Unranked' };
        default: return { color: 'bg-slate-400', label: 'All' };
    }
};

const getStatusDesc = (status) => {
    switch (status) {
        case 'Top result': return 'Position is 1–10 and has not recently experienced ranking loss';
        case 'Quick Win': return 'Achieved 1–10 position within 3 months from publishing';
        case 'Decay': return 'Lost more than 2 positions and clicks decreased';
        case 'Opportunity': return 'Strong potential; in positions 11–30 with significant search volume';
        case 'Ranked': return 'Generating clicks, but no leading avg. position';
        default: return 'No recorded rankings or clicks in the past 30 days';
    }
};

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

/* ── Component ─────────────────────────────────────────────── */
const SEOAnalytics = () => {
    const navigate = useNavigate();
    const [isConnected, setIsConnected] = useState(null);
    const [properties, setProperties] = useState([]);
    const [selectedProperty, setSelectedProperty] = useState('');
    const [activeTab, setActiveTab] = useState('Pages');
    const [chartGrouping, setChartGrouping] = useState('daily');
    const [isDomainPickerOpen, setIsDomainPickerOpen] = useState(false);
    const [domainSearch, setDomainSearch] = useState('');
    
    // Data states
    const [loading, setLoading] = useState(false);
    const [isUpdating, setIsUpdating] = useState(false);
    const [analytics, setAnalytics] = useState(null);
    const [deltas, setDeltas] = useState(null);
    const [pages, setPages] = useState([]);
    const [chartData, setChartData] = useState([]);
    const [permissionError, setPermissionError] = useState(null); // null | property URL string

    // Chart toggles
    const [activeMetrics, setActiveMetrics] = useState({
        clicks: true,
        impressions: true,
        ctr: false,
        position: false
    });

    // Filtering states
    const [statusFilter, setStatusFilter] = useState('All');

    // GSC-style filters
    const [gscFilters, setGscFilters] = useState([]);
    const [addFilterMenuOpen, setAddFilterMenuOpen] = useState(false);
    const [filterDialog, setFilterDialog] = useState(null); // null or { dimension: 'page' | 'query' }
    const [tempFilter, setTempFilter] = useState({ operator: 'contains', expression: '' });
    const filterMenuRef = useRef(null);
    const filterDialogRef = useRef(null);
    
    // Pagination
    const [currentPage, setCurrentPage] = useState(1);
    const itemsPerPage = 10;

    // Date Picker UI State
    const [isDatePickerOpen, setIsDatePickerOpen] = useState(false);
    const datePickerRef = useRef(null);
    const [dateTab, setDateTab] = useState('Day');
    const [selectedPreset, setSelectedPreset] = useState('Last 28 days');
    const [days, setDays] = useState(28);

    const [queryViewMode, setQueryViewMode] = useState('Total');
    const [pagesViewMode, setPagesViewMode] = useState('Total');
    const [devicesTab, setDevicesTab] = useState('All');
    const [countriesTab, setCountriesTab] = useState('All');
    const [newRankingsTab, setNewRankingsTab] = useState('Queries');

    // Real GSC breakdown data
    const [realCountries, setRealCountries] = useState([]);
    const [realDevices, setRealDevices] = useState([]);
    const [realDailyStats, setRealDailyStats] = useState([]);
    const [countriesTotal, setCountriesTotal] = useState(0);
    const countriesSectionRef = useRef(null);

    useEffect(() => {
        const handleClickOutside = (event) => {
            if (datePickerRef.current && !datePickerRef.current.contains(event.target)) {
                setIsDatePickerOpen(false);
            }
            if (filterPanelRef.current && !filterPanelRef.current.contains(event.target)) {
                setFilterPanelOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);


    const [isMounted, setIsMounted] = useState(false);
    useEffect(() => {
        setIsMounted(true);
    }, []);

    // Listen to sidebar property changes
    useEffect(() => {
        const handlePropChange = () => {
            const saved = localStorage.getItem('gsc_selected_property');
            if (saved) {
                setSelectedProperty(saved);
                setLoading(true);
                setAnalytics(null);
            }
        };
        window.addEventListener('gsc_property_changed', handlePropChange);
        return () => window.removeEventListener('gsc_property_changed', handlePropChange);
    }, []);

    // Load Properties on Component Mount
    useEffect(() => {
        const fetchProperties = async () => {
            try {
                const authToken = localStorage.getItem('access_token');
                if (!authToken) {
                    setIsConnected(false);
                    return;
                }
                const res = await api.get('/auth/gsc/properties');
                const fetchedProps = res.data.properties || [];
                setProperties(fetchedProps);
                setIsConnected(true);
                if (fetchedProps.length > 0) {
                    const savedProperty = localStorage.getItem('gsc_selected_property');
                    const isValidSaved = fetchedProps.some(p => p.url === savedProperty);
                    setSelectedProperty(isValidSaved ? savedProperty : fetchedProps[0].url);
                }
            } catch (err) {
                setIsConnected(false);
                if (err.response?.status !== 404) {
                    const message = err.response?.data?.detail || 'Failed to fetch Search Console status';
                    toast.error(message);
                }
            }
        };
        fetchProperties();
    }, []);

    // Save selected property to local storage & clear permission error on switch
    useEffect(() => {
        if (selectedProperty) {
            localStorage.setItem('gsc_selected_property', selectedProperty);
            setPermissionError(null); // reset any prior 403 when user picks a new property
        }
    }, [selectedProperty]);

    // Close menus on outside click
    useEffect(() => {
        const handleClickOutside = (e) => {
            if (filterMenuRef.current && !filterMenuRef.current.contains(e.target)) setAddFilterMenuOpen(false);
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    // Load Analytics data when property changes
    useEffect(() => {
        if (!selectedProperty) return;

        const apiFilters = gscFilters.filter(f => ['query', 'page'].includes(f.dimension));
        const filterHash = apiFilters.length > 0 ? '_' + btoa(JSON.stringify(apiFilters)) : '';
        const cacheKey = `seo_analytics_${selectedProperty}_${chartGrouping}_${days}${filterHash}`;
        const cached = ssGet(cacheKey);
        if (cached) {
            setAnalytics(cached.totals);
            setDeltas(cached.deltas || null);
            setChartData(cached.chart_data);
            setPages(cached.pages);
            setCurrentPage(1);
            setLoading(false);
            return;
        }

        const fetchAnalytics = async () => {
            if (!analytics) {
                setLoading(true);
            } else {
                setIsUpdating(true);
            }
            try {
                const queryParams = { 
                    group_by: chartGrouping, 
                    days: days,
                    ...(apiFilters.length > 0 && {
                        filters_json: JSON.stringify(apiFilters)
                    })
                };
                const res = await api.get(`/auth/gsc/analytics/${encodeURIComponent(selectedProperty)}`, { 
                    params: queryParams
                });
                const payload = {
                    totals:     res.data.analytics.totals,
                    deltas:     res.data.analytics.deltas || null,
                    chart_data: res.data.analytics.chart_data,
                    pages:      res.data.pages,
                };
                ssSet(cacheKey, payload);
                setAnalytics(payload.totals);
                setDeltas(payload.deltas);
                setChartData(payload.chart_data);
                setPages(payload.pages);
                setCurrentPage(1);
            } catch (err) {
                if (err.response?.status === 403) {
                    setPermissionError(selectedProperty);
                } else {
                    const message = err.response?.data?.detail || 'Failed to fetch analytics for this property';
                    toast.error(message);
                }
            } finally {
                setLoading(false);
                setIsUpdating(false);
            }
        };

        fetchAnalytics();
    }, [selectedProperty, chartGrouping, days, gscFilters]);

    // Fetch countries & devices when property or days change
    useEffect(() => {
        if (!selectedProperty) return;
        const fetchBreakdowns = async () => {
            const apiFilters = gscFilters.filter(f => ['query', 'page'].includes(f.dimension));
            const filterHash = apiFilters.length > 0 ? '_' + btoa(JSON.stringify(apiFilters)) : '';
            const bdKey = `seo_breakdowns_${selectedProperty}_${days}${filterHash}`;
            const bdCached = ssGet(bdKey);
            if (bdCached) {
                setRealCountries(bdCached.countries || []);
                setCountriesTotal(bdCached.total || 0);
                setRealDevices(bdCached.devices || []);
                setRealDailyStats(bdCached.daily_stats || []);
                return;
            }
            try {
                const queryParams = { 
                    days,
                    ...(apiFilters.length > 0 && {
                        filters_json: JSON.stringify(apiFilters)
                    })
                };
                const [cRes, dRes, dsRes] = await Promise.all([
                    api.get(`/auth/gsc/countries/${encodeURIComponent(selectedProperty)}`, { params: queryParams }),
                    api.get(`/auth/gsc/devices/${encodeURIComponent(selectedProperty)}`, { params: queryParams }),
                    api.get(`/auth/gsc/daily-stats/${encodeURIComponent(selectedProperty)}`, { params: queryParams }),
                ]);
                const bd = {
                    countries:   cRes.data.countries || [],
                    total:       cRes.data.total || 0,
                    devices:     dRes.data.devices || [],
                    daily_stats: dsRes.data.daily_stats || [],
                };
                ssSet(bdKey, bd);
                setRealCountries(bd.countries);
                setCountriesTotal(bd.total);
                setRealDevices(bd.devices);
                setRealDailyStats(bd.daily_stats);
            } catch (err) {
                if (err.response?.status !== 403) {
                    console.warn('Could not load country/device/daily breakdown:', err.message);
                }
                // 403 on breakdowns is expected when main analytics already shows the banner
            }
        };
        fetchBreakdowns();
    }, [selectedProperty, days, gscFilters]);

    const handleLogoutGSC = async (e) => {
        if (e) e.preventDefault();
        const confirmLogout = window.confirm("Are you sure you want to disconnect your Google Search Console account?");
        if (!confirmLogout) return;

        try {
            const authToken = localStorage.getItem('access_token');
            await api.post('/auth/gsc/disconnect', {});
            localStorage.removeItem('gsc_selected_property');
            sessionStorage.clear();
            setIsConnected(false);
            setProperties([]);
            setSelectedProperty('');
            setAnalytics(null);
            setChartData([]);
            setPages([]);
            toast.success('Successfully disconnected from GSC');
        } catch (err) {
            console.error("Logout error:", err);
            toast.error('Failed to disconnect from Search Console');
        }
    };

    const METRIC_CONFIGS = {
        clicks:      { id: 'clicks',      label: 'Total Clicks',      format: val => val != null ? Number(val).toLocaleString(undefined, { maximumFractionDigits: 0 }) : '-' },
        impressions: { id: 'impressions', label: 'Total Impressions',  format: val => val != null ? Number(val).toLocaleString(undefined, { maximumFractionDigits: 0 }) : '-' },
        ctr:         { id: 'ctr',         label: 'Avg. CTR',           format: val => val != null ? `${val.toFixed(2)}%` : '-' },
        position:    { id: 'position',    label: 'Avg. Position',      format: val => val != null ? val.toFixed(1) : '-' },
    };

    const statsData = [
        { ...METRIC_CONFIGS.clicks,      value: METRIC_CONFIGS.clicks.format(analytics?.clicks),      delta: deltas?.clicks,      isPositiveGood: true,  isPosition: false, isCTR: false },
        { ...METRIC_CONFIGS.impressions, value: METRIC_CONFIGS.impressions.format(analytics?.impressions), delta: deltas?.impressions, isPositiveGood: true,  isPosition: false, isCTR: false },
        { ...METRIC_CONFIGS.ctr,         value: METRIC_CONFIGS.ctr.format(analytics?.ctr),            delta: deltas?.ctr,         isPositiveGood: true,  isPosition: false, isCTR: true  },
        { ...METRIC_CONFIGS.position,    value: METRIC_CONFIGS.position.format(analytics?.position),  delta: deltas?.position,    isPositiveGood: false, isPosition: true,  isCTR: false },
    ];

    // Derived Data for Tabs
    const activeTabList = useMemo(() => {
        let results = [];
        if (activeTab === 'Pages') {
            results = pages;
        } else if (activeTab === 'Queries') {
            const queryMap = {};
            pages.forEach(p => {
                p.queries?.forEach(q => {
                    if (!queryMap[q.query]) {
                        queryMap[q.query] = {
                            url: q.query, // use url for consistent property access in table
                            isQuery: true,
                            total_clicks: 0,
                            total_impressions: 0,
                            total_position_x_imp: 0,
                        };
                    }
                    queryMap[q.query].total_clicks += q.clicks;
                    queryMap[q.query].total_impressions += q.impressions;
                    queryMap[q.query].total_position_x_imp += (q.position * q.impressions);
                });
            });
            results = Object.values(queryMap).map(q => ({
                ...q,
                avg_position: q.total_impressions > 0 ? (q.total_position_x_imp / q.total_impressions) : 0
            })).sort((a, b) => b.total_clicks - a.total_clicks);
        } else if (activeTab === 'Clusters') {
            const clusterMap = {};
            
            // 1. Group all unique queries and their stats
            const queryStats = {};
            pages.forEach(p => {
                p.queries?.forEach(q => {
                    if (!queryStats[q.query]) {
                        queryStats[q.query] = { clicks: 0, impressions: 0, position_x_imp: 0 };
                    }
                    queryStats[q.query].clicks += q.clicks;
                    queryStats[q.query].impressions += q.impressions;
                    queryStats[q.query].position_x_imp += (q.position * q.impressions);
                });
            });

            // 2. Cluster by common words in query
            Object.keys(queryStats).forEach(queryText => {
                const words = queryText.toLowerCase().split(/\s+/).filter(w => w.length > 3);
                
                // Use words as clusters
                words.forEach(word => {
                    if (!clusterMap[word]) {
                        clusterMap[word] = {
                            url: `cluster-${word}`,
                            label: word,
                            isCluster: true,
                            total_clicks: 0,
                            total_impressions: 0,
                            total_position_x_imp: 0,
                            top_queries: [],
                        };
                    }
                    const stats = queryStats[queryText];
                    clusterMap[word].total_clicks += stats.clicks;
                    clusterMap[word].total_impressions += stats.impressions;
                    clusterMap[word].total_position_x_imp += stats.position_x_imp;
                    
                    if (!clusterMap[word].top_queries.find(t => t.text === queryText)) {
                        clusterMap[word].top_queries.push({ text: queryText, clicks: stats.clicks });
                    }
                });
            });

            results = Object.values(clusterMap)
                .map(c => ({
                    ...c,
                    avg_position: c.total_impressions > 0 ? (c.total_position_x_imp / c.total_impressions) : 0,
                    top_queries: c.top_queries.sort((a, b) => b.clicks - a.clicks).slice(0, 2).map(q => q.text)
                }))
                .sort((a, b) => b.total_impressions - a.total_impressions)
                .slice(0, 50); // Increased slice to allow for better filtering
        }

        // Apply Status Filter
        if (statusFilter !== 'All') {
            results = results.filter(r => getStatus(r.avg_position) === statusFilter);
        }

        return results;
    }, [pages, activeTab, statusFilter]);

    // -- Computed Data for New Widgets --
    const computedWidgets = useMemo(() => {
        if (!pages || pages.length === 0 || !chartData || chartData.length === 0) return null;

        // 1. Impressions by Position
        // Prefer realDailyStats (date×query dimension — more complete, less truncated)
        // than pages.queries (page×query — blows up row count and gets truncated)
        let posBuckets;
        if (realDailyStats.length > 0) {
            const totals = { p1: 0, p2: 0, p3: 0, p4: 0 };
            realDailyStats.forEach(d => {
                totals.p1 += d['1-3']   || 0;
                totals.p2 += d['4-10']  || 0;
                totals.p3 += d['11-20'] || 0;
                totals.p4 += d['21+']   || 0;
            });
            const totalImp = totals.p1 + totals.p2 + totals.p3 + totals.p4;
            posBuckets = [
                { name: '1-3',   count: totals.p1, percent: totalImp > 0 ? ((totals.p1 / totalImp) * 100).toFixed(1) : '0' },
                { name: '4-10',  count: totals.p2, percent: totalImp > 0 ? ((totals.p2 / totalImp) * 100).toFixed(1) : '0' },
                { name: '11-20', count: totals.p3, percent: totalImp > 0 ? ((totals.p3 / totalImp) * 100).toFixed(1) : '0' },
                { name: '21+',   count: totals.p4, percent: totalImp > 0 ? ((totals.p4 / totalImp) * 100).toFixed(1) : '0' },
            ];
        } else {
            // Fallback while daily stats are loading
            posBuckets = [
                { name: '1-3',   count: 0, percent: '0' },
                { name: '4-10',  count: 0, percent: '0' },
                { name: '11-20', count: 0, percent: '0' },
                { name: '21+',   count: 0, percent: '0' },
            ];
            let totalImp = 0;
            pages.forEach(p => {
                p.queries?.forEach(q => {
                    totalImp += q.impressions;
                    if (q.position <= 3)       posBuckets[0].count += q.impressions;
                    else if (q.position <= 10) posBuckets[1].count += q.impressions;
                    else if (q.position <= 20) posBuckets[2].count += q.impressions;
                    else                       posBuckets[3].count += q.impressions;
                });
            });
            if (totalImp > 0) {
                posBuckets.forEach(b => b.percent = ((b.count / totalImp) * 100).toFixed(1));
            }
        }
        
        // 2. Daily stats for Query Counting & Pages Ranking charts (real data)
        const stackedQueryData = realDailyStats.length > 0
            ? realDailyStats
            : chartData.map((d) => ({
                name: d.month || d.date || '',
                totalQueries: 0,
                totalPages: 0,
                '1-3': 0,
                '4-10': 0,
                '11-20': 0,
                '21+': 0,
            }));

        // 3. Devices Table (real data via realDevices state, fallback shape)
        const devicesData = realDevices.length > 0
            ? realDevices.map(d => ({
                name: d.name,
                clicks: d.clicks,
                imp: d.impressions,
                ctr: d.ctr,
                cd: d.clicks_delta ?? 0,
                id: d.impressions_delta ?? 0,
            }))
            : [];

        // 4. Countries Table (real data via realCountries state, top 10 preview)
        const countriesData = realCountries.slice(0, 10).map(c => ({
            name: c.name,
            clicks: c.clicks,
            imp: c.impressions,
            ctr: c.ctr,
            position: c.position,
            cd: c.clicks_delta ?? 0,
            id: c.impressions_delta ?? 0,
        }));

        // 5. New Rankings — top queries by clicks from real page data
        const queryMap = {};
        pages.forEach(p => {
            p.queries?.forEach(q => {
                if (!queryMap[q.query]) queryMap[q.query] = { name: q.query, clicks: 0, imp: 0 };
                queryMap[q.query].clicks += q.clicks;
                queryMap[q.query].imp += q.impressions;
            });
        });
        const newRankingsQueries = Object.values(queryMap)
            .sort((a, b) => b.clicks - a.clicks)
            .slice(0, 10);

        const newRankingsPages = pages.slice(0, 10).map(p => ({
            name: p.url.replace(/^https?:\/\/(www\.)?/, ''),
            clicks: p.total_clicks || 0,
            imp: p.total_impressions || 0
        }));

        // 6. Pages Ranking by position buckets — computed from actual pages[] avg_position
        //    Each page is placed in a bucket based on its avg_position. We aggregate counts
        //    across all pages so the chart shows how many pages sit in each position bucket.
        const pageBuckets = { 'p1-3': 0, 'p4-10': 0, 'p11-20': 0, 'p21+': 0 };
        pages.forEach(p => {
            const pos = p.avg_position ?? 0;
            if (pos > 0 && pos <= 3)        pageBuckets['p1-3']++;
            else if (pos <= 10)             pageBuckets['p4-10']++;
            else if (pos <= 20)             pageBuckets['p11-20']++;
            else if (pos > 20)             pageBuckets['p21+']++;
        });

        // Build a single-bar data point so the chart has something to render
        // (we don't have daily page-position history, so show aggregate snapshot)
        const pagesRankingData = stackedQueryData.map((d, i, arr) => ({
            name: d.name,
            // Distribute pages proportionally across dates (static snapshot)
            '1-3':   i === arr.length - 1 ? pageBuckets['p1-3']   : null,
            '4-10':  i === arr.length - 1 ? pageBuckets['p4-10']  : null,
            '11-20': i === arr.length - 1 ? pageBuckets['p11-20'] : null,
            '21+':   i === arr.length - 1 ? pageBuckets['p21+']  : null,
        }));

        // Simpler: just a flat summary array for a bar chart
        const pagesRankingSummary = [
            { name: 'Pos 1-3',   count: pageBuckets['p1-3'],   fill: '#0f766e' },
            { name: 'Pos 4-10',  count: pageBuckets['p4-10'],  fill: '#115e59' },
            { name: 'Pos 11-20', count: pageBuckets['p11-20'], fill: '#34d399' },
            { name: 'Pos 21+',  count: pageBuckets['p21+'],  fill: '#a7f3d0' },
        ];

        return { posBuckets, stackedQueryData, pagesRankingSummary, devicesData, countriesData, newRankingsQueries, newRankingsPages };
    }, [pages, chartData, analytics, realCountries, realDevices, realDailyStats]);

    const toggleMetric = (id) => {
        setActiveMetrics(prev => ({ ...prev, [id]: !prev[id] }));
    };

    const metricStyles = {
        clicks: { bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-200', fill: '#0f766e', icon: <SparklesIcon className="w-4 h-4" /> },
        impressions: { bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-200', fill: '#34d399', icon: <EyeIcon className="w-4 h-4" /> },
        ctr: { bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-200', fill: '#64748b', icon: <span className="font-bold">%</span> },
        position: { bg: 'bg-amber-50', text: 'text-amber-600', border: 'border-amber-200', fill: '#d97706', icon: <ArrowTrendingUpIcon className="w-4 h-4" /> }
    };

    const handleDownloadReport = () => {
        if (!pages || pages.length === 0) {
            toast.error('No data available to download');
            return;
        }

        // 1. Prepare Queries Data
        const queryMap = {};
        pages.forEach(p => {
            p.queries?.forEach(q => {
                if (!queryMap[q.query]) {
                    queryMap[q.query] = {
                        query: q.query,
                        clicks: 0,
                        impressions: 0,
                        total_pos_imp: 0,
                    };
                }
                queryMap[q.query].clicks += q.clicks;
                queryMap[q.query].impressions += q.impressions;
                queryMap[q.query].total_pos_imp += (q.position * q.impressions);
            });
        });

        const queryRows = Object.values(queryMap).map(q => {
            const avgPos = q.impressions > 0 ? q.total_pos_imp / q.impressions : 0;
            const status = getStatus(avgPos);
            return {
                'Query': q.query,
                'Clicks': q.clicks,
                'Impressions': q.impressions,
                'CTR': q.impressions > 0 ? ((q.clicks / q.impressions) * 100).toFixed(2) + '%' : '0.00%',
                'Position': avgPos.toFixed(2),
                'Clicks Diff': 0,
                'Impressions Diff': 0,
                'CTR Diff': 0,
                'Position Diff': 0,
                'Months with Data': 12,
                'Status': status,
                'Status Desc': getStatusDesc(status)
            };
        }).sort((a, b) => b.Clicks - a.Clicks);

        // 2. Prepare Pages Data
        const pageRows = pages.map(p => {
            const ctr = p.total_impressions > 0 ? ((p.total_clicks / p.total_impressions) * 100).toFixed(2) : '0.00';
            const status = getStatus(p.avg_position);
            return {
                'Page URL': p.url,
                'Clicks': p.total_clicks,
                'Impressions': p.total_impressions,
                'CTR': ctr + '%',
                'Position': p.avg_position.toFixed(2),
                'Clicks Diff': 0,
                'Impressions Diff': 0,
                'CTR Diff': 0,
                'Position Diff': 0,
                'Months with Data': 12,
                'Status': status,
                'Status Desc': getStatusDesc(status)
            };
        }).sort((a, b) => b.Clicks - a.Clicks);

        // 3. Create Workbook
        const wb = XLSX.utils.book_new();
        
        // Add Queries Sheet
        const wsQueries = XLSX.utils.json_to_sheet(queryRows);
        XLSX.utils.book_append_sheet(wb, wsQueries, 'Queries');
        
        // Add Pages Sheet
        const wsPages = XLSX.utils.json_to_sheet(pageRows);
        XLSX.utils.book_append_sheet(wb, wsPages, 'Pages');

        // 4. Trigger Download
        const domain = getDomain(selectedProperty).replace(/\./g, '_');
        XLSX.writeFile(wb, `SEO_Report_${domain}_${new Date().toISOString().split('T')[0]}.xlsx`);
        toast.success('Report downloaded successfully');
    };

    // Table Filtering
    const filteredPages = useMemo(() => {
        return activeTabList.filter((item) => {
            const text = item.url?.toLowerCase() ?? '';

            // ── GSC Filters (Local fallback for UI instant update) ───────────────────────
            for (const f of gscFilters) {
                if (['clicks', 'impressions', 'ctr', 'position'].includes(f.dimension)) {
                    const clicks     = item.total_clicks      ?? item.clicks      ?? 0;
                    const imps       = item.total_impressions ?? item.impressions  ?? 0;
                    const ctr        = imps > 0 ? (clicks / imps) * 100 : 0;
                    const pos        = item.avg_position      ?? item.position    ?? 0;
                    
                    const val = f.dimension === 'clicks' ? clicks : f.dimension === 'impressions' ? imps : f.dimension === 'ctr' ? ctr : pos;
                    const target = Number(f.expression);
                    if (isNaN(target)) continue;
                    
                    if (f.operator === 'greaterThan' && val <= target) return false;
                    if (f.operator === 'lessThan' && val >= target) return false;
                    if (f.operator === 'equals' && val !== target) return false;
                } else {
                    const isRegex = f.operator === 'includingRegex';
                    const isExact = f.operator === 'equals';
                    const isNotContains = f.operator === 'notContains';
                    try {
                        const pattern = isRegex 
                            ? new RegExp(f.expression, 'i')
                            : new RegExp(f.expression.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&'), 'i');
                        
                        if (f.dimension === 'page') {
                            if (isExact) {
                                if (item.url !== f.expression) return false;
                            } else if (isNotContains) {
                                if (pattern.test(item.url || '')) return false;
                            } else {
                                if (!pattern.test(item.url || '')) return false;
                            }
                        } else if (f.dimension === 'query') {
                            const qStr = item.queries?.map(q => q.query).join(' ') || item.query || item['Query'] || '';
                            if (isExact) {
                                if (!item.queries?.some(q => q.query === f.expression) && item.query !== f.expression && item['Query'] !== f.expression) return false;
                            } else if (isNotContains) {
                                if (pattern.test(qStr)) return false;
                            } else {
                                if (!pattern.test(qStr)) return false;
                            }
                        }
                    } catch { /* invalid regex */ }
                }
            }

            return true;
        });
    }, [activeTabList, activeTab, statusFilter, gscFilters]);

    // Pagination
    const totalPagesCount = Math.ceil(filteredPages.length / itemsPerPage);
    const paginatedPages = filteredPages.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

    // Fallback UI when checking connected status
    if (isConnected === null) {
        return (
            <div className="p-6 max-w-[1600px] mx-auto min-h-screen bg-white flex flex-col items-center justify-center -mt-20">
                <div className="w-16 h-16 border-4 border-slate-100 border-t-emerald-500 rounded-full animate-spin mb-6" />
                <h1 className="text-xl font-medium text-slate-600 animate-pulse">Loading Search Console...</h1>
            </div>
        );
    }

    // Fallback UI when not connected
    if (isConnected === false) {
        return (
            <div className="p-6 max-w-[1600px] mx-auto min-h-screen bg-white flex flex-col items-center justify-center -mt-20">
                <div className="w-20 h-20 bg-slate-50 rounded-full flex items-center justify-center mb-6 shadow-sm border border-slate-100">
                    <ChartBarIcon className="w-10 h-10 text-slate-400" />
                </div>
                <h1 className="text-2xl font-bold text-slate-800 mb-3 text-center">Search Console Not Connected</h1>
                <p className="text-slate-500 mb-8 max-w-md text-center leading-relaxed">
                    Connect your Google Search Console account to view real-time traffic analytics, keyword performance, and search visibility trends.
                </p>
                <button 
                    onClick={() => navigate('/new-analysis')}
                    className="flex items-center gap-2 px-6 py-2.5 bg-emerald-50 text-emerald-600 rounded-md font-medium hover:bg-emerald-100 transition-colors border border-emerald-100/50"
                >
                    <PlusIcon className="w-5 h-5" />
                    Connect Search Console
                </button>
            </div>
        );
    }

    return (
        <div className="p-3 sm:p-6 max-w-[1600px] mx-auto min-h-screen bg-white">

            {/* ── Top Bar (Title + Filters) ── */}
            <header className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 mb-6 pb-6 border-b border-slate-100">
                
                {/* Left: Page Title */}
                <div className="flex items-center gap-3">
                    {selectedProperty && (
                        <Favicon url={selectedProperty} size={32} className="flex-shrink-0 rounded-md shadow-sm border border-slate-100" />
                    )}
                    <div>
                        <h1 className="text-[20px] font-black text-slate-900 tracking-tight leading-none">
                            Google Search Performance
                        </h1>
                    </div>
                </div>

                {/* Right: Domain, Query, Page Filters & Logout */}
                <div className="flex flex-wrap items-center gap-3 lg:ml-auto">


                    {/* Logout / Disconnect Button */}
                    <button 
                        onClick={handleLogoutGSC}
                        className="ml-2 text-slate-400 hover:text-rose-500 font-bold text-[13px] transition-colors tracking-tight whitespace-nowrap hidden lg:block"
                        title="Disconnect Search Console"
                    >
                        Disconnect
                    </button>
                </div>
            </header>

            {loading ? (
                // ── Skeleton layout matching the real page ──────────────────
                <div className="animate-in fade-in duration-300">
                    {/* Date range bar */}
                    <div className="flex items-center gap-3 mb-8 px-1">
                        <Shimmer className="w-52 h-4" />
                        <Shimmer className="w-40 h-4" />
                    </div>
                    {/* Stat cards */}
                    <div className="flex flex-wrap items-center gap-x-12 gap-y-6 mb-8 px-2">
                        {[0,1,2,3].map(i => <SkeletonStatCard key={i} />)}
                    </div>
                    {/* Chart */}
                    <SkeletonChart />
                    {/* Widget grid row 1 */}
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
                        <SkeletonWidget height="h-56" />
                        <SkeletonWidget height="h-56" />
                    </div>
                    {/* Widget grid row 2 */}
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-8">
                        <SkeletonWidget height="h-40" />
                        <SkeletonWidget height="h-56" />
                    </div>
                    {/* Table skeleton */}
                    <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
                        <div className="p-4 border-b border-slate-100 flex gap-3">
                            {[80,60,60].map((w,i) => <Shimmer key={i} className="h-8 rounded-lg" style={{width:w}} />)}
                        </div>
                        <table className="w-full">
                            <thead><tr className="bg-slate-50">
                                {['w-48','w-16','w-16','w-12','w-12'].map((w,i) => (
                                    <th key={i} className="py-3 px-4"><Shimmer className={`h-3 ${w}`} /></th>
                                ))}
                            </tr></thead>
                            <tbody>{Array.from({length:8}).map((_,i) => <SkeletonTableRow key={i} i={i} />)}</tbody>
                        </table>
                    </div>
                </div>
            ) : permissionError === selectedProperty ? (
                /* ── Permission Denied Banner ── */
                <motion.div
                    initial={{ opacity: 0, y: 16 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.35 }}
                    className="flex flex-col items-center justify-center py-24 px-6"
                >
                    <div className="w-20 h-20 rounded-2xl bg-amber-50 border border-amber-100 flex items-center justify-center mb-6 shadow-sm">
                        <svg xmlns="http://www.w3.org/2000/svg" className="w-10 h-10 text-amber-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
                        </svg>
                    </div>
                    <h2 className="text-[22px] font-black text-slate-800 mb-2 tracking-tight text-center">
                        Access Denied
                    </h2>
                    <p className="text-slate-500 text-[14px] text-center max-w-md leading-relaxed mb-1">
                        Your Google account doesn&apos;t have permission to view data for:
                    </p>
                    <code className="text-emerald-700 font-mono text-[13px] bg-emerald-50 border border-emerald-100 px-3 py-1 rounded-lg mb-6">
                        {selectedProperty}
                    </code>
                    <p className="text-slate-400 text-[13px] text-center max-w-sm leading-relaxed mb-8">
                        Ask the site owner to add your Google account as a <strong className="text-slate-600">Full User</strong> or <strong className="text-slate-600">Owner</strong> in Google Search Console.
                    </p>
                    <div className="flex items-center gap-3">
                        <a
                            href="https://support.google.com/webmasters/answer/2451999"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-2 px-5 py-2.5 bg-amber-50 text-amber-700 border border-amber-200 rounded-lg font-semibold text-[13px] hover:bg-amber-100 transition-colors"
                        >
                            <ArrowTopRightOnSquareIcon className="w-4 h-4" />
                            How to grant access
                        </a>
                        <button
                            onClick={() => setSelectedProperty('')}
                            className="flex items-center gap-2 px-5 py-2.5 bg-slate-50 text-slate-600 border border-slate-200 rounded-lg font-semibold text-[13px] hover:bg-slate-100 transition-colors"
                        >
                            <ArrowPathIcon className="w-4 h-4" />
                            Choose Another Property
                        </button>
                    </div>
                </motion.div>
            ) : (
                <AnimatePresence>
                    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.3 }}
                        className={`transition-opacity duration-300 ${isUpdating ? 'opacity-60 pointer-events-none' : ''}`}
                    >
                        {/* ── Top Header Context (Mocked to match screenshot) ── */}
                        <div className="flex flex-col mb-8 px-1">         
                            {/* Row 2: Toggles and Search/Date */}
                            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                                {/* Left: Filter & Toggles */}
                                <div className="flex items-center gap-2 flex-wrap">
                                    {/* ── Active GSC Filter Chips ── */}
                                    {gscFilters.map((f, i) => (
                                        <span key={i} className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-full text-[13px] font-bold text-slate-700 shadow-sm">
                                            <span className="capitalize text-slate-500">{f.dimension}:</span>
                                            {f.operator === 'contains' ? 'containing' : f.operator === 'notContains' ? 'not containing' : f.operator === 'equals' ? (['clicks', 'impressions', 'ctr', 'position'].includes(f.dimension) ? '=' : 'exact') : f.operator === 'greaterThan' ? '>' : f.operator === 'lessThan' ? '<' : 'regex'}
                                            <span className="text-slate-900 mx-1">{['clicks', 'impressions', 'ctr', 'position'].includes(f.dimension) ? f.expression : `"${f.expression}"`}</span>
                                            <button onClick={() => {
                                                setGscFilters(prev => prev.filter((_, idx) => idx !== i));
                                                setCurrentPage(1);
                                            }} className="text-slate-400 hover:text-slate-600 transition-colors ml-1"><XMarkIcon className="w-3.5 h-3.5" /></button>
                                        </span>
                                    ))}

                                    {/* ── GSC Style Add Filter Button ── */}
                                    <div className="relative" ref={filterMenuRef}>
                                        <button
                                            onClick={() => setAddFilterMenuOpen(p => !p)}
                                            className="flex items-center gap-1.5 px-3.5 py-1.5 border border-slate-200 rounded-full text-[13px] font-bold text-slate-600 bg-white shadow-sm hover:bg-slate-50 hover:text-slate-800 transition-colors"
                                        >
                                            <PlusIcon className="w-4 h-4 text-emerald-600" />
                                            Add filter
                                        </button>

                                        {addFilterMenuOpen && (
                                            <div className="absolute left-0 top-full mt-1.5 z-50 w-40 bg-white border border-slate-200 rounded-lg shadow-lg overflow-hidden py-1">
                                                {['query', 'page', 'clicks', 'impressions', 'ctr', 'position'].map(dim => (
                                                    <button
                                                        key={dim}
                                                        onClick={() => {
                                                            setFilterDialog({ dimension: dim });
                                                            setTempFilter({ operator: ['clicks', 'impressions', 'ctr', 'position'].includes(dim) ? 'greaterThan' : 'contains', expression: '' });
                                                            setAddFilterMenuOpen(false);
                                                        }}
                                                        className="w-full text-left px-4 py-2 text-[13px] font-medium text-slate-700 hover:bg-slate-50 transition-colors capitalize"
                                                    >
                                                        {dim}
                                                    </button>
                                                ))}
                                            </div>
                                        )}

                                        {filterDialog && (
                                            <div className="absolute left-0 top-full mt-1.5 z-50 w-80 bg-white border border-slate-200 rounded-xl shadow-xl overflow-hidden animate-in fade-in zoom-in-95 duration-200" ref={filterDialogRef}>
                                                <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
                                                    <span className="text-[14px] font-bold text-slate-800 capitalize">{filterDialog.dimension}</span>
                                                    <button onClick={() => setFilterDialog(null)} className="text-slate-400 hover:text-slate-600"><XMarkIcon className="w-4 h-4" /></button>
                                                </div>
                                                <div className="p-5 flex flex-col gap-4">
                                                    <select
                                                        value={tempFilter.operator}
                                                        onChange={e => setTempFilter(f => ({ ...f, operator: e.target.value }))}
                                                        className="w-full px-3 py-2 text-[13px] font-medium bg-white border border-slate-200 rounded-lg outline-none focus:border-emerald-400 transition-colors"
                                                    >
                                                        {['clicks', 'impressions', 'ctr', 'position'].includes(filterDialog.dimension) ? (
                                                            <>
                                                                <option value="greaterThan">Greater than (&gt;)</option>
                                                                <option value="lessThan">Less than (&lt;)</option>
                                                                <option value="equals">Equals (=)</option>
                                                            </>
                                                        ) : (
                                                            <>
                                                                <option value="contains">{filterDialog.dimension === 'query' ? 'Queries' : 'URLs'} containing</option>
                                                                <option value="notContains">{filterDialog.dimension === 'query' ? 'Queries' : 'URLs'} not containing</option>
                                                                <option value="equals">Exact {filterDialog.dimension}</option>
                                                                <option value="includingRegex">Custom (regex)</option>
                                                            </>
                                                        )}
                                                    </select>
                                                    <input
                                                        type={['clicks', 'impressions', 'ctr', 'position'].includes(filterDialog.dimension) ? 'number' : 'text'}
                                                        step={['ctr', 'position'].includes(filterDialog.dimension) ? '0.1' : '1'}
                                                        value={tempFilter.expression}
                                                        onChange={e => setTempFilter(f => ({ ...f, expression: e.target.value }))}
                                                        placeholder={`Enter ${filterDialog.dimension}...`}
                                                        className="w-full px-3 py-2 text-[13px] border border-slate-200 rounded-lg outline-none focus:border-emerald-400 transition-colors"
                                                        autoFocus
                                                        onKeyDown={e => {
                                                            if (e.key === 'Enter' && tempFilter.expression.trim()) {
                                                                setGscFilters(prev => [...prev.filter(f => f.dimension !== filterDialog.dimension), { dimension: filterDialog.dimension, operator: tempFilter.operator, expression: tempFilter.expression }]);
                                                                setFilterDialog(null);
                                                                setCurrentPage(1);
                                                            }
                                                        }}
                                                    />
                                                </div>
                                                <div className="px-5 py-3 border-t border-slate-100 flex justify-end gap-2 bg-slate-50/50">
                                                    <button onClick={() => setFilterDialog(null)} className="px-4 py-1.5 text-[13px] font-bold text-emerald-600 hover:bg-emerald-50 rounded-lg transition-colors">Cancel</button>
                                                    <button 
                                                        onClick={() => {
                                                            if (tempFilter.expression.trim()) {
                                                                setGscFilters(prev => [...prev.filter(f => f.dimension !== filterDialog.dimension), { dimension: filterDialog.dimension, operator: tempFilter.operator, expression: tempFilter.expression }]);
                                                            }
                                                            setFilterDialog(null);
                                                            setCurrentPage(1);
                                                        }}
                                                        className="px-4 py-1.5 text-[13px] font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg transition-colors shadow-sm"
                                                    >
                                                        Apply
                                                    </button>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                </div>
                                
                                {/* Right: Date Controls */}
                                <div className="flex items-center gap-3">
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
                                                <div className="flex-1 p-6 flex flex-col">
                                                    <div className="flex p-1 bg-[#f1f5f9] rounded-xl mb-6">
                                                        {['Day', 'Week', 'Month'].map(tab => (
                                                            <button key={tab} onClick={() => setDateTab(tab)} className={`flex-1 py-2 text-[13px] font-bold rounded-lg transition-all ${dateTab === tab ? 'bg-white text-slate-800 shadow-sm' : 'text-[#64748b] hover:text-slate-800'}`}>{tab}</button>
                                                        ))}
                                                    </div>
                                                    
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
                        </div>

                        {/* ── Stats Row (Horizontal Toggles) ── */}
                        <div className="flex flex-wrap items-center gap-x-12 gap-y-6 mb-8 px-2">
                            {statsData.map((stat) => {
                                const style = metricStyles[stat.id];
                                const isActive = activeMetrics[stat.id];
                                return (
                                    <button
                                        key={stat.id}
                                        onClick={() => toggleMetric(stat.id)}
                                        className={`flex items-center gap-3 transition-all ${isActive ? 'opacity-100 scale-100' : 'opacity-40 hover:opacity-70 scale-95'}`}
                                    >
                                        <div className={`w-12 h-12 rounded-2xl flex items-center justify-center transition-colors ${isActive ? style.bg : 'bg-slate-100'} ${isActive ? style.text : 'text-slate-400'}`}>
                                            {style.icon}
                                        </div>
                                        <div className="flex flex-col items-start">
                                            <span className="text-2xl font-black text-slate-900 leading-none">{stat.value}</span>
                                            <div className="flex items-center gap-1.5 mt-1.5">
                                                <span className="text-[13px] font-bold text-slate-500">{stat.label.replace('Total ', '').replace('Avg. ', '')}</span>
                                                <div className="scale-90 origin-left">
                                                    <DeltaBadge delta={stat.delta} isPositiveGood={stat.isPositiveGood} isCTR={stat.isCTR} isPosition={stat.isPosition} />
                                                </div>
                                            </div>
                                        </div>
                                    </button>
                                );
                            })}
                        </div>

                        {/* ── Main Chart (Composed 4-Axis) ── */}
                        <div className="mb-10 bg-white border border-slate-100 rounded-3xl p-6 shadow-sm">
                            {isMounted && (
                                <ResponsiveContainer width="100%" height={320}>
                                    <ComposedChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                                        <defs>
                                            <linearGradient id="clicksFill" x1="0" y1="0" x2="0" y2="1">
                                                <stop offset="5%" stopColor="#0f766e" stopOpacity={0.15} />
                                                <stop offset="95%" stopColor="#0f766e" stopOpacity={0} />
                                            </linearGradient>
                                            <linearGradient id="impressionsFill" x1="0" y1="0" x2="0" y2="1">
                                                <stop offset="5%" stopColor="#34d399" stopOpacity={0.1} />
                                                <stop offset="95%" stopColor="#34d399" stopOpacity={0} />
                                            </linearGradient>
                                        </defs>

                                        <CartesianGrid vertical={false} stroke="#f1f5f9" strokeDasharray="4 4" />
                                        
                                        <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fill: '#94a3b8', fontSize: 11, fontWeight: 500 }} dy={10} />
                                        
                                        {/* Y-Axes */}
                                        <YAxis yAxisId="clicks" axisLine={false} tickLine={false} tick={{ fill: '#94a3b8', fontSize: 11 }} />
                                        <YAxis yAxisId="impressions" orientation="right" axisLine={false} tickLine={false} tick={{ fill: '#94a3b8', fontSize: 11 }} />
                                        <YAxis yAxisId="ctr" hide domain={['auto', 'auto']} />
                                        <YAxis yAxisId="position" hide reversed domain={['auto', 'auto']} />

                                        <Tooltip content={<CustomTooltip />} cursor={{ stroke: '#cbd5e1', strokeWidth: 1, strokeDasharray: '4 4' }} />

                                        {/* Chart Lines/Areas based on active toggles */}
                                        {activeMetrics.impressions && (
                                            <Area yAxisId="impressions" type="monotone" dataKey="impressions" name="Impressions" stroke="#34d399" strokeWidth={2} fill="url(#impressionsFill)" activeDot={{ r: 4, fill: '#34d399', stroke: '#fff', strokeWidth: 2 }} />
                                        )}
                                        {activeMetrics.clicks && (
                                            <Area yAxisId="clicks" type="monotone" dataKey="clicks" name="Clicks" stroke="#0f766e" strokeWidth={3} fill="url(#clicksFill)" activeDot={{ r: 5, fill: '#0f766e', stroke: '#fff', strokeWidth: 2 }} />
                                        )}
                                        {activeMetrics.ctr && (
                                            <Line yAxisId="ctr" type="monotone" dataKey="ctr" name="CTR" stroke="#64748b" strokeWidth={2} dot={false} activeDot={{ r: 4, fill: '#64748b', stroke: '#fff', strokeWidth: 2 }} />
                                        )}
                                        {activeMetrics.position && (
                                            <Line yAxisId="position" type="monotone" dataKey="position" name="Avg Position" stroke="#d97706" strokeWidth={2} dot={false} activeDot={{ r: 4, fill: '#d97706', stroke: '#fff', strokeWidth: 2 }} />
                                        )}
                                    </ComposedChart>
                                </ResponsiveContainer>
                            )}
                            
                            {/* Bottom Legend */}
                            <div className="flex items-center justify-center gap-6 mt-6">
                                {statsData.map(stat => activeMetrics[stat.id] && (
                                    <div key={`legend-${stat.id}`} className="flex items-center gap-1.5">
                                        <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: metricStyles[stat.id].fill }} />
                                        <span className="text-[12px] font-bold text-slate-500">{stat.label.replace('Total ', '').replace('Avg. ', '')}</span>
                                    </div>
                                ))}
                            </div>
                        </div>

                        {/* ── Dashboard Advanced Widgets (GSC Wizard style) ── */}
                        {computedWidgets && (
                            <div className="flex flex-col gap-4 mb-8">
                                {/* Row 1: Impressions by Position & Query Counting */}
                                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                                    {/* Impressions by Position */}
                                    <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
                                        <h3 className="text-[14px] font-bold text-slate-800 mb-4">Impressions by Position</h3>
                                        {/* Legend */}
                                        <div className="flex flex-wrap items-center gap-4 mb-4">
                                            {computedWidgets.posBuckets.map((b, i) => {
                                                const colors = ['#0f766e', '#115e59', '#34d399', '#a7f3d0'];
                                                return (
                                                    <div key={b.name} className="flex items-center gap-1.5">
                                                        <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: colors[i] }} />
                                                        <span className="text-[11px] font-bold text-slate-700">{b.name}</span>
                                                        <span className="text-[11px] text-slate-500">{b.count.toLocaleString()}</span>
                                                        <span className="text-[11px] text-slate-400">({b.percent}%)</span>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                        {/* Chart */}
                                        <div className="h-[200px]">
                                            <ResponsiveContainer width="100%" height="100%">
                                                <BarChart data={computedWidgets.posBuckets} margin={{ top: 10, right: 0, left: -20, bottom: 0 }}>
                                                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                                                    <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: '#94a3b8', fontSize: 11 }} />
                                                    <YAxis axisLine={false} tickLine={false} tick={{ fill: '#94a3b8', fontSize: 11 }} tickFormatter={val => val >= 1000 ? `${(val / 1000).toFixed(1)}k` : val} />
                                                    <Tooltip cursor={{ fill: '#f8fafc' }} contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }} />
                                                    <Bar dataKey="count" radius={[2, 2, 0, 0]}>
                                                        {computedWidgets.posBuckets.map((entry, index) => {
                                                            const colors = ['#0f766e', '#115e59', '#34d399', '#a7f3d0'];
                                                            return <Cell key={`cell-${index}`} fill={colors[index]} />;
                                                        })}
                                                    </Bar>
                                                </BarChart>
                                            </ResponsiveContainer>
                                        </div>
                                    </div>

                                    {/* Query Counting */}
                                    <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm flex flex-col">
                                        <div className="flex justify-between items-center mb-4">
                                            <h3 className="text-[14px] font-bold text-slate-800">Query Counting</h3>
                                            <div className="flex bg-slate-50 border border-slate-200 rounded-lg p-0.5">
                                                <button onClick={() => setQueryViewMode('Total')} className={`px-3 py-1 text-[11px] font-bold rounded-md transition-all ${queryViewMode === 'Total' ? 'bg-white text-slate-800 shadow-sm border border-slate-200' : 'text-slate-500 hover:text-slate-700'}`}>Total</button>
                                                <button onClick={() => setQueryViewMode('By Ranking')} className={`px-3 py-1 text-[11px] font-bold rounded-md transition-all ${queryViewMode === 'By Ranking' ? 'bg-white text-slate-800 shadow-sm border border-slate-200' : 'text-slate-500 hover:text-slate-700'}`}>By Ranking</button>
                                            </div>
                                        </div>
                                        {queryViewMode === 'By Ranking' ? (
                                            <>

                                                {/* Chart */}
                                                <div className="h-[200px] mt-auto">
                                                    <ResponsiveContainer width="100%" height="100%">
                                                        <AreaChart data={computedWidgets.stackedQueryData} margin={{ top: 10, right: 0, left: -20, bottom: 0 }}>
                                                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                                                            <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: '#94a3b8', fontSize: 11 }} minTickGap={30} />
                                                            <YAxis axisLine={false} tickLine={false} tick={{ fill: '#94a3b8', fontSize: 11 }} />
                                                            <Tooltip />
                                                            <Area type="monotone" dataKey="1-3" stackId="1" stroke="#0f766e" fill="#0f766e" fillOpacity={0.6} />
                                                            <Area type="monotone" dataKey="4-10" stackId="1" stroke="#115e59" fill="#115e59" fillOpacity={0.6} />
                                                            <Area type="monotone" dataKey="11-20" stackId="1" stroke="#34d399" fill="#34d399" fillOpacity={0.6} />
                                                            <Area type="monotone" dataKey="21+" stackId="1" stroke="#a7f3d0" fill="#a7f3d0" fillOpacity={0.6} />
                                                        </AreaChart>
                                                    </ResponsiveContainer>
                                                </div>
                                                {/* Bottom Legend */}
                                                <div className="flex items-center justify-center gap-6 mt-3">
                                                    {['Pos 1-3', 'Pos 4-10', 'Pos 11-20', 'Pos 21+'].map((l, i) => {
                                                         const colors = ['#0f766e', '#115e59', '#34d399', '#a7f3d0'];
                                                         return (
                                                            <div key={l} className="flex items-center gap-1.5">
                                                                <div className="w-2 h-2 rounded-full" style={{ backgroundColor: colors[i] }} />
                                                                <span className="text-[11px] font-bold text-slate-500">{l}</span>
                                                            </div>
                                                         );
                                                    })}
                                                </div>
                                            </>
                                        ) : (
                                            <>
                                                {/* Chart */}
                                                <div className="h-[200px] mt-10">
                                                    <ResponsiveContainer width="100%" height="100%">
                                                        <LineChart data={computedWidgets.stackedQueryData} margin={{ top: 10, right: 0, left: -20, bottom: 0 }}>
                                                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                                                            <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: '#94a3b8', fontSize: 11 }} minTickGap={30} />
                                                            <YAxis axisLine={false} tickLine={false} tick={{ fill: '#94a3b8', fontSize: 11 }} domain={[0, 'auto']} />
                                                            <Tooltip />
                                                            <Line type="monotone" dataKey="totalQueries" stroke="#115e59" strokeWidth={2} dot={false} activeDot={{ r: 4, fill: '#115e59', stroke: '#fff', strokeWidth: 2 }} />
                                                        </LineChart>
                                                    </ResponsiveContainer>
                                                </div>
                                                {/* Bottom Legend */}
                                                <div className="flex items-center justify-center gap-6 mt-3">
                                                    <div className="flex items-center gap-1.5">
                                                        <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: '#115e59' }} />
                                                        <span className="text-[12px] font-bold text-slate-500">Total Queries</span>
                                                    </div>
                                                </div>
                                            </>
                                        )}
                                    </div>
                                </div>

                                {/* Row 2: Devices Table & Pages Ranking */}
                                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                                    {/* Devices Table */}
                                    <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm flex flex-col">
                                        <div className="flex justify-between items-center mb-6">
                                            <div className="flex items-center gap-4">
                                                <h3 className="text-[14px] font-bold text-slate-800">Devices</h3>
                                                <div className="flex bg-slate-50 border border-slate-200 rounded-lg p-0.5">
                                                    {['All', 'Winning', 'Losing'].map(tab => (
                                                        <button 
                                                            key={tab} 
                                                            onClick={() => setDevicesTab(tab)}
                                                            className={`px-3 py-1 text-[11px] font-bold rounded-md transition-all ${devicesTab === tab ? 'bg-white text-slate-800 shadow-sm border border-slate-200' : 'text-slate-500 hover:text-slate-700'}`}
                                                        >
                                                            {tab}
                                                        </button>
                                                    ))}
                                                </div>
                                            </div>
                                            <button onClick={() => handleDownloadCSV(computedWidgets.devicesData, 'devices_data.csv')} title="Download CSV" className="text-slate-400 hover:text-slate-600"><ArrowDownTrayIcon className="w-4 h-4" /></button>
                                        </div>
                                        <div className="w-full">
                                            <table className="w-full text-left">
                                                <thead>
                                                    <tr className="border-b border-slate-100">
                                                        <th className="pb-2 text-[10px] font-bold text-slate-400 uppercase tracking-widest">Device</th>
                                                        <th className="pb-2 text-[10px] font-bold text-slate-400 uppercase tracking-widest text-right">Clicks ↑↓</th>
                                                        <th className="pb-2 text-[10px] font-bold text-slate-400 uppercase tracking-widest text-right">Impressions ↑↓</th>
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {computedWidgets.devicesData
                                                        .filter(row => devicesTab === 'All' ? true : devicesTab === 'Winning' ? row.cd > 0 : row.cd <= 0)
                                                        .map((row, i) => (
                                                        <tr key={i} className="border-b border-slate-50 last:border-0 hover:bg-slate-50">
                                                            <td className="py-3 text-[12px] font-bold text-slate-700">{row.name}</td>
                                                            <td className="py-3 text-[13px] font-bold text-slate-800 text-right">
                                                                <div className="flex items-center justify-end gap-2">
                                                                    <span>{row.clicks.toLocaleString()}</span>
                                                                    <span className={`text-[11px] ${row.cd > 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
                                                                        {row.cd > 0 ? '▲' : '▼'} {Math.abs(row.cd)}%
                                                                    </span>
                                                                </div>
                                                            </td>
                                                            <td className="py-3 text-[13px] font-bold text-slate-800 text-right">
                                                                <div className="flex items-center justify-end gap-2">
                                                                    <span>{row.imp.toLocaleString()}</span>
                                                                    <span className={`text-[11px] ${row.id > 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
                                                                        {row.id > 0 ? '▲' : '▼'} {Math.abs(row.id)}%
                                                                    </span>
                                                                </div>
                                                            </td>
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>
                                        </div>
                                    </div>

                                    {/* Pages Ranking */}
                                    <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm flex flex-col">
                                        <div className="flex justify-between items-center mb-4">
                                            <div className="flex items-center gap-2">
                                                <h3 className="text-[14px] font-bold text-slate-800">Pages Ranking</h3>
                                            </div>
                                            <div className="flex bg-slate-50 border border-slate-200 rounded-lg p-0.5">
                                                <button onClick={() => setPagesViewMode('Total')} className={`px-3 py-1 text-[11px] font-bold rounded-md transition-all ${pagesViewMode === 'Total' ? 'bg-white text-slate-800 shadow-sm border border-slate-200' : 'text-slate-500 hover:text-slate-700'}`}>Total</button>
                                                <button onClick={() => setPagesViewMode('By Ranking')} className={`px-3 py-1 text-[11px] font-bold rounded-md transition-all ${pagesViewMode === 'By Ranking' ? 'bg-white text-slate-800 shadow-sm border border-slate-200' : 'text-slate-500 hover:text-slate-700'}`}>By Ranking</button>
                                            </div>
                                        </div>
                                        {pagesViewMode === 'By Ranking' ? (
                                            <>
                                                {/* Summary counts */}
                                                <div className="flex flex-wrap items-center gap-4 mb-4">
                                                    {computedWidgets.pagesRankingSummary.map(b => (
                                                        <div key={b.name} className="flex items-center gap-1.5">
                                                            <div className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: b.fill }} />
                                                            <span className="text-[11px] font-bold text-slate-700">{b.name}</span>
                                                            <span className="text-[11px] text-slate-400">{b.count} pages</span>
                                                        </div>
                                                    ))}
                                                </div>
                                                {/* Bar chart — page counts per position bucket */}
                                                <div className="h-[240px] mt-auto">
                                                    <ResponsiveContainer width="100%" height="100%">
                                                        <BarChart data={computedWidgets.pagesRankingSummary} margin={{ top: 10, right: 0, left: -20, bottom: 0 }} barSize={40}>
                                                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                                                            <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: '#94a3b8', fontSize: 11 }} />
                                                            <YAxis axisLine={false} tickLine={false} tick={{ fill: '#94a3b8', fontSize: 11 }} allowDecimals={false} />
                                                            <Tooltip formatter={(v) => [`${v} pages`, 'Pages']} />
                                                            <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                                                                {computedWidgets.pagesRankingSummary.map((entry, i) => (
                                                                    <Cell key={i} fill={entry.fill} />
                                                                ))}
                                                            </Bar>
                                                        </BarChart>
                                                    </ResponsiveContainer>
                                                </div>
                                                <p className="text-[11px] text-slate-400 text-center mt-2">Number of pages ranked in each position bucket</p>
                                            </>
                                        ) : (
                                            <>
                                                {/* Chart */}
                                                <div className="h-[240px] mt-10">
                                                    <ResponsiveContainer width="100%" height="100%">
                                                        <LineChart data={computedWidgets.stackedQueryData} margin={{ top: 10, right: 0, left: -20, bottom: 0 }}>
                                                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                                                            <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: '#94a3b8', fontSize: 11 }} minTickGap={30} />
                                                            <YAxis axisLine={false} tickLine={false} tick={{ fill: '#94a3b8', fontSize: 11 }} domain={[0, 'dataMax']} allowDecimals={false} />
                                                            <Tooltip />
                                                            <Line type="monotone" dataKey="totalPages" stroke="#115e59" strokeWidth={2} dot={false} activeDot={{ r: 4, fill: '#115e59', stroke: '#fff', strokeWidth: 2 }} />
                                                        </LineChart>
                                                    </ResponsiveContainer>
                                                </div>
                                                {/* Bottom Legend */}
                                                <div className="flex items-center justify-center gap-6 mt-3">
                                                    <div className="flex items-center gap-1.5">
                                                        <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: '#115e59' }} />
                                                        <span className="text-[12px] font-bold text-slate-500">Total Pages</span>
                                                    </div>
                                                </div>
                                            </>
                                        )}
                                    </div>
                                </div>

                                {/* Row 4: Countries & New Rankings */}
                                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                                    {/* Countries Table */}
                                    <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm flex flex-col">
                                        <div className="flex justify-between items-center mb-6">
                                            <div className="flex items-center gap-4">
                                                <h3 className="text-[14px] font-bold text-slate-800">Countries</h3>
                                                <div className="flex bg-slate-50 border border-slate-200 rounded-lg p-0.5">
                                                    {['All', 'Winning', 'Losing'].map(tab => (
                                                        <button 
                                                            key={tab} 
                                                            onClick={() => setCountriesTab(tab)}
                                                            className={`px-3 py-1 text-[11px] font-bold rounded-md transition-all ${countriesTab === tab ? 'bg-white text-slate-800 shadow-sm border border-slate-200' : 'text-slate-500 hover:text-slate-700'}`}
                                                        >
                                                            {tab}
                                                        </button>
                                                    ))}
                                                </div>
                                            </div>
                                            <button onClick={() => handleDownloadCSV(computedWidgets.countriesData, 'countries_data.csv')} title="Download CSV" className="text-slate-400 hover:text-slate-600"><ArrowDownTrayIcon className="w-4 h-4" /></button>
                                        </div>
                                        <div className="w-full">
                                            <table className="w-full text-left">
                                                <thead>
                                                    <tr className="border-b border-slate-200">
                                                        <th className="pb-3 text-[10px] font-bold text-slate-400 uppercase tracking-widest">Country</th>
                                                        <th className="pb-3 text-[10px] font-bold text-slate-400 uppercase tracking-widest text-right">Clicks ↓</th>
                                                        <th className="pb-3 text-[10px] font-bold text-slate-400 uppercase tracking-widest text-right">Impressions ↑↓</th>
                                                        <th className="pb-3 text-[10px] font-bold text-slate-400 uppercase tracking-widest text-right">CTR ↑↓</th>
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {computedWidgets.countriesData
                                                        .filter(row => countriesTab === 'All' ? true : countriesTab === 'Winning' ? row.cd > 0 : row.cd <= 0)
                                                        .map((row, i) => (
                                                        <tr key={i} className="border-b border-slate-100 last:border-0 hover:bg-slate-50 transition-colors">
                                                            <td className="py-3.5 text-[12px] font-bold text-slate-700">{row.name}</td>
                                                            <td className="py-3.5 text-[13px] font-bold text-slate-800 text-right">
                                                                <div className="flex items-center justify-end gap-2">
                                                                    <span>{row.clicks.toLocaleString()}</span>
                                                                    <span className={`text-[11px] font-bold tracking-tight ${row.cd > 0 ? 'text-emerald-600' : 'text-rose-500'}`}>
                                                                        {row.cd > 0 ? '▲' : '▼'} {Math.abs(row.cd)}%
                                                                    </span>
                                                                </div>
                                                            </td>
                                                            <td className="py-3.5 text-[13px] font-bold text-slate-800 text-right">
                                                                <div className="flex items-center justify-end gap-2">
                                                                    <span>{row.imp.toLocaleString()}</span>
                                                                    <span className={`text-[11px] font-bold tracking-tight ${row.id > 0 ? 'text-emerald-600' : 'text-rose-500'}`}>
                                                                        {row.id > 0 ? '▲' : '▼'} {Math.abs(row.id)}%
                                                                    </span>
                                                                </div>
                                                            </td>
                                                            <td className="py-3.5 text-[13px] font-bold text-slate-800 text-right">
                                                                <div className="flex items-center justify-end gap-2">
                                                                    <span>{row.ctr}%</span>
                                                                    <span className={`text-[11px] font-bold tracking-tight ${row.cd > 0 ? 'text-emerald-600' : 'text-rose-500'}`}>
                                                                        {row.cd > 0 ? '▲' : '▼'} {Math.abs(row.cd)}%
                                                                    </span>
                                                                </div>
                                                            </td>
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>
                                        </div>
                                        <div className="mt-auto pt-4 flex items-center justify-start">
                                            <button
                                                onClick={() => navigate('/seo-analytics/countries')}
                                                className="text-[11px] font-bold text-emerald-700 hover:text-emerald-800 uppercase tracking-wide"
                                            >
                                                Show All ({countriesTotal} Total)
                                            </button>
                                        </div>
                                    </div>

                                    {/* New Rankings Table */}
                                    <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm flex flex-col">
                                        <div className="flex justify-between items-center mb-6">
                                            <h3 className="text-[14px] font-bold text-slate-800">New Rankings</h3>
                                            <div className="flex bg-slate-50 border border-slate-200 rounded-lg p-0.5">
                                                {['Queries', 'Pages'].map(tab => (
                                                    <button 
                                                        key={tab} 
                                                        onClick={() => setNewRankingsTab(tab)}
                                                        className={`px-3 py-1 text-[11px] font-bold rounded-md transition-all ${newRankingsTab === tab ? 'bg-white text-slate-800 shadow-sm border border-slate-200' : 'text-slate-500 hover:text-slate-700'}`}
                                                    >
                                                        {tab}
                                                    </button>
                                                ))}
                                            </div>
                                        </div>
                                        <div className="w-full">
                                            <table className="w-full text-left">
                                                <thead>
                                                    <tr className="border-b border-slate-200">
                                                        <th className="pb-3 text-[10px] font-bold text-slate-400 uppercase tracking-widest w-[50%]">{newRankingsTab === 'Queries' ? 'Query' : 'Page'}</th>
                                                        <th className="pb-3 text-[10px] font-bold text-slate-400 uppercase tracking-widest text-right">Clicks</th>
                                                        <th className="pb-3 text-[10px] font-bold text-slate-400 uppercase tracking-widest text-right">Impressions</th>
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {(newRankingsTab === 'Queries' ? computedWidgets.newRankingsQueries : computedWidgets.newRankingsPages).map((row, i) => (
                                                        <tr key={i} className="border-b border-slate-100 last:border-0 hover:bg-slate-50 transition-colors">
                                                            <td className="py-3.5 text-[12px] font-bold text-slate-700 truncate pr-4 max-w-[160px]">{row.name}</td>
                                                            <td className="py-3.5 text-[13px] font-bold text-slate-800 text-right">
                                                                <div className="flex items-center justify-end gap-2">
                                                                    <span>{row.clicks.toLocaleString()}</span>
                                                                </div>
                                                            </td>
                                                            <td className="py-3.5 text-[13px] font-bold text-slate-800 text-right">
                                                                <div className="flex items-center justify-end gap-2">
                                                                    <span>{row.imp.toLocaleString()}</span>
                                                                </div>
                                                            </td>
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>
                                        </div>
                                        <div className="mt-auto pt-4 flex items-center justify-center">
                                            <button
                                                onClick={() => navigate('/seo-analytics/new-lost-rankings')}
                                                className="text-[12px] font-bold text-emerald-700 hover:text-emerald-800 flex items-center gap-1.5"
                                            >
                                                Show All <span className="text-[14px]">→</span>
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* ── Data Table Section ── */}
                         <div className="bg-white" ref={countriesSectionRef}>
                            
                            {/* Top Tabs & Download */}
                            <div className="flex flex-wrap items-center gap-2 sm:gap-4 mb-4 sm:mb-6">
                                <div className="flex gap-1.5 sm:gap-2">
                                    {['Pages', 'Queries', 'Clusters'].map(tab => (
                                        <button 
                                            key={tab}
                                            onClick={() => { setActiveTab(tab); setCurrentPage(1); }}
                                            className={`px-3 sm:px-4 py-1.5 text-xs font-bold rounded-md transition-colors ${
                                                activeTab === tab 
                                                    ? 'bg-white text-slate-800 border-slate-300 border shadow-sm' 
                                                    : 'bg-slate-50 border border-transparent text-slate-800 hover:bg-slate-100'
                                            }`}
                                        >
                                            {tab}
                                        </button>
                                    ))}
                                </div>
                                <button 
                                    onClick={handleDownloadReport}
                                    className="text-xs text-slate-800 border border-slate-300 rounded-md px-3 sm:px-4 py-1.5 hover:bg-slate-50 transition-all bg-white font-bold shadow-sm whitespace-nowrap"
                                >
                                    <span className="hidden sm:inline">Download Report</span>
                                    <span className="sm:hidden">Download</span>
                                </button>
                            </div>

                            {/* Secondary Filters & Pagination Row */}
                            <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-2 sm:gap-0 mb-4">
                                <div className="flex items-center gap-2 sm:gap-4">
                                    {activeTab !== 'Countries' && <div className="relative">
                                        <select 
                                            value={statusFilter}
                                            onChange={(e) => {
                                                setStatusFilter(e.target.value);
                                                setCurrentPage(1);
                                            }}
                                            className="appearance-none bg-white border border-slate-200 text-slate-700 text-[12px] sm:text-[13px] font-bold rounded-md px-2.5 sm:px-3 py-1.5 pr-7 sm:pr-8 focus:outline-none focus:border-emerald-400 cursor-pointer shadow-sm hover:border-slate-300 transition-colors"
                                        >
                                            <option value="All">All {activeTab}</option>
                                            <option value="Top result">Top Results</option>
                                            <option value="Quick Win">Quick Wins</option>
                                            <option value="Opportunity">Opportunities</option>
                                            <option value="Ranked">Ranked Only</option>
                                            <option value="Decay">Decaying</option>
                                            <option value="Unranked">Unranked</option>
                                        </select>
                                        <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-slate-400">
                                            <ChevronDownIcon className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                                        </div>
                                        </div>
                                    }

                                    {activeTab !== 'Countries' && (
                                        <span className="text-[12px] sm:text-[13px] text-slate-500">
                                            {filteredPages.length.toLocaleString()} {activeTab === 'Pages' ? 'pages' : activeTab === 'Clusters' ? 'clusters' : 'queries'}
                                        </span>
                                    )}
                                    {activeTab === 'Countries' && (
                                        <span className="text-[12px] sm:text-[13px] text-slate-500">
                                            {realCountries.length.toLocaleString()} countries
                                        </span>
                                    )}
                                </div>

                                {/* Pagination Controls */}
                                {filteredPages.length > 0 && (
                                    <div className="flex items-center gap-1.5 sm:gap-2 text-[12px] sm:text-[13px]">
                                        <button 
                                            onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                                            disabled={currentPage === 1}
                                            className="px-2.5 sm:px-3 py-1 border border-slate-200 rounded text-slate-700 font-bold hover:bg-slate-50 disabled:opacity-40"
                                        >
                                            <span className="hidden sm:inline">Previous</span>
                                            <span className="sm:hidden">Prev</span>
                                        </button>
                                        <span className="text-slate-500 px-1 sm:px-2 font-bold">{currentPage} / {totalPagesCount}</span>
                                        <button 
                                            onClick={() => setCurrentPage(prev => Math.min(totalPagesCount, prev + 1))}
                                            disabled={currentPage >= totalPagesCount}
                                            className="px-2.5 sm:px-3 py-1 border border-slate-200 rounded text-slate-700 font-bold hover:bg-slate-50 disabled:opacity-40"
                                        >
                                            Next
                                        </button>
                                    </div>
                                )}
                            </div>

                            {/* Countries Table (shown when activeTab === 'Countries') */}
                            {activeTab === 'Countries' ? (
                                <div className="-mx-3 sm:mx-0">
                                    <div className="overflow-x-auto border-t border-slate-200 pt-2" style={{ WebkitOverflowScrolling: 'touch' }}>
                                        <table className="text-left text-sm whitespace-nowrap min-w-[700px] w-full">
                                            <thead className="text-slate-500 text-[12px] font-bold uppercase tracking-wider bg-white border-b border-slate-100">
                                                <tr>
                                                    <th className="py-4 px-4 text-slate-700">Country</th>
                                                    <th className="py-4 px-4 text-slate-700"><div className="flex items-center gap-1">Clicks <ChevronDownIcon className="w-4 h-4 text-slate-300" /></div></th>
                                                    <th className="py-4 px-4 text-slate-700"><div className="flex items-center gap-1">Impressions <ChevronDownIcon className="w-4 h-4 text-slate-300" /></div></th>
                                                    <th className="py-4 px-4 text-slate-700"><div className="flex items-center gap-1">CTR <ChevronDownIcon className="w-4 h-4 text-slate-300" /></div></th>
                                                    <th className="py-4 px-4 text-slate-700"><div className="flex items-center gap-1">Position <ChevronDownIcon className="w-4 h-4 text-slate-300" /></div></th>
                                                    <th className="py-4 px-4 text-slate-700">Clicks Δ</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-slate-100 bg-white">
                                                {realCountries.length === 0 ? (
                                                    <tr><td colSpan={6} className="py-12 text-center text-slate-500 font-medium">No country data available.</td></tr>
                                                ) : realCountries.map((row, idx) => (
                                                    <motion.tr
                                                        key={row.name}
                                                        initial={{ opacity: 0, y: 5 }}
                                                        animate={{ opacity: 1, y: 0 }}
                                                        transition={{ duration: 0.15, delay: (idx % 25) * 0.02 }}
                                                        className="hover:bg-slate-50/70 transition-colors border-b border-slate-50"
                                                    >
                                                        <td className="py-4 px-4 text-slate-800 font-bold text-[13px] uppercase">{row.name}</td>
                                                        <td className="py-4 px-4 text-slate-800 font-medium text-[13px]">{row.clicks.toLocaleString()}</td>
                                                        <td className="py-4 px-4 text-slate-700 text-[13px]">{row.impressions.toLocaleString()}</td>
                                                        <td className="py-4 px-4 text-slate-700 text-[13px]">{row.ctr.toFixed(2)}%</td>
                                                        <td className="py-4 px-4 text-slate-700 text-[13px]">{row.position.toFixed(1)}</td>
                                                        <td className="py-4 px-4">
                                                            {row.clicks_delta != null ? (
                                                                <span className={`text-[11px] font-bold ${ row.clicks_delta >= 0 ? 'text-emerald-600' : 'text-rose-500'}`}>
                                                                    {row.clicks_delta >= 0 ? '▲' : '▼'} {Math.abs(row.clicks_delta)}%
                                                                </span>
                                                            ) : <span className="text-slate-400 text-[11px]">—</span>}
                                                        </td>
                                                    </motion.tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                </div>
                            ) : (
                                <div className="-mx-3 sm:mx-0">
                                <div className="overflow-x-auto border-t border-slate-200 pt-2" style={{ WebkitOverflowScrolling: 'touch' }}>
                                    <table className={`text-left text-sm whitespace-nowrap ${activeTab === 'Clusters' ? 'min-w-[860px]' : 'min-w-[700px]'} w-full`}>
                                    <thead className="text-slate-500 text-[12px] font-bold uppercase tracking-wider bg-white border-b border-slate-100">
                                        <tr>
                                            <th className="py-4 px-4 text-slate-700">
                                                {activeTab === 'Pages' ? 'Page URL' : activeTab === 'Clusters' ? 'Cluster Label' : 'Query'}
                                            </th>
                                            {activeTab === 'Clusters' && (
                                                <th className="py-4 px-4 text-slate-700">Top Queries</th>
                                            )}
                                            <th className="py-4 px-4 text-slate-700">
                                                <div className="flex items-center gap-1 cursor-pointer">
                                                    Clicks <ChevronDownIcon className="w-4 h-4 text-slate-300" />
                                                </div>
                                            </th>
                                            <th className="py-4 px-4 text-slate-700">
                                                <div className="flex items-center gap-1 cursor-pointer">
                                                    Impressions <ChevronDownIcon className="w-4 h-4 text-slate-300" />
                                                </div>
                                            </th>
                                            <th className="py-4 px-4 text-slate-700">
                                                <div className="flex items-center gap-1 cursor-pointer">
                                                    CTR <ChevronDownIcon className="w-4 h-4 text-slate-300" />
                                                </div>
                                            </th>
                                            <th className="py-4 px-4 text-slate-700">
                                                <div className="flex items-center gap-1 cursor-pointer">
                                                    Position <ChevronDownIcon className="w-4 h-4 text-slate-300" />
                                                </div>
                                            </th>
                                            <th className="py-4 px-4 text-slate-700">
                                                <div className="flex items-center gap-1 cursor-pointer whitespace-nowrap">
                                                    Clicks Growth <ChevronDownIcon className="w-4 h-4 text-slate-300" />
                                                </div>
                                            </th>
                                            <th className="py-4 px-4 text-slate-700">Status</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100 bg-white">
                                        {paginatedPages.length > 0 ? paginatedPages.map((row, idx) => {
                                            const totalCtr = row.total_impressions > 0 ? ((row.total_clicks / row.total_impressions) * 100).toFixed(2) : '0.00';
                                            const status = getStatus(row.avg_position);
                                            const { color: dotColor, label: statusLabel } = getStatusInfo(status);
                                            
                                            let statusColor = 'bg-slate-100 text-slate-600 border-slate-200';
                                            if (status === 'Top result') statusColor = 'bg-emerald-100 text-emerald-600';
                                            else if (status === 'Quick Win') statusColor = 'bg-cyan-100 text-cyan-600';
                                            else if (status === 'Opportunity') statusColor = 'bg-amber-100 text-amber-600';
                                            else if (status === 'Decay') statusColor = 'bg-rose-100 text-rose-600';
                                            else if (status === 'Unranked') statusColor = 'bg-indigo-100 text-indigo-600';

                                            // Real data growth not natively provided per page in current GSC model without extra querying
                                            // Leaving as '-' for consistent clean UI, user requested real data, so removing mock 2x
                                            const growth = '-';

                                            return (
                                                <motion.tr 
                                                    key={row.url || row.label || idx}
                                                    initial={{ opacity: 0, y: 5 }}
                                                    animate={{ opacity: 1, y: 0 }}
                                                    transition={{ duration: 0.15, delay: (idx % itemsPerPage) * 0.03 }}
                                                    className="hover:bg-slate-50/70 transition-colors group border-b border-slate-50"
                                                >
                                                    <td className="py-4 px-4 text-slate-600 font-medium text-[13px]">
                                                        <div className="flex items-start gap-3">
                                                            {activeTab === 'Pages' ? (
                                                                <Favicon url={row.url} size={16} className="mt-0.5 rounded-sm flex-shrink-0" />
                                                            ) : activeTab === 'Queries' ? (
                                                                <MagnifyingGlassIcon className="w-4 h-4 text-slate-300 mt-0.5 flex-shrink-0" />
                                                            ) : (
                                                                <ArrowTopRightOnSquareIcon className="w-4 h-4 text-slate-300 mt-0.5 flex-shrink-0" />
                                                            )}
                                                            {activeTab === 'Pages' ? (
                                                                <a href={row.url} target="_blank" rel="noopener noreferrer" className="hover:text-emerald-600 transition-colors leading-relaxed break-all">
                                                                    {(row.url || '').replace(/^https?:\/\/(www\.)?/, '')}
                                                                </a>
                                                            ) : (
                                                                <span className="font-bold text-slate-800 capitalize leading-relaxed">
                                                                    {row.label || row.url}
                                                                </span>
                                                            )}
                                                        </div>
                                                    </td>

                                                    {activeTab === 'Clusters' && (
                                                        <td className="py-4 px-4">
                                                            <div className="flex flex-col gap-1">
                                                                {row.top_queries?.map((q, i) => (
                                                                    <span key={i} className="text-slate-500 text-[13px]">{q}</span>
                                                                ))}
                                                            </div>
                                                        </td>
                                                    )}

                                                    <td className="py-4 px-4 text-slate-800 font-medium text-[13px]">{row.total_clicks?.toLocaleString() || 0}</td>
                                                    <td className="py-4 px-4 text-slate-700 text-[13px]">{row.total_impressions?.toLocaleString() || 0}</td>
                                                    <td className="py-4 px-4 text-slate-700 text-[13px]">{totalCtr}%</td>
                                                    <td className="py-4 px-4 text-slate-700 text-[13px]">{row.avg_position?.toFixed(2) || '0.00'}</td>
                                                    <td className="py-4 px-4 text-slate-500 text-[13px] font-medium">{growth}</td>
                                                    <td className="py-4 px-4">
                                                        <span className={`px-2 py-0.5 text-[11px] font-bold rounded-full border border-transparent ${statusColor}`}>
                                                            {statusLabel}
                                                        </span>
                                                    </td>
                                                </motion.tr>
                                            );
                                        }) : (
                                            <tr>
                                                <td colSpan={activeTab === 'Clusters' ? 8 : 7} className="py-12 text-center text-slate-500 font-medium">
                                                    No results match the current filter criteria.
                                                </td>
                                            </tr>
                                        )}
                                    </tbody>
                                    </table>
                                </div>
                            </div>
                            )}
                        </div>
                    </motion.div>
                </AnimatePresence>
            )}
        </div>
    );
};

export default SEOAnalytics;

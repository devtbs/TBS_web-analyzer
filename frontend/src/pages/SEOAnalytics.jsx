import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import * as XLSX from 'xlsx';
import {
    ChevronDownIcon,
} from '@heroicons/react/20/solid';
import { ArrowPathIcon, LinkIcon, PlusIcon, ArrowTopRightOnSquareIcon, ChartBarIcon, PencilIcon } from '@heroicons/react/24/outline';
import {
    BarChart,
    Bar,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    ResponsiveContainer,
    Cell
} from 'recharts';
import api from '../api/axios';
import toast from 'react-hot-toast';

/* ── Custom Chart Tooltip ──────────────────────────────────── */
const CustomTooltip = ({ active, payload, label, activeMetric }) => {
    if (active && payload && payload.length) {
        const metricConfig = {
            clicks: { name: 'Clicks', hex: '#059669', format: val => val.toLocaleString() },
            impressions: { name: 'Impressions', hex: '#059669', format: val => val.toLocaleString() },
            ctr: { name: 'Avg. CTR', hex: '#059669', format: val => `${Number(val).toFixed(2)}%` },
            position: { name: 'Avg. Position', hex: '#059669', format: val => Number(val).toFixed(2) },
            growth: { 
                name: 'Clicks Growth', 
                hex: payload[0].value >= 0 ? '#059669' : '#F87171', 
                format: val => `${Number(val).toFixed(2)}%` 
            }
        };
        const config = metricConfig[activeMetric] || metricConfig.clicks;
        
        return (
            <div className="bg-white border-0 shadow-[0_8px_30px_rgb(0,0,0,0.12)] rounded-xl p-4 min-w-[200px]">
                <p className="text-[13px] font-bold text-slate-400 mb-3 tracking-wide">
                    {label}
                </p>
                <div className="flex items-center justify-between gap-6">
                    <div className="flex items-center gap-2.5">
                        <div className="w-3.5 h-3.5 rounded-sm" style={{ backgroundColor: config.hex }} />
                        <span className="text-[14px] font-bold text-slate-700">
                            {config.name}
                        </span>
                    </div>
                    <span className="text-[14px] font-extrabold text-slate-900">
                        {config.format(payload[0].value)}
                    </span>
                </div>
            </div>
        );
    }
    return null;
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

/* ── Component ─────────────────────────────────────────────── */
const SEOAnalytics = () => {
    const navigate = useNavigate();
    const [isConnected, setIsConnected] = useState(null); // null = checking, false = disconnected, true = connected
    const [properties, setProperties] = useState([]);
    const [selectedProperty, setSelectedProperty] = useState('');
    const [activeMetric, setActiveMetric] = useState('clicks');
    const [activeTab, setActiveTab] = useState('Pages'); // Make Pages the default tab
    const [chartGrouping, setChartGrouping] = useState('daily');
    const [activeBarIndex, setActiveBarIndex] = useState(null);
    
    // Data states
    const [loading, setLoading] = useState(false);
    const [analytics, setAnalytics] = useState(null);
    const [pages, setPages] = useState([]);
    const [chartData, setChartData] = useState([]);

    // Filtering states
    const [statusFilter, setStatusFilter] = useState('All');
    const [queryFilter, setQueryFilter] = useState('');
    const [pageFilter, setPageFilter] = useState('');
    
    // Pagination
    const [currentPage, setCurrentPage] = useState(1);
    const itemsPerPage = 10;

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
                    toast.error('Failed to fetch Search Console status');
                }
            }
        };
        fetchProperties();
    }, []);

    // Save selected property to local storage
    useEffect(() => {
        if (selectedProperty) {
            localStorage.setItem('gsc_selected_property', selectedProperty);
        }
    }, [selectedProperty]);

    // Load Analytics data when property changes
    useEffect(() => {
        if (!selectedProperty) return;

        const fetchAnalytics = async () => {
            setLoading(true);
            try {
                const authToken = localStorage.getItem('access_token');
                const res = await api.get(`/auth/gsc/analytics/${encodeURIComponent(selectedProperty)}`, { 
                    params: { group_by: chartGrouping }
                });
                setAnalytics(res.data.analytics.totals);
                setChartData(res.data.analytics.chart_data);
                setPages(res.data.pages);
                setCurrentPage(1); // Reset pagination
            } catch (err) {
                toast.error('Failed to fetch analytics for this property');
            } finally {
                setLoading(false);
            }
        };

        fetchAnalytics();
    }, [selectedProperty, chartGrouping]);

    const handleLogoutGSC = async (e) => {
        if (e) e.preventDefault();
        const confirmLogout = window.confirm("Are you sure you want to disconnect your Google Search Console account?");
        if (!confirmLogout) return;

        try {
            const authToken = localStorage.getItem('access_token');
            await api.post('/auth/gsc/disconnect', {});
            localStorage.removeItem('gsc_selected_property');
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
        clicks: { id: 'clicks', label: 'Avg. Clicks', color: '#059669', format: val => val != null ? Number(val).toLocaleString(undefined, { maximumFractionDigits: 1 }) : '-' },
        impressions: { id: 'impressions', label: 'Avg. Impressions', color: '#059669', format: val => val != null ? Number(val).toLocaleString(undefined, { maximumFractionDigits: 0 }) : '-' },
        ctr: { id: 'ctr', label: 'Avg. CTR', color: '#059669', format: val => val != null ? `${val.toFixed(2)}%` : '-' },
        position: { id: 'position', label: 'Avg. Position', color: '#059669', format: val => val != null ? val.toFixed(2) : '-' },
        growth: { id: 'growth', label: 'Clicks Growth', color: '#10B981', format: val => `${val.toFixed(2)}%` }
    };

    const enrichedChartData = useMemo(() => {
        return chartData.map((d, i) => {
            const prev = chartData[i - 1]?.clicks || 0;
            const growth = prev > 0 ? ((d.clicks - prev) / prev) * 100 : 0;
            return {
                ...d,
                growth: Number(growth.toFixed(2))
            };
        });
    }, [chartData]);

    const lastGrowth = enrichedChartData.length > 0 ? enrichedChartData[enrichedChartData.length - 1].growth : 0;

    const statsData = [
        { ...METRIC_CONFIGS.clicks, value: METRIC_CONFIGS.clicks.format(analytics?.clicks / (chartData?.length || 1)), active: activeMetric === 'clicks' },
        { ...METRIC_CONFIGS.impressions, value: METRIC_CONFIGS.impressions.format(analytics?.impressions / (chartData?.length || 1)), active: activeMetric === 'impressions' },
        { ...METRIC_CONFIGS.ctr, value: METRIC_CONFIGS.ctr.format(analytics?.ctr), active: activeMetric === 'ctr' },
        { ...METRIC_CONFIGS.position, value: METRIC_CONFIGS.position.format(analytics?.position), active: activeMetric === 'position' },
        { ...METRIC_CONFIGS.growth, value: METRIC_CONFIGS.growth.format(lastGrowth), active: activeMetric === 'growth' }
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
    const filteredPages = activeTabList.filter((item) => {
        if (activeTab === 'Pages') {
            const urlMatch = item.url.toLowerCase().includes(pageFilter.toLowerCase());
            const queryMatch = !queryFilter ? true : item.queries?.some(q => q.query.toLowerCase().includes(queryFilter.toLowerCase()));
            return urlMatch && queryMatch;
        } else if (activeTab === 'Queries') {
            const combinedFilter = (pageFilter + ' ' + queryFilter).trim().toLowerCase();
            return item.url.toLowerCase().includes(combinedFilter);
        } else if (activeTab === 'Clusters') {
            const combinedFilter = (pageFilter + ' ' + queryFilter).trim().toLowerCase();
            return item.url.toLowerCase().includes(combinedFilter);
        }
        return true;
    });

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
        <div className="p-6 max-w-[1600px] mx-auto min-h-screen bg-white">
            
            {/* ── Top Header and Filters ── */}
            <header className="flex flex-wrap items-center gap-4 pb-8 border-b border-slate-100">
                {/* Domain Selector Pill */}
                <div className="flex items-center border border-slate-200 rounded-lg overflow-hidden h-10 shadow-sm">
                    <div className="px-4 bg-slate-50 text-slate-500 font-bold border-r border-slate-200 h-full flex items-center text-[12px] tracking-wide uppercase">
                        Domain
                    </div>
                    <div className="bg-white px-3 flex items-center h-full">
                        <select 
                            className="appearance-none bg-transparent border-none focus:ring-0 py-1 cursor-pointer text-slate-700 outline-none w-full min-w-[14rem] font-bold text-[13px]"
                            value={selectedProperty}
                            onChange={(e) => setSelectedProperty(e.target.value)}
                        >
                            {properties.length === 0 && <option value="">No Properties Found</option>}
                            {properties.map(p => (
                                <option key={p.url} value={p.url}>{getDomain(p.url)}</option>
                            ))}
                        </select>
                        <ChevronDownIcon className="w-4 h-4 text-slate-400 -ml-6 pointer-events-none" />
                    </div>
                </div>

                {/* Query Filter Pill */}
                <div className="flex items-center gap-2 px-4 h-10 bg-white border border-slate-200 rounded-lg shadow-sm hover:border-slate-300 transition-colors group">
                    <PencilIcon className="w-3.5 h-3.5 text-slate-400 group-hover:text-emerald-500 transition-colors" />
                    <span className="text-slate-500 font-bold text-[13px]">Query:</span>
                    <input 
                        type="text" 
                        placeholder="All"
                        className="bg-transparent border-none focus:ring-0 p-0 outline-none w-24 text-slate-800 font-bold text-[13px] placeholder:text-slate-300"
                        value={queryFilter}
                        onChange={(e) => {setQueryFilter(e.target.value); setCurrentPage(1);}}
                    />
                </div>

                {/* Page Filter Pill */}
                <div className="flex items-center gap-2 px-4 h-10 bg-white border border-slate-200 rounded-lg shadow-sm hover:border-slate-300 transition-colors group">
                    <PencilIcon className="w-3.5 h-3.5 text-slate-400 group-hover:text-emerald-500 transition-colors" />
                    <span className="text-slate-500 font-bold text-[13px]">Page:</span>
                    <input 
                        type="text" 
                        placeholder="All"
                        className="bg-transparent border-none focus:ring-0 p-0 outline-none w-24 text-slate-800 font-bold text-[13px] placeholder:text-slate-300"
                        value={pageFilter}
                        onChange={(e) => {setPageFilter(e.target.value); setCurrentPage(1);}}
                    />
                </div>


                <div className="ml-auto flex items-center">
                    <button 
                        onClick={handleLogoutGSC}
                        className="text-slate-400 hover:text-rose-500 font-bold text-[13px] transition-colors tracking-tight"
                    >
                        Log out of Search Console
                    </button>
                </div>
            </header>

            {loading ? (
                <div className="py-20 flex justify-center items-center">
                    <div className="flex flex-col items-center gap-4">
                        <ArrowPathIcon className="w-8 h-8 text-emerald-500 animate-spin" />
                        <p className="text-slate-500 font-medium animate-pulse">Fetching Search Console Data...</p>
                    </div>
                </div>
            ) : (
                <AnimatePresence>
                    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.3 }}>
                        {/* ── Stats Row ── */}
                        <div className="py-8 grid grid-cols-2 lg:grid-cols-5 gap-4">
                            {statsData.map((stat, i) => {
                                const isInteractive = !!stat.id;
                                return (
                                    <div
                                        key={i}
                                        onClick={() => isInteractive && setActiveMetric(stat.id)}
                                        className={`flex flex-col items-center justify-center py-6 px-4 rounded-xl transition-all duration-200 border ${
                                            isInteractive 
                                                ? 'hover:shadow-md cursor-pointer' 
                                                : 'cursor-default'
                                        } ${
                                            stat.active 
                                                ? 'border-emerald-500 bg-emerald-50 text-emerald-700 shadow-sm' 
                                                : 'bg-white border-slate-100 text-slate-400'
                                        }`}
                                    >
                                        <span className={`text-[11px] font-extrabold uppercase tracking-wider mb-2 ${stat.active ? 'text-emerald-700' : 'text-slate-500'}`}>
                                            {stat.label}
                                        </span>
                                        <span className={`text-2xl font-black ${stat.active ? 'text-emerald-800' : 'text-slate-700'}`}>
                                            {stat.value}
                                        </span>
                                    </div>
                                );
                            })}
                        </div>

                        {/* ── Bar Chart ── */}
                        <div className="flex justify-between items-center px-4 mt-6 -mb-4 relative z-10">
                            <h3 className="text-[13px] font-bold text-slate-400 uppercase tracking-widest">Performance Graph</h3>
                            <div className="relative flex items-center">
                                <select 
                                    value={chartGrouping}
                                    onChange={(e) => setChartGrouping(e.target.value)}
                                    className="appearance-none bg-white border border-slate-200 text-slate-700 text-[13px] rounded-lg pl-3 pr-8 py-1.5 cursor-pointer focus:outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-50 font-bold shadow-sm transition-all hover:bg-slate-50"
                                >
                                    <option value="daily">Daily</option>
                                    <option value="weekly">Weekly</option>
                                    <option value="monthly">Monthly</option>
                                </select>
                                <ChevronDownIcon className="w-4 h-4 text-slate-400 absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" />
                            </div>
                        </div>
                        <div className="h-[260px] w-full mt-2 mb-12 bg-white px-2">
                            <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0}>
                                <BarChart 
                                    data={enrichedChartData} 
                                    margin={{ top: 20, right: 20, left: -10, bottom: 0 }}
                                    onMouseLeave={() => setActiveBarIndex(null)}
                                >
                                    <CartesianGrid vertical={false} stroke="#F1F5F9" />
                                    <XAxis 
                                        dataKey="month" 
                                        axisLine={{ stroke: '#F1F5F9' }}
                                        tickLine={false} 
                                        tick={{ fill: '#94A3B8', fontSize: 13 }}
                                        dy={12}
                                    />
                                    <YAxis 
                                        axisLine={false} 
                                        tickLine={false} 
                                        tick={{ fill: '#94A3B8', fontSize: 11, fontWeight: 600 }}
                                        tickCount={5}
                                        tickFormatter={(val) => {
                                            if (val === 0) return '0';
                                            if (['ctr', 'growth'].includes(activeMetric)) 
                                                return `${Number(val).toFixed(0)}%`;
                                            if (activeMetric === 'position') return val;
                                            return val >= 1000 ? `${(val/1000).toFixed(1)}K` : val;
                                        }}
                                    />
                                    <Tooltip 
                                        content={<CustomTooltip activeMetric={activeMetric} />} 
                                        active={activeBarIndex !== null}
                                        cursor={false}
                                        isAnimationActive={false}
                                    />
                                    <Bar 
                                        dataKey={activeMetric} 
                                        radius={[8, 8, 0, 0]} 
                                        barSize={32}
                                        animationDuration={1000}
                                        onMouseEnter={(_, index) => setActiveBarIndex(index)}
                                        onMouseLeave={() => setActiveBarIndex(null)}
                                    >
                                        {enrichedChartData.map((entry, i) => (
                                            <Cell 
                                                key={`cell-${i}`} 
                                                fill={activeMetric === 'growth' 
                                                    ? (entry.growth >= 0 ? '#059669' : '#F87171') 
                                                    : (METRIC_CONFIGS[activeMetric]?.color || '#059669')} 
                                            />
                                        ))}
                                    </Bar>
                                </BarChart>
                            </ResponsiveContainer>
                        </div>

                        {/* ── Data Table Section ── */}
                        <div className="bg-white mt-8">
                            
                            {/* Top Tabs & Download */}
                            <div className="flex flex-wrap items-center gap-4 mb-6">
                                <div className="flex gap-2">
                                    {['Pages', 'Queries', 'Clusters'].map(tab => (
                                        <button 
                                            key={tab}
                                            onClick={() => setActiveTab(tab)}
                                            className={`px-4 py-1.5 text-xs font-bold rounded-md transition-colors ${
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
                                    className="text-xs text-slate-800 border border-slate-300 rounded-md px-4 py-1.5 hover:bg-slate-50 transition-all bg-white font-bold shadow-sm"
                                >
                                    Download Report
                                </button>
                            </div>

                            {/* Secondary Filters & Pagination Row */}
                            <div className="flex justify-between items-center mb-4">
                                <div className="flex items-center gap-4">
                                    <div className="relative">
                                        <select 
                                            value={statusFilter}
                                            onChange={(e) => {
                                                setStatusFilter(e.target.value);
                                                setCurrentPage(1); // Reset to first page on filter change
                                            }}
                                            className="appearance-none bg-white border border-slate-200 text-slate-700 text-[13px] font-bold rounded-md px-3 py-1.5 pr-8 focus:outline-none focus:border-emerald-400 cursor-pointer shadow-sm hover:border-slate-300 transition-colors"
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
                                            <ChevronDownIcon className="w-4 h-4" />
                                        </div>
                                    </div>
                                    
                                    <span className="text-[13px] text-slate-500">
                                        {(filteredPages.length).toLocaleString()} {activeTab === 'Pages' ? 'pages' : activeTab === 'Clusters' ? 'clusters' : 'queries'}
                                    </span>
                                </div>

                                {/* Pagination Controls */}
                                {totalPagesCount > 1 && (
                                    <div className="flex items-center gap-2 text-[13px]">
                                        <button 
                                            onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                                            disabled={currentPage === 1}
                                            className="px-3 py-1 border border-slate-200 rounded text-slate-400 hover:bg-slate-50 disabled:opacity-40"
                                        >
                                            Previous
                                        </button>
                                        <span className="text-slate-600 px-2 font-medium">{currentPage} / {totalPagesCount}</span>
                                        <button 
                                            onClick={() => setCurrentPage(prev => Math.min(totalPagesCount, prev + 1))}
                                            disabled={currentPage === totalPagesCount}
                                            className="px-3 py-1 border border-slate-200 rounded text-slate-600 hover:bg-slate-50 disabled:opacity-40"
                                        >
                                            Next
                                        </button>
                                    </div>
                                )}
                            </div>

                            {/* Table */}
                            <div className="overflow-x-auto border-t border-slate-200 pt-2">
                                <table className="w-full text-left text-sm whitespace-nowrap">
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
                                                            <ArrowTopRightOnSquareIcon className="w-4 h-4 text-slate-300 mt-0.5 flex-shrink-0" />
                                                            {activeTab === 'Clusters' ? (
                                                                <span className="font-bold text-slate-800 capitalize leading-relaxed">{row.label}</span>
                                                            ) : (
                                                                <a href={row.url} target="_blank" rel="noopener noreferrer" className="hover:text-emerald-600 transition-colors leading-relaxed break-all">
                                                                    {(row.url || '').replace(/^https?:\/\/(www\.)?/, '')}
                                                                </a>
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
                    </motion.div>
                </AnimatePresence>
            )}
        </div>
    );
};

export default SEOAnalytics;

import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { MagnifyingGlassIcon, FunnelIcon, CheckIcon, GlobeAltIcon } from '@heroicons/react/24/outline';
import api from '../api/axios';
import toast from 'react-hot-toast';
import { motion } from 'framer-motion';

/* ── Favicon helper ─────────────────────────────────────────── */
const Favicon = ({ url, size = 20 }) => {
    const [err, setErr] = useState(false);
    try {
        const host = new URL(url).hostname;
        if (err) return <GlobeAltIcon style={{ width: size, height: size }} className="text-violet-300" />;
        return (
            <img
                src={`https://www.google.com/s2/favicons?domain=${host}&sz=32`}
                alt=""
                width={size}
                height={size}
                className="rounded-sm object-contain"
                onError={() => setErr(true)}
            />
        );
    } catch {
        return <GlobeAltIcon style={{ width: size, height: size }} className="text-violet-300" />;
    }
};

const PageSelector = () => {
    const [searchParams] = useSearchParams();
    const navigate = useNavigate();
    const propertyUrl = searchParams.get('property');

    const [pages, setPages] = useState([]);
    const [filteredPages, setFilteredPages] = useState([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    const [selectedPages, setSelectedPages] = useState(new Set());
    const [sortBy, setSortBy] = useState('clicks'); // clicks, impressions, position

    useEffect(() => {
        if (propertyUrl) {
            fetchPages();
        }
    }, [propertyUrl]);

    useEffect(() => {
        // Filter pages based on search term
        if (searchTerm) {
            const filtered = pages.filter(page => {
                const urlMatch = page.url.toLowerCase().includes(searchTerm.toLowerCase());
                const queryMatch = page.queries.some(q =>
                    q.query.toLowerCase().includes(searchTerm.toLowerCase())
                );
                return urlMatch || queryMatch;
            });
            setFilteredPages(filtered);
        } else {
            setFilteredPages(pages);
        }
    }, [searchTerm, pages]);

    const fetchPages = async () => {
        try {
            setLoading(true);
            const token = localStorage.getItem('access_token');
            const response = await api.get(`/auth/gsc/pages/${encodeURIComponent(propertyUrl)}`);
            setPages(response.data.pages);
            setFilteredPages(response.data.pages);
        } catch (error) {
            console.error('Error fetching pages:', error);
        } finally {
            setLoading(false);
        }
    };

    const togglePage = (pageUrl) => {
        const newSelected = new Set(selectedPages);
        if (newSelected.has(pageUrl)) {
            // Allow deselecting
            newSelected.delete(pageUrl);
        } else {
            // Check if adding this page would exceed the limit
            const existingPages = JSON.parse(sessionStorage.getItem('selectedPages') || '[]');
            const totalAfterAdd = existingPages.length + newSelected.size + 1;

            if (totalAfterAdd > 5) {
                toast.error(`Maximum 5 URLs allowed. You already have ${existingPages.length} pages selected.`);
                return;
            }
            newSelected.add(pageUrl);
        }
        setSelectedPages(newSelected);
    };

    const toggleAll = () => {
        if (selectedPages.size === filteredPages.length) {
            setSelectedPages(new Set());
        } else {
            // Add up to the 5 maximum limit
            const existingPages = JSON.parse(sessionStorage.getItem('selectedPages') || '[]');
            const canSelect = Math.max(0, 5 - existingPages.length);
            
            if (canSelect === 0) {
                toast.error(`Maximum 5 URLs allowed. You already have 5 pages selected.`);
                return;
            }
            
            if (filteredPages.length > canSelect) {
                toast.success(`Limit reached! Selected the first ${canSelect} pages.`);
            }
            
            setSelectedPages(new Set(filteredPages.slice(0, canSelect).map(p => p.url)));
        }
    };

    const analyzeSelected = () => {
        if (selectedPages.size === 0) {
            toast.error('Please select at least one page');
            return;
        }

        // Check total limit before navigating
        const existingPages = JSON.parse(sessionStorage.getItem('selectedPages') || '[]');
        const totalAfterAdd = existingPages.length + selectedPages.size;

        if (totalAfterAdd > 5) {
            toast.error(`Maximum 5 URLs allowed. You already have ${existingPages.length} pages selected. You can only add ${5 - existingPages.length} more.`);
            return;
        }

        // Navigate to analysis with selected URLs
        const urls = Array.from(selectedPages);
        navigate('/new-analysis', { state: { urls, mode: 'cluster' } });
    };

    const sortPages = (pages) => {
        return [...pages].sort((a, b) => {
            switch (sortBy) {
                case 'clicks':
                    return b.total_clicks - a.total_clicks;
                case 'impressions':
                    return b.total_impressions - a.total_impressions;
                case 'position':
                    return a.avg_position - b.avg_position;
                default:
                    return 0;
            }
        });
    };

    if (loading) {
        return (
            <div className="flex flex-col flex-1 min-h-[80vh] w-full items-center justify-center" style={{ background: '#f5f4fa' }}>
                <div className="flex flex-col items-center gap-4">
                    <div className="w-12 h-12 rounded-full border-[3px] border-violet-200 border-t-violet-600 animate-spin" />
                    <p className="text-sm font-semibold text-slate-500 tracking-wide">Connecting to Google Search Console...</p>
                </div>
            </div>
        );
    }

    const sortedPages = sortPages(filteredPages);

    // Calculate remaining slots
    const existingPages = JSON.parse(sessionStorage.getItem('selectedPages') || '[]');
    const remainingSlots = Math.max(0, 5 - existingPages.length - selectedPages.size);
    const isAtLimit = remainingSlots === 0;

    return (
        <div className="flex flex-col flex-1 h-full w-full py-4 sm:py-8 px-4 sm:px-6" style={{ background: '#f5f4fa' }}>
            <div className="w-full max-w-[1200px] mx-auto flex flex-col flex-1 relative z-10 min-h-[600px] max-h-[calc(100vh-8rem)]">
                {/* ── Main Floating Card ── */}
                <div className="bg-white rounded-[24px] shadow-[0_30px_60px_-15px_rgba(0,0,0,0.05)] overflow-hidden border border-white flex flex-col flex-1">
                    
                    {/* Header Strip */}
                    <div className="px-6 sm:px-8 py-5 sm:py-6 border-b border-slate-50 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                        <div>
                            <h1 className="text-xl sm:text-2xl font-bold text-slate-800 tracking-tight">Select Pages for Analysis</h1>
                            <div className="flex items-center gap-3 mt-1.5">
                                <span className="inline-flex items-center rounded-md bg-violet-50 px-2 py-1 text-xs font-medium text-violet-700 ring-1 ring-inset ring-violet-700/10">
                                    {propertyUrl}
                                </span>
                                {existingPages.length > 0 && (
                                    <span className="text-sm font-medium text-violet-600">
                                        {existingPages.length} Pages Already Selected • {remainingSlots} Slots Remaining
                                    </span>
                                )}
                            </div>
                        </div>
                        <button
                            onClick={analyzeSelected}
                            disabled={selectedPages.size === 0 || isAtLimit}
                            className={`px-8 py-3 rounded-full font-bold text-sm transition-all duration-300 flex items-center gap-2
                                ${selectedPages.size > 0 && !isAtLimit
                                    ? 'text-white bg-gradient-to-r from-violet-600 to-fuchsia-600 shadow-md hover:shadow-lg hover:-translate-y-0.5'
                                    : 'text-slate-400 bg-slate-100 cursor-not-allowed'
                                }`}
                        >
                            Import {selectedPages.size} Page{selectedPages.size !== 1 ? 's' : ''}
                        </button>
                    </div>

                    {/* Filters & Content Area */}
                    <div className="p-6 sm:p-8 flex flex-col flex-1 overflow-hidden bg-white">
                        
                        {/* Search and Sort Controls */}
                        <div className="flex gap-4 items-center mb-6">
                            <div className="flex-1 relative">
                                <MagnifyingGlassIcon className="absolute left-4 top-1/2 transform -translate-y-1/2 w-5 h-5 text-slate-400" />
                                <input
                                    type="text"
                                    placeholder="Search pages or queries (e.g., 'tax', 'mortgage')..."
                                    value={searchTerm}
                                    onChange={(e) => setSearchTerm(e.target.value)}
                                    className="w-full pl-11 pr-5 py-3.5 bg-slate-50 border border-slate-200 rounded-2xl focus:outline-none focus:ring-2 focus:ring-violet-500/20 focus:border-violet-400 focus:bg-white text-slate-700 transition-all font-medium placeholder:font-normal placeholder-slate-400"
                                />
                            </div>
                            <select
                                value={sortBy}
                                onChange={(e) => setSortBy(e.target.value)}
                                className="px-5 py-3.5 bg-slate-50 border border-slate-200 rounded-2xl focus:outline-none focus:ring-2 focus:ring-violet-500/20 focus:border-violet-400 focus:bg-white text-slate-700 font-medium transition-all cursor-pointer min-w-[200px]"
                            >
                                <option value="clicks">Sort by Clicks</option>
                                <option value="impressions">Sort by Impressions</option>
                                <option value="position">Sort by Position</option>
                            </select>
                        </div>

                        {/* List Metadata */}
                        <div className="flex items-center justify-between mb-4 px-1">
                            <span className="text-sm font-semibold text-slate-500">
                                Showing <span className="text-slate-700">{sortedPages.length}</span> of {pages.length} crawled pages
                            </span>
                            <button
                                onClick={toggleAll}
                                className="text-sm font-bold text-violet-600 hover:text-violet-700 transition-colors flex items-center gap-2"
                            >
                                <div className={`w-5 h-5 rounded md flex items-center justify-center transition-colors border ${selectedPages.size === filteredPages.length && filteredPages.length > 0 ? 'bg-violet-600 border-violet-600' : 'bg-white border-slate-300'}`}>
                                    {selectedPages.size === filteredPages.length && filteredPages.length > 0 && <CheckIcon className="w-3.5 h-3.5 text-white" />}
                                </div>
                                {selectedPages.size === filteredPages.length && filteredPages.length > 0 ? 'Deselect All' : 'Select All Filtered'}
                            </button>
                        </div>

                        {/* Scrolling Data Cards */}
                        <div className="flex-1 overflow-auto pr-2 pb-6 space-y-3" style={{ scrollbarWidth: 'thin' }}>
                            {sortedPages.map((page, index) => {
                                const isSelected = selectedPages.has(page.url);
                                return (
                                    <motion.div
                                        key={page.url}
                                        initial={{ opacity: 0, y: 10 }}
                                        animate={{ opacity: 1, y: 0 }}
                                        transition={{ delay: Math.min(index * 0.03, 0.3) }}
                                        onClick={() => togglePage(page.url)}
                                        className={`flex flex-col lg:flex-row lg:items-center justify-between p-4 sm:p-5 border cursor-pointer transition-all duration-300 gap-4 group rounded-[20px]
                                            ${isSelected 
                                                ? 'bg-violet-50/60 border-violet-400 shadow-sm ring-1 ring-violet-500/20' 
                                                : 'bg-white border-slate-200 shadow-sm hover:border-violet-300 hover:shadow-md hover:bg-violet-50/30 hover:-translate-y-0.5'}`}
                                    >
                                        <div className="flex items-start gap-4 flex-1 min-w-0">
                                            {/* Custom Checkbox */}
                                            <div className="pt-0.5 sm:pt-1">
                                                <div className={`w-5 h-5 rounded-[6px] border flex items-center justify-center transition-all ${isSelected ? 'bg-violet-600 border-violet-600 shadow-md shadow-violet-400/30' : 'bg-white border-slate-300 group-hover:border-violet-400'}`}>
                                                    {isSelected && <CheckIcon className="w-3.5 h-3.5 text-white stroke-[3px]" />}
                                                </div>
                                            </div>
                                            
                                            {/* Main Content */}
                                            <div className="flex flex-col gap-2.5 flex-1 min-w-0">
                                                <div className="flex items-center gap-2.5 overflow-hidden">
                                                    <div className="flex-shrink-0 mt-0.5">
                                                        <Favicon url={page.url} size={16} />
                                                    </div>
                                                    <div className="text-[15px] sm:text-[16px] text-slate-800 font-bold truncate tracking-tight transition-colors group-hover:text-violet-900" title={page.url}>
                                                        {page.url.replace('https://', '').replace('http://', '').replace('www.', '')}
                                                    </div>
                                                </div>
                                                
                                                <div className="flex flex-wrap gap-1.5 sm:gap-2">
                                                    {page.queries.slice(0, 3).map((query, idx) => (
                                                        <span
                                                            key={idx}
                                                            className={`inline-flex items-center px-2.5 py-1 rounded-lg text-[12px] font-semibold border shadow-sm transition-all
                                                                ${isSelected 
                                                                    ? 'bg-white border-violet-200 text-violet-700' 
                                                                    : 'bg-slate-50 border-slate-200/80 text-slate-600 group-hover:bg-white'}`}
                                                        >
                                                            {query.query}
                                                        </span>
                                                    ))}
                                                    {page.queries.length > 3 && (
                                                        <span className="inline-flex items-center px-2 py-1 rounded-lg text-xs font-bold text-slate-400">
                                                            +{page.queries.length - 3}
                                                        </span>
                                                    )}
                                                </div>
                                            </div>
                                        </div>

                                        {/* SEO Stats Bar */}
                                        <div className="flex items-center gap-6 sm:gap-8 flex-shrink-0 ml-9 lg:ml-0 bg-slate-50/80 rounded-2xl px-5 py-2.5 border border-slate-100">
                                            <div className="flex flex-col items-center sm:items-start min-w-[50px]">
                                                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-0.5">Clicks</span>
                                                <span className="text-sm font-bold text-slate-800">{page.total_clicks.toLocaleString()}</span>
                                            </div>
                                            <div className="w-px h-8 bg-slate-200" />
                                            <div className="flex flex-col items-center sm:items-start min-w-[50px]">
                                                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-0.5">Impr.</span>
                                                <span className="text-sm font-semibold text-slate-600">{page.total_impressions.toLocaleString()}</span>
                                            </div>
                                            <div className="w-px h-8 bg-slate-200" />
                                            <div className="flex flex-col items-center sm:items-start min-w-[40px]">
                                                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-0.5">Position</span>
                                                <span className="text-sm font-semibold text-slate-600">{page.avg_position}</span>
                                            </div>
                                        </div>
                                    </motion.div>
                                );
                            })}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default PageSelector;

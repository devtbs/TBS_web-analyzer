import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { MagnifyingGlassIcon, FunnelIcon, CheckIcon } from '@heroicons/react/24/outline';
import axios from 'axios';
import toast from 'react-hot-toast';

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
            const response = await axios.get(`/auth/gsc/pages/${encodeURIComponent(propertyUrl)}`, {
                headers: { Authorization: `Bearer ${token}` }
            });
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
                toast.error(`Maximum 5 URLs allowed. You already have ${existingPages.length} pages selected in Dashboard.`);
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
            // Check limit before selecting all
            const existingPages = JSON.parse(sessionStorage.getItem('selectedPages') || '[]');
            const totalAfterAdd = existingPages.length + filteredPages.length;

            if (totalAfterAdd > 5) {
                const canSelect = Math.max(0, 5 - existingPages.length);
                toast.error(`Maximum 5 URLs allowed. You already have ${existingPages.length} pages selected. You can only select ${canSelect} more.`);
                return;
            }
            setSelectedPages(new Set(filteredPages.map(p => p.url)));
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
        navigate('/dashboard', { state: { urls, mode: 'cluster' } });
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
            <div className="min-h-screen bg-slate-50 flex items-center justify-center">
                <div className="text-center">
                    <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-purple-600 mx-auto"></div>
                    <p className="mt-4 text-slate-600">Loading pages from Search Console...</p>
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
        <div className="min-h-screen bg-slate-50 py-12 px-4 font-sans relative overflow-hidden">
            {/* Ambient Background Blur to match Dashboard */}
            <div className="absolute top-0 right-0 w-[800px] h-[800px] bg-violet-200/30 rounded-full blur-[120px] -translate-y-1/2 translate-x-1/3 pointer-events-none" />
            <div className="absolute bottom-0 left-0 w-[600px] h-[600px] bg-blue-200/30 rounded-full blur-[100px] translate-y-1/3 -translate-x-1/3 pointer-events-none" />

            <div className="max-w-6xl mx-auto relative z-10 flex flex-col h-[calc(100vh-6rem)]">
                {/* ── Main Floating Card ── */}
                <div className="bg-white/80 backdrop-blur-xl rounded-[24px] shadow-xl shadow-slate-200/40 border border-slate-200/60 flex flex-col flex-1 overflow-hidden">
                    
                    {/* Header Strip */}
                    <div className="px-8 py-6 border-b border-slate-100 flex items-center justify-between bg-white/50">
                        <div>
                            <h1 className="text-2xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-slate-900 to-slate-700 tracking-tight">Select Pages for Analysis</h1>
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
                    <div className="p-8 flex flex-col flex-1 overflow-hidden">
                        
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
                        <div className="flex items-center justify-between mb-3 px-1 text-sm font-semibold text-slate-500">
                            <span>Showing {sortedPages.length} of {pages.length} crawled pages</span>
                            <button
                                onClick={toggleAll}
                                className="text-violet-600 hover:text-violet-700 transition-colors"
                            >
                                {selectedPages.size === filteredPages.length ? 'Deselect All' : 'Select All Filtered'}
                            </button>
                        </div>

                        {/* Scrolling Data Table */}
                        <div className="flex-1 overflow-auto bg-white rounded-2xl border border-slate-100 shadow-sm relative">
                            <table className="w-full text-left border-collapse">
                                <thead className="bg-slate-50/80 backdrop-blur-md sticky top-0 z-10 border-b border-slate-100">
                                    <tr>
                                        <th className="w-14 px-6 py-4 font-semibold text-slate-500 text-xs uppercase tracking-wider">
                                            <input
                                                type="checkbox"
                                                checked={selectedPages.size === filteredPages.length && filteredPages.length > 0}
                                                onChange={toggleAll}
                                                className="w-4.5 h-4.5 text-violet-600 bg-white border-slate-300 rounded cursor-pointer focus:ring-violet-500 focus:ring-offset-2"
                                            />
                                        </th>
                                        <th className="px-6 py-4 font-semibold text-slate-500 text-xs uppercase tracking-wider">Page URL</th>
                                        <th className="px-6 py-4 font-semibold text-slate-500 text-xs uppercase tracking-wider hidden md:table-cell">Top Search Intents</th>
                                        <th className="px-6 py-4 font-semibold text-slate-500 text-xs uppercase tracking-wider text-right">Clicks</th>
                                        <th className="px-6 py-4 font-semibold text-slate-500 text-xs uppercase tracking-wider text-right">Impressions</th>
                                        <th className="px-6 py-4 font-semibold text-slate-500 text-xs uppercase tracking-wider text-right hidden sm:table-cell">Pos</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-50">
                                    {sortedPages.map((page) => (
                                        <tr
                                            key={page.url}
                                            className={`group transition-all cursor-pointer hover:bg-violet-50/50 ${selectedPages.has(page.url) ? 'bg-violet-50/80 border-l-4 border-l-violet-500' : 'border-l-4 border-l-transparent'}`}
                                            onClick={() => togglePage(page.url)}
                                        >
                                            <td className="px-6 py-4">
                                                <input
                                                    type="checkbox"
                                                    checked={selectedPages.has(page.url)}
                                                    onChange={e => { e.stopPropagation(); togglePage(page.url); }}
                                                    className="w-4.5 h-4.5 text-violet-600 bg-white border-slate-300 rounded cursor-pointer focus:ring-violet-500 focus:ring-offset-2"
                                                />
                                            </td>
                                            <td className="px-6 py-4 whitespace-nowrap">
                                                <div className="text-[15px] text-slate-900 font-semibold truncate max-w-sm" title={page.url}>
                                                    {page.url.replace('https://', '').replace('http://', '').replace('www.', '')}
                                                </div>
                                            </td>
                                            <td className="px-6 py-4 hidden md:table-cell">
                                                <div className="flex flex-wrap gap-1.5">
                                                    {page.queries.slice(0, 3).map((query, idx) => (
                                                        <span
                                                            key={idx}
                                                            className="inline-flex items-center px-2.5 py-1 rounded-md text-xs font-medium bg-slate-100 text-slate-600 group-hover:bg-white transition-colors border border-slate-200/60 shadow-sm"
                                                        >
                                                            {query.query}
                                                        </span>
                                                    ))}
                                                    {page.queries.length > 3 && (
                                                        <span className="inline-flex items-center px-2 py-1 rounded-md text-xs font-semibold text-slate-400">
                                                            +{page.queries.length - 3}
                                                        </span>
                                                    )}
                                                </div>
                                            </td>
                                            <td className="px-6 py-4 text-right whitespace-nowrap text-[15px] font-medium text-slate-800">
                                                {page.total_clicks.toLocaleString()}
                                            </td>
                                            <td className="px-6 py-4 text-right whitespace-nowrap text-[15px] text-slate-500">
                                                {page.total_impressions.toLocaleString()}
                                            </td>
                                            <td className="px-6 py-4 text-right whitespace-nowrap text-[15px] text-slate-500 hidden sm:table-cell">
                                                {page.avg_position}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default PageSelector;

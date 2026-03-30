import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import api from '../api/axios';
import { toast } from 'react-hot-toast';
import { useAuth } from '../context/AuthContext';
import { 
    DocumentTextIcon, 
    TrashIcon, 
    EllipsisHorizontalIcon,
    PlusIcon,
    CalendarDaysIcon,
    ChevronLeftIcon,
    ChevronRightIcon,
    MagnifyingGlassIcon,
} from '@heroicons/react/24/outline';
import { 
    FolderIcon as FolderIconSolid, 
    PlusIcon as PlusIconSolid, 
    CalendarIcon as CalendarIconSolid,
    CheckIcon
} from '@heroicons/react/20/solid';

import { 
    format, 
    addMonths, 
    subMonths, 
    startOfMonth, 
    endOfMonth, 
    startOfWeek, 
    endOfWeek, 
    isSameMonth, 
    isSameDay, 
    addDays, 
    eachDayOfInterval 
} from 'date-fns';

// Helper for time ago
const formatTimeAgo = (dateString) => {
    if (!dateString) return '';
    
    // Ensure the date string is treated as UTC if no timezone is provided
    let normalized = dateString;
    if (dateString.includes('T') && !dateString.includes('Z') && !dateString.includes('+')) {
        normalized = dateString + 'Z';
    }
    
    const date = new Date(normalized);
    const now = new Date();
    const diffInSeconds = Math.floor((now - date) / 1000);
    
    if (diffInSeconds < 60) return 'Just now';
    if (diffInSeconds < 3600) return `${Math.floor(diffInSeconds / 60)} mins ago`;
    if (diffInSeconds < 86400) return `${Math.floor(diffInSeconds / 3600)} hrs ago`;
    if (diffInSeconds < 2592000) return `${Math.floor(diffInSeconds / 86400)} days ago`;
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};

export default function Documents() {
    const [documents, setDocuments] = useState([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    const [searchParams] = useSearchParams();
    const folderFilter = searchParams.get('folder');
    const [activeDeadlinePopover, setActiveDeadlinePopover] = useState(null);
    const [activeFolderPopover, setActiveFolderPopover] = useState(null);
    const [activeActionsMenu, setActiveActionsMenu] = useState(null);
    const [folderSearch, setFolderSearch] = useState('');
    const [viewMode, setViewMode] = useState('options');
    const [currentMonth, setCurrentMonth] = useState(new Date());
    const { user } = useAuth();
    const navigate = useNavigate();

    const dispatchRefresh = () => {
        window.dispatchEvent(new CustomEvent('documents-updated'));
    };

    useEffect(() => {
        fetchDocuments();
        window.addEventListener('documents-updated', fetchDocuments);
        return () => window.removeEventListener('documents-updated', fetchDocuments);
    }, []);

    useEffect(() => {
        const handleClickOutside = (e) => {
            // Close popovers on any click that isn't stopping propagation
            setActiveDeadlinePopover(null);
            setActiveFolderPopover(null);
            setActiveActionsMenu(null);
            setViewMode('options');
        };
        
        window.addEventListener('click', handleClickOutside);
        return () => window.removeEventListener('click', handleClickOutside);
    }, []);

    const fetchDocuments = async () => {
        try {
            const response = await api.get('/api/documents');
            setDocuments(response.data);
        } catch (error) {
            console.error('Failed to fetch documents:', error);
            toast.error('Failed to load documents');
        } finally {
            setLoading(false);
        }
    };

    const handleFolderUpdate = async (docId, newFolder) => {
        if (!newFolder) return;
        
        try {
            await api.put(`/api/documents/${docId}`, { folder: newFolder });
            setDocuments(documents.map(doc => 
                doc.id === docId ? { ...doc, folder: newFolder } : doc
            ));
            setActiveFolderPopover(null);
            setFolderSearch('');
            toast.success('Folder updated');
            dispatchRefresh();
        } catch (error) {
            console.error('Failed to update folder:', error);
            toast.error('Failed to update folder');
        }
    };

    const handleDeadlineUpdate = async (docId, date) => {
        try {
            const dateStr = date instanceof Date ? date.toISOString() : date;
            await api.put(`/api/documents/${docId}`, { deadline: dateStr });
            setDocuments(documents.map(doc => 
                doc.id === docId ? { ...doc, deadline: dateStr } : doc
            ));
            setActiveDeadlinePopover(null);
            setViewMode('options');
            toast.success('Deadline updated');
            dispatchRefresh();
        } catch (error) {
            console.error('Failed to update deadline:', error);
            toast.error('Failed to update deadline');
        }
    };

    const getDeadlineOptions = () => {
        const today = new Date();
        const tomorrow = addDays(today, 1);
        const nextWeek = addDays(today, 7);
        const twoWeeks = addDays(today, 14);

        const fmt = (d) => format(d, 'MMM d');

        return [
            { label: 'Today', date: today, dateLabel: fmt(today) },
            { label: 'Tomorrow', date: tomorrow, dateLabel: fmt(tomorrow) },
            { label: 'Next week', date: nextWeek, dateLabel: fmt(nextWeek) },
            { label: 'In two weeks', date: twoWeeks, dateLabel: fmt(twoWeeks) },
            { label: 'Custom...', date: null, dateLabel: '' }
        ];
    };

    const renderCalendar = (docId) => {
        const monthStart = startOfMonth(currentMonth);
        const monthEnd = endOfMonth(monthStart);
        const startDate = startOfWeek(monthStart);
        const endDate = endOfWeek(monthEnd);
        const calendarDays = eachDayOfInterval({ start: startDate, end: endDate });

        return (
            <div className="p-3">
                <div className="flex items-center justify-between mb-4">
                    <button 
                        onClick={(e) => { e.stopPropagation(); setCurrentMonth(subMonths(currentMonth, 1)); }}
                        className="p-1 hover:bg-slate-100 rounded-lg text-slate-400 hover:text-slate-600 transition-all"
                    >
                        <ChevronLeftIcon className="w-4 h-4" />
                    </button>
                    <span className="text-sm font-bold text-slate-700 capitalize">
                        {format(currentMonth, 'MMMM yyyy')}
                    </span>
                    <button 
                        onClick={(e) => { e.stopPropagation(); setCurrentMonth(addMonths(currentMonth, 1)); }}
                        className="p-1 hover:bg-slate-100 rounded-lg text-slate-400 hover:text-slate-600 transition-all"
                    >
                        <ChevronRightIcon className="w-4 h-4" /> 
                    </button>
                </div>
                <div className="grid grid-cols-7 gap-1 text-center mb-1">
                    {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map(day => (
                        <div key={day} className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">{day}</div>
                    ))}
                </div>
                <div className="grid grid-cols-7 gap-1">
                    {calendarDays.map((day, idx) => (
                        <button
                            key={idx}
                            onClick={(e) => {
                                e.stopPropagation();
                                handleDeadlineUpdate(docId, day);
                            }}
                            className={`
                                text-[11px] h-8 w-8 flex items-center justify-center rounded-lg transition-all font-medium
                                ${!isSameMonth(day, monthStart) ? 'text-slate-200' : 'text-slate-600 hover:bg-emerald-50 hover:text-emerald-600'}
                                ${isSameDay(day, new Date()) ? 'bg-emerald-50 text-emerald-600' : ''}
                            `}
                        >
                            {format(day, 'd')}
                        </button>
                    ))}
                </div>
                <button 
                    onClick={(e) => { e.stopPropagation(); setViewMode('options'); }}
                    className="w-full mt-3 text-[11px] font-bold text-slate-400 hover:text-slate-600 transition-colors uppercase tracking-tight"
                >
                    Back to options
                </button>
            </div>
        );
    };

    const handleDelete = async (e, id) => {
        e.preventDefault();
        e.stopPropagation();
        
        if (!window.confirm('Are you sure you want to delete this document?')) return;
        
        try {
            await api.delete(`/api/documents/${id}`);
            setDocuments(documents.filter(doc => doc.id !== id));
            toast.success('Document deleted successfully');
        } catch (error) {
            toast.error('Failed to delete document');
        }
    };

    const handleNewDocument = async () => {
        try {
            const response = await api.post('/api/documents');
            navigate(`/documents/${response.data.id}`);
        } catch (error) {
            console.error('Failed to create document:', error);
            toast.error('Failed to create new document');
        }
    };

    const filteredDocs = documents.filter(doc => {
        const matchesSearch = doc.title.toLowerCase().includes(searchTerm.toLowerCase());
        const matchesFolder = !folderFilter || doc.folder === folderFilter;
        return matchesSearch && matchesFolder;
    });

    return (
        <div className="bg-white min-h-screen flex flex-col">
            {/* Header Area */}
            <div className="px-6 py-4 flex items-center justify-between border-b border-slate-100">
                <div className="flex items-center gap-4">
                    <h1 className="text-xl font-bold text-slate-800">All documents</h1>
                </div>
                
                <div className="flex items-center gap-3">
                    <div className="relative">
                        <input
                            type="text"
                            placeholder="Search documents..."
                            className="text-sm bg-slate-50 border-none rounded-lg px-4 py-2 w-64 focus:ring-2 focus:ring-emerald-500 transition-all font-medium"
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                        />
                    </div>
                    <button 
                        onClick={handleNewDocument}
                        className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-lg text-sm font-bold transition-all shadow-sm"
                    >
                        New document
                    </button>
                </div>
            </div>

            {/* Table Area */}
            <div className="flex-1 overflow-x-auto">
                <table className="w-full text-left border-collapse min-w-[800px]">
                    <thead>
                        <tr className="border-b border-slate-100 bg-slate-50/50">
                            <th className="px-6 py-3 w-10"></th>
                            <th className="px-6 py-3 text-xs font-bold text-slate-500 uppercase tracking-wider">Name</th>
                            <th className="px-6 py-3 text-xs font-bold text-slate-500 uppercase tracking-wider">Search Query</th>
                            <th className="px-6 py-3 text-xs font-bold text-slate-500 uppercase tracking-wider">Edited</th>
                            <th className="px-6 py-3 text-xs font-bold text-slate-500 uppercase tracking-wider">Folder</th>
                            <th className="px-6 py-3 text-xs font-bold text-slate-500 uppercase tracking-wider">User</th>
                            <th className="px-6 py-3 text-xs font-bold text-slate-500 uppercase tracking-wider">Deadline</th>
                            <th className="px-6 py-3 w-10"></th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-50">
                        {loading ? (
                            [...Array(5)].map((_, i) => (
                                <tr key={i} className="animate-pulse">
                                    <td className="px-6 py-4"><div className="w-4 h-4 bg-slate-100 rounded" /></td>
                                    <td className="px-6 py-4">
                                        <div className="h-4 bg-slate-100 rounded w-48 mb-2" />
                                        <div className="h-3 bg-slate-50 rounded w-32" />
                                    </td>
                                    <td className="px-6 py-4"><div className="h-4 bg-slate-50 rounded w-32" /></td>
                                    <td className="px-6 py-4"><div className="h-4 bg-slate-50 rounded w-20" /></td>
                                    <td className="px-6 py-4"><div className="h-4 bg-slate-50 rounded w-24" /></td>
                                    <td className="px-6 py-4"><div className="h-4 bg-slate-50 rounded w-28" /></td>
                                    <td className="px-6 py-4"><div className="h-4 bg-slate-50 rounded w-12" /></td>
                                    <td className="px-6 py-4"></td>
                                </tr>
                            ))
                        ) : filteredDocs.map((doc) => (
                            <tr 
                                key={doc.id} 
                                onClick={() => navigate(`/documents/${doc.id}`)}
                                className="hover:bg-slate-50/80 transition-colors group cursor-pointer border-b border-slate-50"
                            >
                                <td className="px-6 py-4 cursor-pointer" onClick={(e) => e.stopPropagation()}>
                                    <input type="checkbox" className="rounded border-slate-300 text-emerald-600 focus:ring-emerald-500 cursor-pointer" />
                                </td>
                                <td className="px-6 py-4 max-w-xs cursor-pointer">
                                    <div className="text-sm font-medium text-slate-900 group-hover:text-emerald-600 transition-colors line-clamp-1">
                                        {doc.title}
                                    </div>
                                </td>
                                <td className="px-6 py-4 cursor-pointer">
                                    <div className="text-xs text-slate-500 font-medium line-clamp-1 lowercase italic">
                                        {doc.title.split(':').pop().trim()}
                                    </div>
                                </td>
                                <td className="px-6 py-4 cursor-pointer">
                                    <div className="text-xs text-slate-600 font-medium">
                                        {formatTimeAgo(doc.updated_at)}
                                    </div>
                                </td>
                                <td className="px-6 py-4 whitespace-nowrap">
                                    <div className="relative group">
                                        <button
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                setActiveFolderPopover(activeFolderPopover === doc.id ? null : doc.id);
                                            }}
                                            className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-md transition-all ml-[-8px] ${
                                                doc.folder 
                                                    ? 'text-slate-600 bg-slate-50 hover:bg-slate-100 font-bold' 
                                                    : 'text-slate-400 hover:text-slate-600 border border-dashed border-slate-200 hover:border-slate-300'
                                            }`}
                                        >
                                            <span className="text-[13px] font-medium leading-none">
                                                {doc.folder ? doc.folder : '+ Folder'}
                                            </span>
                                        </button>

                                        <AnimatePresence>
                                            {activeFolderPopover === doc.id && (
                                                <motion.div
                                                    initial={{ opacity: 0, scale: 0.95, y: -10 }}
                                                    animate={{ opacity: 1, scale: 1, y: 0 }}
                                                    exit={{ opacity: 0, scale: 0.95, y: -10 }}
                                                    transition={{ duration: 0.15 }}
                                                    onClick={(e) => e.stopPropagation()}
                                                    className="absolute left-0 mt-2 w-56 bg-white rounded-xl shadow-2xl border border-slate-100 z-[100] overflow-hidden py-1.5"
                                                >
                                                    {/* Search */}
                                                    <div className="px-2 pb-2 border-bottom border-slate-50">
                                                        <div className="relative">
                                                            <MagnifyingGlassIcon className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
                                                            <input 
                                                                type="text"
                                                                autoFocus
                                                                placeholder="Search..."
                                                                value={folderSearch}
                                                                onChange={(e) => setFolderSearch(e.target.value)}
                                                                className="w-full pl-8 pr-3 py-1.5 text-[13px] bg-slate-50 border-0 rounded-lg focus:ring-1 focus:ring-slate-100 outline-none text-slate-600"
                                                            />
                                                        </div>
                                                    </div>

                                                    {/* Options */}
                                                    <div className="max-h-64 overflow-y-auto pt-1 space-y-0.5">
                                                        <div className="px-3 py-2 border-b border-slate-50">
                                                            <div className="flex items-center gap-2">
                                                                <input 
                                                                    type="text"
                                                                    placeholder="New folder..."
                                                                    className="flex-1 min-w-0 bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 text-[13px] outline-none focus:ring-1 focus:ring-emerald-500 focus:border-emerald-500 transition-all font-medium"
                                                                    onKeyDown={(e) => {
                                                                        if (e.key === 'Enter' && e.target.value.trim()) {
                                                                            handleFolderUpdate(doc.id, e.target.value.trim());
                                                                            e.target.value = '';
                                                                        }
                                                                        e.stopPropagation();
                                                                    }}
                                                                    onClick={(e) => e.stopPropagation()}
                                                                />
                                                                <button 
                                                                    onClick={(e) => {
                                                                        e.stopPropagation();
                                                                        const input = e.currentTarget.previousSibling;
                                                                        if (input && input.value.trim()) {
                                                                            handleFolderUpdate(doc.id, input.value.trim());
                                                                            input.value = '';
                                                                        }
                                                                    }}
                                                                    className="p-1.5 text-emerald-600 hover:bg-emerald-50 rounded-lg transition-colors"
                                                                >
                                                                    <PlusIconSolid className="w-4 h-4" />
                                                                </button>
                                                            </div>
                                                        </div>

                                                        {[...new Set(documents.map(d => d.folder).filter(Boolean))]
                                                            .filter(f => f.toLowerCase().includes(folderSearch.toLowerCase()))
                                                            .sort()
                                                            .map((folder) => (
                                                            <button 
                                                                key={folder}
                                                                onClick={() => handleFolderUpdate(doc.id, folder)}
                                                                className="w-full flex items-center justify-between gap-2.5 px-3 py-2 text-[13px] text-slate-600 hover:bg-slate-50 transition-colors text-left group/item"
                                                            >
                                                                <div className="flex items-center gap-2.5">
                                                                    <FolderIconSolid className="w-4 h-4 text-slate-800" />
                                                                    {folder}
                                                                </div>
                                                                {doc.folder === folder && (
                                                                    <CheckIcon className="w-4 h-4 text-emerald-500" />
                                                                )}
                                                            </button>
                                                        ))}
                                                    </div>
                                                </motion.div>
                                            )}
                                        </AnimatePresence>
                                    </div>
                                </td>
                                <td className="px-6 py-4 cursor-pointer">
                                    <div className="text-xs font-semibold text-slate-700">
                                        {user?.name || 'Alexander Lambie'}
                                    </div>
                                </td>
                                <td className="px-6 py-4 cursor-pointer relative text-left">
                                    <button 
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            setActiveDeadlinePopover(activeDeadlinePopover === doc.id ? null : doc.id);
                                        }}
                                        className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-md transition-all ml-[-8px] ${
                                            doc.deadline
                                                ? 'text-slate-600 bg-slate-50 hover:bg-slate-100 border border-slate-100 font-bold'
                                                : 'text-slate-400 hover:text-slate-600 border border-dashed border-slate-200 hover:border-slate-300 font-bold'
                                        }`}
                                    >
                                        <span className="text-[13px] font-medium leading-none">
                                            {doc.deadline ? (
                                                <span className="flex items-center gap-1">
                                                    <CalendarIconSolid className="w-3.5 h-3.5 text-slate-400" />
                                                    {new Date(doc.deadline).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                                                </span>
                                            ) : '+ Date'}
                                        </span>
                                    </button>

                                    <AnimatePresence mode="wait">
                                        {activeDeadlinePopover === doc.id && (
                                            <motion.div 
                                                initial={{ opacity: 0, scale: 0.95 }}
                                                animate={{ opacity: 1, scale: 1 }}
                                                exit={{ opacity: 0, scale: 0.95 }}
                                                className="absolute left-[-14px] top-full mt-[-1px] w-56 bg-white rounded-2xl shadow-2xl border border-slate-100 z-[100] overflow-hidden"
                                                onClick={(e) => e.stopPropagation()}
                                            >
                                                {viewMode === 'calendar' ? (
                                                    renderCalendar(doc.id)
                                                ) : (
                                                    <div className="p-2">
                                                        {getDeadlineOptions().map((opt, i) => (
                                                            opt.label === 'Custom...' ? (
                                                                <button 
                                                                    key={i}
                                                                    className="w-full flex items-center justify-between px-4 py-3 hover:bg-slate-50 cursor-pointer text-sm font-bold text-slate-700 transition-colors rounded-xl text-left group"
                                                                    onClick={(e) => {
                                                                        e.stopPropagation();
                                                                        setViewMode('calendar');
                                                                    }}
                                                                >
                                                                    <div className="flex items-center gap-3">
                                                                        <CalendarDaysIcon className="w-5 h-5 text-slate-400 group-hover:text-emerald-500 transition-colors" />
                                                                        <span>{opt.label}</span>
                                                                    </div>
                                                                </button>
                                                            ) : (
                                                                <button 
                                                                    key={i}
                                                                    onClick={(e) => {
                                                                        e.stopPropagation();
                                                                        handleDeadlineUpdate(doc.id, opt.date);
                                                                    }}
                                                                    className="w-full flex items-center justify-between px-4 py-3 hover:bg-slate-50 text-sm font-bold text-slate-700 transition-colors group rounded-xl text-left"
                                                                >
                                                                    <div className="flex items-center gap-3">
                                                                        <CalendarDaysIcon className="w-5 h-5 text-slate-400 group-hover:text-emerald-500 transition-colors" />
                                                                        <span>{opt.label}</span>
                                                                    </div>
                                                                    <span className="text-slate-400 text-xs font-medium group-hover:text-slate-600 transition-colors">{opt.dateLabel}</span>
                                                                </button>
                                                            )
                                                        ))}
                                                    </div>
                                                )}
                                            </motion.div>
                                        )}
                                    </AnimatePresence>
                                </td>
                                <td className="pl-4 pr-2 py-4 text-right cursor-pointer" onClick={(e) => e.stopPropagation()}>
                                    <div className="flex items-center justify-end relative">
                                        <button 
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                setActiveActionsMenu(activeActionsMenu === doc.id ? null : doc.id);
                                            }}
                                            className={`p-1 transition-colors cursor-pointer rounded-lg ${activeActionsMenu === doc.id ? 'text-slate-900 bg-slate-100' : 'text-slate-400 hover:text-slate-900'}`}
                                        >
                                            <EllipsisHorizontalIcon className="w-5 h-5" />
                                        </button>

                                        <AnimatePresence>
                                            {activeActionsMenu === doc.id && (
                                                <motion.div 
                                                    initial={{ opacity: 0, scale: 0.95, y: -5 }}
                                                    animate={{ opacity: 1, scale: 1, y: 0 }}
                                                    exit={{ opacity: 0, scale: 0.95, y: -5 }}
                                                    className="absolute right-[-4px] top-full mt-0.5 w-[155px] bg-white rounded-2xl shadow-[0_10px_38px_-10px_rgba(22,23,24,0.35),0_10px_20px_-15px_rgba(22,23,24,0.2)] border border-slate-100 z-[110] overflow-hidden p-1 text-left"
                                                >
                                                    <button 
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            window.open(`/documents/${doc.id}`, '_blank');
                                                            setActiveActionsMenu(null);
                                                        }}
                                                        className="w-full flex items-center px-2 py-1.5 text-[13px] font-medium text-slate-700 hover:bg-slate-50 rounded-xl transition-colors text-left"
                                                    >
                                                        Open in new tab
                                                    </button>
                                                    
                                                    <div className="h-[1px] bg-slate-50 my-1 mx-1" />

                                                    <button 
                                                        onClick={(e) => handleDelete(e, doc.id)}
                                                        className="w-full flex items-center gap-2 px-2 py-1.5 text-[13px] font-bold text-red-500 hover:bg-red-50 rounded-xl transition-colors text-left"
                                                    >
                                                        <TrashIcon className="w-4 h-4" />
                                                        Delete document
                                                    </button>
                                                </motion.div>
                                            )}
                                        </AnimatePresence>
                                    </div>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
                
                {(!loading && filteredDocs.length === 0) && (
                    <div className="flex flex-col items-center justify-center p-20 text-center">
                        <div className="w-16 h-16 bg-slate-50 text-slate-300 flex items-center justify-center rounded-2xl mb-4">
                            <DocumentTextIcon className="w-8 h-8" />
                        </div>
                        <h3 className="text-lg font-bold text-slate-800 mb-1">No documents found</h3>
                        <p className="text-slate-500 max-w-sm">
                            {searchTerm ? 'Try adjusting your search query.' : 'You haven\'t created any documents yet.'}
                        </p>
                    </div>
                )}
            </div>
        </div>
    );
}

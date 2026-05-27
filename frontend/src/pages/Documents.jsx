import { useState, useEffect, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import api from '../api/axios';
import { toast } from 'react-hot-toast';
import { useAuth } from '../context/AuthContext';
import ConfirmDialog from '../components/ui/ConfirmDialog';
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
    
    let normalized = dateString;
    if (dateString.includes('T') && !dateString.includes('Z') && !dateString.includes('+')) {
        normalized = dateString + 'Z';
    }
    
    const date = new Date(normalized);
    const now = new Date();
    const diffInSeconds = Math.floor((now - date) / 1000);
    
    if (diffInSeconds < 60) return 'Just now';
    if (diffInSeconds < 3600) return `${Math.floor(diffInSeconds / 60)}m ago`;
    if (diffInSeconds < 86400) return `${Math.floor(diffInSeconds / 3600)}h ago`;
    if (diffInSeconds < 2592000) return `${Math.floor(diffInSeconds / 86400)}d ago`;
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
    const [deleteTarget, setDeleteTarget] = useState(null); // { id, title }
    const [selectedIds, setSelectedIds] = useState(new Set());
    const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
    const selectAllRef = useRef(null);
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
        const handleClickOutside = () => {
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
        try {
            await api.put(`/api/documents/${docId}`, { folder: newFolder });
            
            // Persist the folder if it's new
            if (newFolder) {
                const savedFolders = JSON.parse(localStorage.getItem('persistent_folders') || '[]');
                if (!savedFolders.includes(newFolder)) {
                    localStorage.setItem('persistent_folders', JSON.stringify([...savedFolders, newFolder]));
                }
            }

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
            // Use local date string (YYYY-MM-DD) to avoid UTC timezone offset shifting the day
            const dateStr = date instanceof Date
                ? `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
                : date;
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

        // Get the current deadline for this doc to highlight it on the calendar
        const currentDoc = documents.find(d => d.id === docId);
        const selectedDate = currentDoc?.deadline
            ? (/^\d{4}-\d{2}-\d{2}$/.test(currentDoc.deadline)
                ? new Date(currentDoc.deadline + 'T00:00:00')  // YYYY-MM-DD → parse as local time
                : new Date(currentDoc.deadline))                // ISO string → parse directly
            : null;

        return (
            <div className="p-2">
                <div className="flex items-center justify-between mb-2">
                    <button 
                        onClick={(e) => { e.stopPropagation(); setCurrentMonth(subMonths(currentMonth, 1)); }}
                        className="p-0.5 hover:bg-slate-100 rounded text-slate-400 hover:text-slate-600 transition-all"
                    >
                        <ChevronLeftIcon className="w-3.5 h-3.5" />
                    </button>
                    <span className="text-xs font-bold text-slate-700 capitalize">
                        {format(currentMonth, 'MMM yyyy')}
                    </span>
                    <button 
                        onClick={(e) => { e.stopPropagation(); setCurrentMonth(addMonths(currentMonth, 1)); }}
                        className="p-0.5 hover:bg-slate-100 rounded text-slate-400 hover:text-slate-600 transition-all"
                    >
                        <ChevronRightIcon className="w-3.5 h-3.5" /> 
                    </button>
                </div>
                <div className="grid grid-cols-7 gap-0.5 text-center mb-0.5">
                    {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((day, i) => (
                        <div key={i} className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">{day}</div>
                    ))}
                </div>
                <div className="grid grid-cols-7 gap-0.5">
                    {calendarDays.map((day, idx) => {
                        const isSelected = selectedDate && isSameDay(day, selectedDate);
                        const isOutsideMonth = !isSameMonth(day, monthStart);
                        return (
                            <button
                                key={idx}
                                onClick={(e) => {
                                    e.stopPropagation();
                                    handleDeadlineUpdate(docId, day);
                                }}
                                className={`
                                    text-[10px] h-6 w-6 flex items-center justify-center rounded transition-all font-medium
                                    ${isOutsideMonth ? 'text-slate-200' : ''}
                                    ${!isOutsideMonth && !isSelected ? 'text-slate-600 hover:bg-emerald-50 hover:text-emerald-600' : ''}
                                    ${isSelected ? 'bg-emerald-500 text-white font-bold' : ''}
                                `}
                            >
                                {format(day, 'd')}
                            </button>
                        );
                    })}
                </div>
                <button 
                    onClick={(e) => { e.stopPropagation(); setViewMode('options'); }}
                    className="w-full mt-2 text-[10px] font-bold text-slate-400 hover:text-slate-600 transition-colors uppercase tracking-tight"
                >
                    ← Back
                </button>
            </div>
        );
    };

    const handleDelete = (e, doc) => {
        e.preventDefault();
        e.stopPropagation();
        setActiveActionsMenu(null);
        setDeleteTarget(doc);
    };

    const confirmDelete = async () => {
        if (!deleteTarget) return;
        try {
            await api.delete(`/api/documents/${deleteTarget.id}`);
            setDocuments(documents.filter(doc => doc.id !== deleteTarget.id));
            setSelectedIds(prev => { const n = new Set(prev); n.delete(deleteTarget.id); return n; });
            dispatchRefresh();
            toast.success('Document deleted successfully');
        } catch (error) {
            toast.error('Failed to delete document');
        } finally {
            setDeleteTarget(null);
        }
    };

    // ── Bulk selection helpers ──────────────────────────────────────
    const allFilteredIds = filteredDocs => filteredDocs.map(d => d.id);

    const toggleSelect = (e, id) => {
        e.stopPropagation();
        setSelectedIds(prev => {
            const n = new Set(prev);
            n.has(id) ? n.delete(id) : n.add(id);
            return n;
        });
    };

    const toggleSelectAll = (e) => {
        e.stopPropagation();
        const ids = filteredDocs.map(d => d.id);
        const allSelected = ids.every(id => selectedIds.has(id));
        setSelectedIds(allSelected ? new Set() : new Set(ids));
    };

    const confirmBulkDelete = async () => {
        const ids = [...selectedIds];
        try {
            await Promise.all(ids.map(id => api.delete(`/api/documents/${id}`)));
            setDocuments(prev => prev.filter(doc => !selectedIds.has(doc.id)));
            setSelectedIds(new Set());
            dispatchRefresh();
            toast.success(`${ids.length} document${ids.length > 1 ? 's' : ''} deleted`);
        } catch {
            toast.error('Failed to delete some documents');
        } finally {
            setBulkDeleteOpen(false);
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

    // Keep the indeterminate state of the select-all checkbox in sync
    useEffect(() => {
        if (!selectAllRef.current || filteredDocs.length === 0) return;
        const ids = filteredDocs.map(d => d.id);
        const count = ids.filter(id => selectedIds.has(id)).length;
        selectAllRef.current.indeterminate = count > 0 && count < ids.length;
        selectAllRef.current.checked = count === ids.length;
    });

    return (
        <div className="bg-white min-h-screen flex flex-col">
            {/* ── Header ── */}
            <div className="px-4 sm:px-6 py-3 sm:py-4 flex flex-col sm:flex-row sm:items-center gap-3 border-b border-slate-100">
                {/* Title or bulk-action bar */}
                <AnimatePresence mode="wait">
                    {selectedIds.size > 0 ? (
                        <motion.div
                            key="bulk"
                            initial={{ opacity: 0, y: -4 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -4 }}
                            className="flex items-center gap-3"
                        >
                            <span className="text-sm font-bold text-slate-700">
                                {selectedIds.size} selected
                            </span>
                            <button
                                onClick={() => setBulkDeleteOpen(true)}
                                className="flex items-center gap-1.5 bg-red-600 hover:bg-red-700 text-white px-3 py-1.5 rounded-lg text-sm font-bold transition-all shadow-sm"
                            >
                                <TrashIcon className="w-4 h-4" />
                                Delete selected
                            </button>
                            <button
                                onClick={() => setSelectedIds(new Set())}
                                className="text-sm font-medium text-slate-400 hover:text-slate-600 transition-colors"
                            >
                                Cancel
                            </button>
                        </motion.div>
                    ) : (
                        <motion.h1
                            key="title"
                            initial={{ opacity: 0, y: 4 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: 4 }}
                            className="text-xl font-bold text-slate-800 flex-shrink-0"
                        >
                            {folderFilter ? folderFilter : 'All documents'}
                        </motion.h1>
                    )}
                </AnimatePresence>

                {/* Controls: search + new button */}
                <div className="flex items-center gap-2 sm:gap-3 sm:ml-auto w-full sm:w-auto">
                    {/* Search */}
                    <div className="relative flex-1 sm:flex-initial">
                        <MagnifyingGlassIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
                        <input
                            type="text"
                            placeholder="Search documents..."
                            className="text-sm bg-slate-50 border-none rounded-lg pl-9 pr-4 py-2 w-full sm:w-56 focus:ring-2 focus:ring-emerald-500 transition-all font-medium"
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                        />
                    </div>
                    {/* New document */}
                    <button 
                        onClick={handleNewDocument}
                        className="flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white px-3 sm:px-4 py-2 rounded-lg text-sm font-bold transition-all shadow-sm whitespace-nowrap flex-shrink-0"
                    >
                        <PlusIcon className="w-4 h-4" />
                        <span className="hidden sm:inline">New</span>
                        <span className="sm:hidden">New</span>
                    </button>
                </div>
            </div>

            {/* ── Table (scrollable on small screens) ── */}
            <div className="flex-1 overflow-x-auto" style={{ WebkitOverflowScrolling: 'touch' }}>
                <table className="w-full text-left border-collapse" style={{ minWidth: '380px' }}>
                    <thead>
                        <tr className="border-b border-slate-100 bg-slate-50/50">
                            {/* Select-All Checkbox */}
                            <th className="px-3 sm:px-6 py-3 w-8 sm:w-10">
                                <input
                                    ref={selectAllRef}
                                    type="checkbox"
                                    onClick={toggleSelectAll}
                                    className="rounded border-slate-300 text-emerald-600 focus:ring-emerald-500 cursor-pointer"
                                />
                            </th>
                            {/* Name — always visible */}
                            <th className="px-3 sm:px-6 py-3 text-xs font-bold text-slate-500 uppercase tracking-wider">Name</th>
                            {/* Search Query — visible from sm */}
                            <th className="hidden sm:table-cell px-3 sm:px-6 py-3 text-xs font-bold text-slate-500 uppercase tracking-wider">Search Query</th>
                            {/* Edited — visible from md */}
                            <th className="hidden md:table-cell px-3 sm:px-6 py-3 text-xs font-bold text-slate-500 uppercase tracking-wider">Edited</th>
                            {/* Folder — visible from md */}
                            <th className="hidden md:table-cell px-3 sm:px-6 py-3 text-xs font-bold text-slate-500 uppercase tracking-wider">Folder</th>
                            {/* User — visible from lg */}
                            <th className="hidden lg:table-cell px-3 sm:px-6 py-3 text-xs font-bold text-slate-500 uppercase tracking-wider">User</th>
                            {/* Deadline — visible from md */}
                            <th className="hidden md:table-cell px-3 sm:px-6 py-3 text-xs font-bold text-slate-500 uppercase tracking-wider">Deadline</th>
                            {/* Actions */}
                            <th className="px-2 sm:px-3 py-3 w-8 sm:w-10"></th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-50">
                        {loading ? (
                            [...Array(5)].map((_, i) => (
                                <tr key={i} className="animate-pulse">
                                    <td className="px-3 sm:px-6 py-4"><div className="w-4 h-4 bg-slate-100 rounded" /></td>
                                    <td className="px-3 sm:px-6 py-4">
                                        <div className="h-4 bg-slate-100 rounded w-40 mb-1" />
                                        <div className="h-3 bg-slate-50 rounded w-28" />
                                    </td>
                                    <td className="hidden sm:table-cell px-3 sm:px-6 py-4"><div className="h-4 bg-slate-50 rounded w-32" /></td>
                                    <td className="hidden md:table-cell px-3 sm:px-6 py-4"><div className="h-4 bg-slate-50 rounded w-16" /></td>
                                    <td className="hidden md:table-cell px-3 sm:px-6 py-4"><div className="h-4 bg-slate-50 rounded w-20" /></td>
                                    <td className="hidden lg:table-cell px-3 sm:px-6 py-4"><div className="h-4 bg-slate-50 rounded w-24" /></td>
                                    <td className="hidden md:table-cell px-3 sm:px-6 py-4"><div className="h-4 bg-slate-50 rounded w-12" /></td>
                                    <td className="px-2 sm:px-3 py-4"></td>
                                </tr>
                            ))
                        ) : filteredDocs.map((doc) => (
                            <tr 
                                key={doc.id} 
                                onClick={() => navigate(`/documents/${doc.id}`)}
                                className={`transition-colors group cursor-pointer border-b border-slate-50 touch-manipulation ${
                                    selectedIds.has(doc.id)
                                        ? 'bg-emerald-50/60'
                                        : 'hover:bg-slate-50/80 active:bg-slate-100'
                                }`}
                            >
                                {/* Checkbox */}
                                <td className="px-3 sm:px-6 py-3.5 sm:py-4">
                                    <input
                                        type="checkbox"
                                        checked={selectedIds.has(doc.id)}
                                        onClick={(e) => toggleSelect(e, doc.id)}
                                        onChange={() => {}}
                                        className="rounded border-slate-300 text-emerald-600 focus:ring-emerald-500 cursor-pointer"
                                    />
                                </td>

                                {/* Name */}
                                <td className="px-3 sm:px-6 py-3.5 sm:py-4 max-w-[160px] sm:max-w-[220px] cursor-pointer">
                                    <div className="text-sm font-medium text-slate-800 group-hover:text-emerald-600 transition-colors line-clamp-2 leading-tight">
                                        {doc.title}
                                    </div>
                                    {/* Show "edited" inline on xs only */}
                                    <div className="md:hidden text-[11px] text-slate-400 font-medium mt-0.5">
                                        {formatTimeAgo(doc.updated_at)}
                                    </div>
                                </td>

                                {/* Search Query */}
                                <td className="hidden sm:table-cell px-3 sm:px-6 py-3.5 sm:py-4 max-w-[160px] cursor-pointer">
                                    <div className="text-xs text-slate-500 font-medium italic line-clamp-2 leading-snug lowercase">
                                        {doc.title.split(':').pop().trim()}
                                    </div>
                                </td>

                                {/* Edited */}
                                <td className="hidden md:table-cell px-3 sm:px-6 py-3.5 sm:py-4 cursor-pointer">
                                    <div className="text-xs text-slate-600 font-medium whitespace-nowrap">
                                        {formatTimeAgo(doc.updated_at)}
                                    </div>
                                </td>

                                {/* Folder */}
                                <td className="hidden md:table-cell px-3 sm:px-6 py-3.5 sm:py-4 whitespace-nowrap">
                                    <div className="relative">
                                        <button
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                setActiveFolderPopover(activeFolderPopover === doc.id ? null : doc.id);
                                            }}
                                            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg transition-all ml-[-8px] ${
                                                doc.folder 
                                                    ? 'text-emerald-700 bg-emerald-50 border border-emerald-100 hover:bg-emerald-100 hover:border-emerald-200 font-bold shadow-sm' 
                                                    : 'text-slate-400 hover:text-emerald-600 border border-dashed border-slate-200 hover:border-emerald-200 hover:bg-emerald-50'
                                            }`}
                                        >
                                            {doc.folder && <FolderIconSolid className="w-3.5 h-3.5 text-emerald-500/80" />}
                                            <span className="text-[12px] font-bold leading-none">
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
                                                    <div className="px-2.5 py-2.5 border-b border-slate-100 bg-slate-50/30 space-y-2.5">
                                                        {/* Search existing */}
                                                        <div className="relative">
                                                            <MagnifyingGlassIcon className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
                                                            <input 
                                                                type="text"
                                                                autoFocus
                                                                placeholder="Search folders..."
                                                                value={folderSearch}
                                                                onChange={(e) => setFolderSearch(e.target.value)}
                                                                className="w-full pl-8 pr-3 py-1.5 text-[12px] bg-white border border-slate-200 rounded-lg focus:ring-1 focus:ring-emerald-500 focus:border-emerald-500 outline-none text-slate-600 transition-all"
                                                            />
                                                        </div>

                                                        {/* Create new */}
                                                        <div className="flex items-center gap-2">
                                                            <input 
                                                                type="text"
                                                                placeholder="New folder..."
                                                                className="flex-1 min-w-0 bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 text-[12px] outline-none focus:ring-1 focus:ring-emerald-500 focus:border-emerald-500 transition-all font-medium"
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
                                                                className="p-1.5 bg-emerald-50 text-emerald-600 hover:bg-emerald-100 rounded-lg transition-colors border border-emerald-100/50"
                                                            >
                                                                <PlusIconSolid className="w-4 h-4" />
                                                            </button>
                                                        </div>
                                                    </div>

                                                    <div className="max-h-[220px] overflow-y-auto py-1 scrollbar-thin scrollbar-thumb-slate-200">
                                                        {(() => {
                                                            const documentFolders = documents.map(d => d.folder).filter(Boolean);
                                                            const savedFolders = JSON.parse(localStorage.getItem('persistent_folders') || '[]');
                                                            const allUniqueFolders = [...new Set([...documentFolders, ...savedFolders])].sort();
                                                            
                                                            return allUniqueFolders
                                                                .filter(f => f.toLowerCase().includes(folderSearch.toLowerCase()))
                                                                .map((folder) => (
                                                                <button 
                                                                    key={folder}
                                                                    onClick={() => handleFolderUpdate(doc.id, folder === doc.folder ? null : folder)}
                                                                    className="w-full flex items-center justify-between gap-2.5 px-3 py-2 text-[13px] text-slate-600 hover:bg-emerald-50 hover:text-emerald-700 transition-colors text-left group/item"
                                                                >
                                                                    <div className="flex items-center gap-2.5">
                                                                        <FolderIconSolid className={`w-4 h-4 transition-colors ${doc.folder === folder ? 'text-emerald-500' : 'text-slate-400 group-hover/item:text-emerald-500'}`} />
                                                                        <span className={doc.folder === folder ? 'font-bold' : ''}>{folder}</span>
                                                                    </div>
                                                                    {doc.folder === folder && (
                                                                        <CheckIcon className="w-4 h-4 text-emerald-500" />
                                                                    )}
                                                                </button>
                                                            ));
                                                        })()}
                                                        
                                                        {folderSearch && ![...new Set(documents.map(d => d.folder).filter(Boolean))].some(f => f.toLowerCase() === folderSearch.toLowerCase()) && (
                                                            <div className="px-3 py-4 text-center">
                                                                <p className="text-[11px] text-slate-400 italic">No matching folders</p>
                                                            </div>
                                                        )}
                                                    </div>
                                                </motion.div>
                                            )}
                                        </AnimatePresence>
                                    </div>
                                </td>

                                {/* User */}
                                <td className="hidden lg:table-cell px-3 sm:px-6 py-3.5 sm:py-4 cursor-pointer">
                                    <div className="text-xs font-semibold text-slate-700 whitespace-nowrap">
                                        {user?.name || 'Alexander Lambie'}
                                    </div>
                                </td>

                                {/* Deadline */}
                                <td className="hidden md:table-cell px-3 sm:px-6 py-3.5 sm:py-4 cursor-pointer relative text-left">
                                    <button 
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            setActiveDeadlinePopover(activeDeadlinePopover === doc.id ? null : doc.id);
                                        }}
                                        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg transition-all ml-[-8px] ${
                                            doc.deadline
                                                ? 'text-slate-700 bg-slate-100 hover:bg-slate-200 border border-slate-200/60 font-bold shadow-sm'
                                                : 'text-slate-400 hover:text-slate-600 border border-dashed border-slate-200 hover:border-slate-300 font-bold'
                                        }`}
                                    >
                                        <span className="text-[12px] font-bold leading-none">
                                            {doc.deadline ? (
                                                <span className="flex items-center gap-1">
                                                    <CalendarIconSolid className="w-3.5 h-3.5 text-slate-500/80" />
                                                    {(/^\d{4}-\d{2}-\d{2}$/.test(doc.deadline)
                                                        ? new Date(doc.deadline + 'T00:00:00')
                                                        : new Date(doc.deadline)
                                                    ).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
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
                                                className="absolute left-[-14px] top-full mt-[-1px] w-44 bg-white rounded-xl shadow-xl border border-slate-100 z-[100] overflow-hidden"
                                                onClick={(e) => e.stopPropagation()}
                                            >
                                                {viewMode === 'calendar' ? (
                                                    renderCalendar(doc.id)
                                                ) : (
                                                    <div className="p-1.5">
                                                        {getDeadlineOptions().map((opt, i) => (
                                                            opt.label === 'Custom...' ? (
                                                                <button 
                                                                    key={i}
                                                                    className="w-full flex items-center justify-between px-3 py-2 hover:bg-slate-50 cursor-pointer text-xs font-bold text-slate-700 transition-colors rounded-lg text-left group"
                                                                    onClick={(e) => {
                                                                        e.stopPropagation();
                                                                        setViewMode('calendar');
                                                                    }}
                                                                >
                                                                    <div className="flex items-center gap-2">
                                                                        <CalendarDaysIcon className="w-3.5 h-3.5 text-slate-400 group-hover:text-emerald-500 transition-colors" />
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
                                                                    className="w-full flex items-center justify-between px-3 py-2 hover:bg-slate-50 text-xs font-bold text-slate-700 transition-colors group rounded-lg text-left"
                                                                >
                                                                    <div className="flex items-center gap-2">
                                                                        <CalendarDaysIcon className="w-3.5 h-3.5 text-slate-400 group-hover:text-emerald-500 transition-colors" />
                                                                        <span>{opt.label}</span>
                                                                    </div>
                                                                    <span className="text-slate-400 text-[11px] font-medium group-hover:text-slate-600 transition-colors">{opt.dateLabel}</span>
                                                                </button>
                                                            )
                                                        ))}
                                                    </div>
                                                )}
                                            </motion.div>
                                        )}
                                    </AnimatePresence>
                                </td>

                                {/* Actions ⋯ */}
                                <td className="pl-2 pr-2 sm:pl-4 sm:pr-2 py-3.5 sm:py-4 text-right cursor-pointer" onClick={(e) => e.stopPropagation()}>
                                    <div className="flex items-center justify-end relative">
                                        <button 
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                setActiveActionsMenu(activeActionsMenu === doc.id ? null : doc.id);
                                            }}
                                            className={`p-2 touch-manipulation transition-colors cursor-pointer rounded-lg ${activeActionsMenu === doc.id ? 'text-slate-900 bg-slate-100' : 'text-slate-400 hover:text-slate-900 active:bg-slate-100'}`}
                                        >
                                            <EllipsisHorizontalIcon className="w-5 h-5" />
                                        </button>

                                        <AnimatePresence>
                                            {activeActionsMenu === doc.id && (
                                                <motion.div 
                                                    initial={{ opacity: 0, scale: 0.95, y: -5 }}
                                                    animate={{ opacity: 1, scale: 1, y: 0 }}
                                                    exit={{ opacity: 0, scale: 0.95, y: -5 }}
                                                    className="absolute right-0 top-full mt-0.5 w-[160px] bg-white rounded-2xl shadow-[0_10px_38px_-10px_rgba(22,23,24,0.35),0_10px_20px_-15px_rgba(22,23,24,0.2)] border border-slate-100 z-[110] overflow-hidden p-1 text-left"
                                                >
                                                    <button 
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            window.open(`/documents/${doc.id}`, '_blank');
                                                            setActiveActionsMenu(null);
                                                        }}
                                                        className="w-full flex items-center px-2 py-2 sm:py-1.5 text-[13px] font-medium text-slate-700 hover:bg-slate-50 active:bg-slate-100 rounded-xl transition-colors text-left touch-manipulation"
                                                    >
                                                        Open in new tab
                                                    </button>
                                                    
                                                    <div className="h-[1px] bg-slate-50 my-1 mx-1" />

                                                    <button 
                                                        onClick={(e) => handleDelete(e, doc)}
                                                        className="w-full flex items-center gap-2 px-2 py-2 sm:py-1.5 text-[13px] font-bold text-red-500 hover:bg-red-50 active:bg-red-100 rounded-xl transition-colors text-left touch-manipulation"
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
                    <div className="flex flex-col items-center justify-center p-10 sm:p-20 text-center">
                        <div className="w-14 h-14 sm:w-16 sm:h-16 bg-slate-50 text-slate-300 flex items-center justify-center rounded-2xl mb-4">
                            <DocumentTextIcon className="w-7 h-7 sm:w-8 sm:h-8" />
                        </div>
                        <h3 className="text-base sm:text-lg font-bold text-slate-800 mb-1">No documents found</h3>
                        <p className="text-slate-500 text-sm max-w-xs sm:max-w-sm">
                            {searchTerm ? 'Try adjusting your search query.' : "You haven't created any documents yet."}
                        </p>
                    </div>
                )}
            </div>

            <ConfirmDialog
                isOpen={!!deleteTarget}
                onClose={() => setDeleteTarget(null)}
                onConfirm={confirmDelete}
                title="Delete document"
                message={`Are you sure you want to delete "${deleteTarget?.title}"? This action cannot be undone.`}
                confirmText="Delete"
                cancelText="Cancel"
            />

            <ConfirmDialog
                isOpen={bulkDeleteOpen}
                onClose={() => setBulkDeleteOpen(false)}
                onConfirm={confirmBulkDelete}
                title={`Delete ${selectedIds.size} document${selectedIds.size > 1 ? 's' : ''}`}
                message={`Are you sure you want to permanently delete ${selectedIds.size} selected document${selectedIds.size > 1 ? 's' : ''}? This action cannot be undone.`}
                confirmText={`Delete ${selectedIds.size}`}
                cancelText="Cancel"
            />
        </div>
    );
}

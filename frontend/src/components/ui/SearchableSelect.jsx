import { useState, useEffect, useRef, useId } from 'react';
import { ChevronDownIcon, MagnifyingGlassIcon } from '@heroicons/react/24/outline';

/**
 * Searchable combobox that replaces a plain <select> for long option lists.
 * Props:
 *   options  — array of { value, label }
 *   value    — currently selected value string
 *   onChange — called with the new value string
 *   disabled — boolean
 *   placeholder — shown in the search input when open
 *   className — extra classes on the trigger button
 */
export default function SearchableSelect({
    options = [],
    value,
    onChange,
    disabled = false,
    placeholder = 'Search…',
    className = '',
}) {
    const id = useId();
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState('');
    const containerRef = useRef(null);
    const inputRef = useRef(null);
    const listRef = useRef(null);
    const [cursor, setCursor] = useState(-1);

    const selected = options.find((o) => o.value === value);

    const filtered = query.trim()
        ? options.filter((o) => o.label.toLowerCase().includes(query.toLowerCase()))
        : options;

    // Close on outside click
    useEffect(() => {
        if (!open) return;
        const handler = (e) => {
            if (containerRef.current && !containerRef.current.contains(e.target)) {
                setOpen(false);
            }
        };
        window.addEventListener('mousedown', handler);
        return () => window.removeEventListener('mousedown', handler);
    }, [open]);

    // Focus search input when opened
    useEffect(() => {
        if (open) {
            inputRef.current?.focus();
            setCursor(-1);
        } else {
            setQuery('');
        }
    }, [open]);

    const pick = (opt) => {
        onChange(opt.value);
        setOpen(false);
    };

    const onKey = (e) => {
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            setCursor((c) => Math.min(c + 1, filtered.length - 1));
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setCursor((c) => Math.max(c - 1, 0));
        } else if (e.key === 'Enter') {
            e.preventDefault();
            if (cursor >= 0 && filtered[cursor]) pick(filtered[cursor]);
        } else if (e.key === 'Escape') {
            setOpen(false);
        }
    };

    // Scroll active item into view
    useEffect(() => {
        if (cursor < 0 || !listRef.current) return;
        const el = listRef.current.children[cursor];
        el?.scrollIntoView({ block: 'nearest' });
    }, [cursor]);

    return (
        <div className={`relative ${className}`} ref={containerRef}>
            {/* Trigger */}
            <button
                type="button"
                id={id}
                disabled={disabled}
                onClick={() => setOpen((o) => !o)}
                className="h-9 px-3 text-[13px] font-medium text-slate-700 bg-slate-50 border border-slate-200 rounded-lg focus:bg-white focus:border-indigo-400 focus:outline-none flex items-center justify-between gap-2 min-w-[260px] w-full disabled:opacity-50"
            >
                <span className="truncate">{selected ? selected.label : placeholder}</span>
                <ChevronDownIcon className={`w-4 h-4 text-slate-400 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
            </button>

            {/* Dropdown */}
            {open && (
                <div className="absolute left-0 top-full mt-1 z-50 w-full min-w-[280px] bg-white rounded-xl border border-slate-200 shadow-xl overflow-hidden">
                    {/* Search input */}
                    <div className="p-2 border-b border-slate-100 flex items-center gap-2">
                        <MagnifyingGlassIcon className="w-4 h-4 text-slate-400 shrink-0" aria-hidden="true" />
                        <input
                            ref={inputRef}
                            type="text"
                            value={query}
                            onChange={(e) => { setQuery(e.target.value); setCursor(-1); }}
                            onKeyDown={onKey}
                            placeholder={placeholder}
                            className="flex-1 text-[13px] text-slate-700 bg-transparent outline-none placeholder:text-slate-400"
                        />
                        {query && (
                            <button
                                type="button"
                                onClick={() => setQuery('')}
                                className="text-slate-400 hover:text-slate-600 text-[11px] shrink-0"
                            >
                                Clear
                            </button>
                        )}
                    </div>

                    {/* Options list */}
                    <ul
                        ref={listRef}
                        role="listbox"
                        className="max-h-56 overflow-y-auto py-1"
                    >
                        {filtered.length === 0 ? (
                            <li className="px-3 py-3 text-[13px] text-slate-400 text-center">No matches</li>
                        ) : (
                            filtered.map((opt, idx) => (
                                <li
                                    key={opt.value}
                                    role="option"
                                    aria-selected={opt.value === value}
                                    onClick={() => pick(opt)}
                                    className={`px-3 py-2 text-[13px] cursor-pointer truncate transition-colors
                                        ${opt.value === value ? 'font-semibold text-indigo-600 bg-indigo-50' : 'text-slate-700'}
                                        ${cursor === idx ? 'bg-slate-100' : 'hover:bg-slate-50'}`}
                                >
                                    {opt.label}
                                </li>
                            ))
                        )}
                    </ul>

                    {filtered.length > 0 && (
                        <div className="px-3 py-1.5 border-t border-slate-100 text-[11px] text-slate-400">
                            {filtered.length} of {options.length} properties
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

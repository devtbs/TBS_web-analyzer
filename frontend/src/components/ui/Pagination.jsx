import { ChevronLeftIcon, ChevronRightIcon } from '@heroicons/react/24/outline';

export default function Pagination({ page, totalPages, from, to, total, onPageChange, className = '' }) {
    if (totalPages <= 1) return null;

    return (
        <div className={`sticky bottom-0 z-10 flex items-center justify-between gap-4 px-5 py-3 bg-white border-t border-slate-100 ${className}`}>
            <span className="text-[12px] text-slate-500 shrink-0">
                Showing <strong className="text-slate-700">{from}–{to}</strong> of <strong className="text-slate-700">{total}</strong>
            </span>
            <div className="flex items-center gap-1">
                <button
                    onClick={() => onPageChange(page - 1)}
                    disabled={page <= 1}
                    className="w-7 h-7 flex items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                    aria-label="Previous page"
                >
                    <ChevronLeftIcon className="w-4 h-4" />
                </button>
                <span className="text-[12px] font-semibold text-slate-600 px-2">
                    {page} / {totalPages}
                </span>
                <button
                    onClick={() => onPageChange(page + 1)}
                    disabled={page >= totalPages}
                    className="w-7 h-7 flex items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                    aria-label="Next page"
                >
                    <ChevronRightIcon className="w-4 h-4" />
                </button>
            </div>
        </div>
    );
}

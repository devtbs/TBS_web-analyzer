import { useState, useMemo } from 'react';

export function usePagination(items, pageSize = 10) {
    const [page, setPage] = useState(1);

    const totalPages = Math.max(1, Math.ceil((items?.length || 0) / pageSize));
    const safePage = Math.min(page, totalPages);

    const from = (safePage - 1) * pageSize + 1;
    const to = Math.min(safePage * pageSize, items?.length || 0);

    const pageItems = useMemo(() => {
        const list = items || [];
        return list.slice((safePage - 1) * pageSize, safePage * pageSize);
    }, [items, safePage, pageSize]);

    // Reset to page 1 when items change significantly (e.g. new filter)
    const reset = () => setPage(1);

    return { page: safePage, setPage, pageItems, totalPages, from, to, total: items?.length || 0, reset };
}

/**
 * Shared table-export helpers, lifted from the previously-duplicated
 * `handleDownloadCSV` that lived in 5 page components.
 *
 * `data` is an array of flat row objects; column headers are taken from the
 * keys of the first row.
 *
 * NOTE: `xlsx` is heavy (~885KB in the vendor-export chunk). It is loaded
 * on-demand via dynamic import() inside downloadXLSX so it stays off the
 * initial page load — only fetched when the user actually exports.
 */

/** Drop nested object/array fields so a row maps cleanly to one CSV/XLSX row. */
const flattenRows = (data) =>
    data.map((r) => {
        const o = {};
        for (const [k, v] of Object.entries(r)) {
            if (v !== null && (Array.isArray(v) || typeof v === 'object')) continue;
            o[k] = v;
        }
        return o;
    });

/** Download an array of row objects as a CSV file. */
export const downloadCSV = (data, filename) => {
    if (!data || !data.length) return;
    const rows = flattenRows(data);
    const headers = Object.keys(rows[0]);
    const csvContent = [
        headers.join(','),
        ...rows.map((row) =>
            headers
                .map((header) => {
                    let val = row[header];
                    if (typeof val === 'string') return `"${val.replace(/"/g, '""')}"`;
                    return val;
                })
                .join(',')
        ),
    ].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.setAttribute('download', filename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(link.href);
};

/** Download an array of row objects as a real .xlsx workbook. Loads xlsx on demand. */
export const downloadXLSX = async (data, filename, sheetName = 'Sheet1') => {
    if (!data || !data.length) return;
    const XLSX = await import('xlsx');
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, sheetName);
    XLSX.writeFile(wb, filename);
};

// Back-compat alias matching the old per-page function name.
export const handleDownloadCSV = downloadCSV;

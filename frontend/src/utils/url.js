/* Display-only URL prettifier: strip scheme + leading www., trim a trailing slash, and
   percent-decode so non-ASCII paths (Thai, Arabic, …) are readable. The raw URL is kept
   as the canonical value elsewhere — this is purely for display. */
export function prettyUrl(url) {
    if (!url) return '';
    const stripped = url.replace(/^https?:\/\/(www\.)?/i, '').replace(/\/$/, '');
    try {
        return decodeURIComponent(stripped);
    } catch {
        return stripped;
    }
}

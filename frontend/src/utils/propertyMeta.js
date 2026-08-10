/**
 * A GSC property string is one of three genuinely different things that must NOT be conflated:
 *   sc-domain:example.com      → a Domain property (all schemes + subdomains)
 *   https://www.example.com/   → a URL-prefix property (this exact origin)
 *   http://example.com/        → a *different* URL-prefix property
 * They carry different data, so the UI has to tell them apart. `propertyMeta` returns a display
 * label that PRESERVES scheme / www / path, a bare domain (for favicon + matching only), and a
 * short colored tag so two entries that share a bare domain are still distinguishable at a glance.
 */
export function propertyMeta(property) {
    const raw = String(property || '');
    if (!raw) return { text: '', domain: '', type: 'domain', tag: '', tagCls: '' };

    if (raw.startsWith('sc-domain:')) {
        const d = raw.slice('sc-domain:'.length);
        return { text: d, domain: d, type: 'domain', tag: 'Domain', tagCls: TAG.Domain };
    }
    try {
        const u = new URL(raw);
        const host = u.host;                       // keeps www.
        const path = u.pathname.replace(/\/+$/, ''); // trailing slash is noise
        const domain = u.hostname.replace(/^www\./, '');
        const isHttp = u.protocol === 'http:';
        const isWww = host.startsWith('www.');
        // Label preserves what makes THIS property distinct from its siblings.
        let text = host + path;
        if (isHttp) text = 'http://' + text;
        const tag = isHttp ? 'HTTP' : isWww ? 'www' : path ? 'Path' : 'HTTPS';
        return { text, domain, type: 'url', tag, tagCls: TAG[tag] || TAG.HTTPS };
    } catch {
        return { text: raw, domain: raw, type: 'url', tag: '', tagCls: '' };
    }
}

const TAG = {
    Domain: 'bg-amber-100 text-amber-700',
    HTTPS:  'bg-emerald-100 text-emerald-700',
    HTTP:   'bg-red-100 text-red-600',
    www:    'bg-indigo-100 text-indigo-700',
    Path:   'bg-sky-100 text-sky-700',
};

/* Dark-sidebar variants of the same tags (readable on the navy panel). */
export const TAG_DARK = {
    Domain: 'bg-amber-400/15 text-amber-300',
    HTTPS:  'bg-emerald-400/15 text-emerald-300',
    HTTP:   'bg-red-400/15 text-red-300',
    www:    'bg-indigo-400/20 text-indigo-300',
    Path:   'bg-sky-400/15 text-sky-300',
};

/* Deterministic pleasant color from a string — for the letter-avatar fallback. */
export function avatarColor(seed) {
    const s = String(seed || '');
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360;
    return `hsl(${h} 55% 45%)`;
}

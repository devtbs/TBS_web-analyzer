import { useState } from 'react';
import { avatarColor } from '../../utils/propertyMeta';

/**
 * Site favicon with a graceful fallback. When Google has no icon for a domain (common for
 * sc-domain properties and less-indexed sites) we render a colored letter-avatar instead of a
 * generic globe, so every property stays visually distinct at a glance. Pass `label` (a domain or
 * name) to seed the letter + color; falls back to the url.
 */
const Favicon = ({ url, label, size = 16, className = "" }) => {
    const [err, setErr] = useState(false);

    const seed = (label || url || '').replace(/^https?:\/\/(www\.)?/, '').replace(/^sc-domain:/, '');
    const letter = (seed.trim()[0] || '?').toUpperCase();

    if (!url || err) {
        return (
            <span
                className={`inline-flex items-center justify-center flex-shrink-0 font-bold text-white select-none ${className}`}
                style={{ width: size, height: size, background: avatarColor(seed), fontSize: size * 0.55, borderRadius: Math.max(3, size * 0.22) }}
                aria-hidden="true"
            >
                {letter}
            </span>
        );
    }

    const domain = url.replace(/^https?:\/\/(www\.)?/, '').split('/')[0].replace(/^sc-domain:/, '');
    const faviconUrl = `https://www.google.com/s2/favicons?domain=${domain}&sz=64`;

    return (
        <img
            src={faviconUrl}
            alt=""
            className={`flex-shrink-0 object-contain ${className}`}
            style={{ width: size, height: size }}
            onError={() => setErr(true)}
        />
    );
};

export default Favicon;

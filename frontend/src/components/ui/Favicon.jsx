import { useState } from 'react';
import { GlobeAltIcon } from '@heroicons/react/24/outline';

const Favicon = ({ url, size = 16, className = "" }) => {
    const [err, setErr] = useState(false);
    
    if (!url || err) {
        return <GlobeAltIcon className={`flex-shrink-0 ${className}`} style={{ width: size, height: size }} />;
    }

    const domain = url.replace(/^https?:\/\/(www\.)?/, '').split('/')[0];
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

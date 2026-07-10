import { useEffect, useState } from 'react';
import api from '../api/axios';

/* Standalone page Bing redirects the OAuth popup to.
   Reads ?code=, exchanges it via /auth/bing/connect, notifies the opener, and closes. */
const BingCallback = () => {
    const [msg, setMsg] = useState('Connecting your Bing account…');

    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        const code = params.get('code');
        const error = params.get('error');
        const redirectUri = `${window.location.origin}/bing-callback`;

        const finish = (payload) => {
            try { window.opener?.postMessage(payload, window.location.origin); } catch { /* no opener */ }
            setTimeout(() => window.close(), 400);
        };

        if (error || !code) {
            setMsg('Connection cancelled.');
            finish({ type: 'bing-connect-error', error: error || 'no_code' });
            return;
        }

        api.post('/auth/bing/connect', { code, redirect_uri: redirectUri })
            .then((res) => {
                setMsg('Connected! You can close this window.');
                finish({ type: 'bing-connected', account: res.data });
            })
            .catch((err) => {
                const detail = err.response?.data?.detail || 'Failed to connect.';
                setMsg(detail);
                finish({ type: 'bing-connect-error', error: detail });
            });
    }, []);

    return (
        <div className="min-h-screen flex items-center justify-center bg-slate-50">
            <div className="flex flex-col items-center gap-4 text-center px-8">
                <div className="w-10 h-10 border-4 border-slate-200 border-t-[#008373] rounded-full animate-spin" />
                <p className="text-sm font-semibold text-slate-600">{msg}</p>
            </div>
        </div>
    );
};

export default BingCallback;

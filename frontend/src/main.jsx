import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './index.css'

// After a deploy the chunk filenames change; a tab still holding the old index.html requests a
// chunk that no longer exists, so a lazy route fails to load and renders a blank page. Recover by
// reloading once to pull the fresh bundle (guarded so a genuinely-missing chunk can't loop forever).
function recoverFromStaleChunk() {
    const KEY = 'chunk-reload-at';
    const last = Number(sessionStorage.getItem(KEY) || 0);
    if (Date.now() - last < 10000) return;   // already reloaded very recently — don't loop
    sessionStorage.setItem(KEY, String(Date.now()));
    window.location.reload();
}
window.addEventListener('vite:preloadError', (e) => { e.preventDefault(); recoverFromStaleChunk(); });
window.addEventListener('unhandledrejection', (e) => {
    const msg = String(e?.reason?.message || e?.reason || '');
    if (/dynamically imported module|Importing a module script failed|Failed to fetch/i.test(msg)) {
        recoverFromStaleChunk();
    }
});

ReactDOM.createRoot(document.getElementById('root')).render(
    <React.StrictMode>
        <App />
    </React.StrictMode>,
)

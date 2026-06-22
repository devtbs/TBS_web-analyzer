import { lazy, Suspense, useState, useRef, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation, Outlet } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { motion } from 'framer-motion';
import { AuthProvider, useAuth } from './context/AuthContext';
import { Bars3Icon } from '@heroicons/react/24/outline';

import Header from './components/layout/Header';
import Sidebar from './components/layout/Sidebar';
import Footer from './components/layout/Footer';

// Home is the public landing page (first paint when logged out) — keep it eager.
import Home from './pages/Home';

// All protected pages are code-split: each page and its heavy libraries (xlsx, tiptap,
// force-graph, recharts, jspdf, …) only download when that route is actually visited.
const MySites = lazy(() => import('./pages/MySites'));
const NewAnalysis = lazy(() => import('./pages/NewAnalysis'));
const History = lazy(() => import('./pages/History'));
const Results = lazy(() => import('./pages/Results'));
const PageSelector = lazy(() => import('./pages/PageSelector'));
const SEOAnalytics = lazy(() => import('./pages/SEOAnalytics'));
const GA4Analytics = lazy(() => import('./pages/GA4Analytics'));
const GoogleAdsAnalytics = lazy(() => import('./pages/GoogleAdsAnalytics'));
const CountriesPage = lazy(() => import('./pages/CountriesPage'));
const NewLostRankingsPage = lazy(() => import('./pages/NewLostRankingsPage'));
const PagesPage = lazy(() => import('./pages/PagesPage'));
const QueriesPage = lazy(() => import('./pages/QueriesPage'));
const StrikingDistancePage = lazy(() => import('./pages/StrikingDistancePage'));
const CtrOpportunitiesPage = lazy(() => import('./pages/CtrOpportunitiesPage'));
const QueryDecayPage = lazy(() => import('./pages/QueryDecayPage'));
const CannibalizationPage = lazy(() => import('./pages/CannibalizationPage'));
const TopicClustersPage = lazy(() => import('./pages/TopicClustersPage'));
const GlobalReports = lazy(() => import('./pages/GlobalReports'));
const Documents = lazy(() => import('./pages/Documents'));
const DocumentDetail = lazy(() => import('./pages/DocumentDetail'));
const Presentation = lazy(() => import('./pages/Presentation'));

/* Lightweight fallback shown while a lazily-loaded page chunk downloads. */
const PageSpinner = () => (
    <div className="flex items-center justify-center py-32">
        <div className="w-10 h-10 border-4 border-slate-200 border-t-indigo-600 rounded-full animate-spin" />
    </div>
);

/* ── Protected Route ─────────────────────────────────────── */
/* ── Persistent Layout for Authenticated Pages ─────────── */
const ProtectedLayout = () => {
    const { user, loading } = useAuth();
    const location = useLocation();
    const [mobileOpen, setMobileOpen] = useState(false);
    const mainRef = useRef(null);

    // iOS Safari ignores overflow:hidden on nested elements — must block touchmove directly
    useEffect(() => {
        const el = mainRef.current;
        if (!el) return;
        const prevent = (e) => e.preventDefault();
        if (mobileOpen) {
            el.addEventListener('touchmove', prevent, { passive: false });
        }
        return () => el.removeEventListener('touchmove', prevent);
    }, [mobileOpen]);

    // If loading, render the sidebar and a spinner in the content area
    // This maintains layout stability and prevents "flashing" on reload
    if (loading) {
        return (
            <div className="flex h-screen overflow-hidden bg-[#1a1d2e]">
                <Sidebar mobileOpen={false} onMobileClose={() => {}} />
                <div className="flex-1 bg-slate-50 flex items-center justify-center">
                    <div className="flex flex-col items-center gap-6 max-w-xs text-center p-8">
                        <div className="relative">
                            <div className="w-12 h-12 border-4 border-slate-200 border-t-indigo-600 rounded-full animate-spin" />
                            <div className="absolute inset-0 flex items-center justify-center">
                                <div className="w-2 h-2 bg-indigo-600 rounded-full animate-ping" />
                            </div>
                        </div>
                        <div className="space-y-2">
                            <p className="text-slate-800 font-bold text-lg">Checking credentials...</p>
                            <p className="text-slate-500 text-sm">Validating your session with the server. This may take a moment if the server is waking up.</p>
                        </div>
                        
                        {/* Escape hatch for users if it takes too long */}
                        <div className="pt-4 flex flex-col gap-3 w-full">
                            <button 
                                onClick={() => window.location.reload()}
                                className="text-sm font-semibold text-indigo-600 hover:text-indigo-700 bg-indigo-50 px-4 py-2 rounded-lg transition-colors"
                            >
                                Manual Refresh
                            </button>
                            <button 
                                onClick={() => {
                                    localStorage.removeItem('access_token');
                                    window.location.href = '/';
                                }}
                                className="text-sm font-medium text-slate-400 hover:text-red-500 transition-colors"
                            >
                                Stuck? Sign out and try again
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    if (!user) return <Navigate to="/" replace />;

    return (
        <div className="flex h-screen overflow-hidden bg-slate-50">
            <Sidebar mobileOpen={mobileOpen} onMobileClose={() => setMobileOpen(false)} />
            <div className="flex-1 flex flex-col overflow-hidden">
                {/* Mobile top bar — only shown on small screens */}
                <div className="md:hidden flex items-center justify-between px-4 h-14 bg-[#1e293b] flex-shrink-0 z-30 sticky top-0">
                    <button
                        onClick={() => setMobileOpen(true)}
                        className="w-9 h-9 flex items-center justify-center rounded-lg bg-white/10 text-slate-300 hover:bg-white/20 transition-colors"
                    >
                        <Bars3Icon className="w-5 h-5" />
                    </button>
                    <img src="/TBS-Logo.webp" alt="TBS Logo" className="h-8 w-auto object-contain" />
                    <div className="w-9" /> {/* spacer to center logo */}
                </div>
                <main ref={mainRef} className={`flex-1 ${mobileOpen ? 'overflow-y-hidden' : 'overflow-y-auto'}`}>
                    <motion.div
                        key={location.pathname}
                        initial={{ opacity: 0, y: 15 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.3, ease: 'easeOut' }}
                        className="min-h-full"
                    >
                        <Suspense fallback={<PageSpinner />}>
                            <Outlet />
                        </Suspense>
                    </motion.div>
                </main>
            </div>
        </div>
    );
};

/* ── Public layout (Home page) ───────────────────────────── */
const PublicLayout = ({ children }) => {
    const { user, loading } = useAuth();
    
    if (loading) return null;
    if (user) return <Navigate to="/my-sites" replace />;
    
    return (
        <div className="min-h-screen flex flex-col">
            <Header />
            <main className="flex-1 flex flex-col">
                {children}
            </main>
            <Footer />
        </div>
    );
};

/* ── App routing ─────────────────────────────────────────── */
function AppContent() {
    return (
        <>
            <Routes>
                {/* Public pages — top header + footer */}
                <Route path="/" element={<PublicLayout><Home /></PublicLayout>} />

                {/* All protected pages share the same Layout wrapper */}
                <Route element={<ProtectedLayout />}>
                    <Route path="/my-sites" element={<MySites />} />
                    <Route path="/dashboard" element={<Navigate to="/my-sites" replace />} />
                    <Route path="/global-reports" element={<GlobalReports />} />
                    <Route path="/seo-analytics" element={<SEOAnalytics />} />
                    <Route path="/ga4-analytics" element={<GA4Analytics />} />
                    <Route path="/google-ads" element={<GoogleAdsAnalytics />} />
                    <Route path="/seo-analytics/countries" element={<CountriesPage />} />
                    <Route path="/seo-analytics/new-lost-rankings" element={<NewLostRankingsPage />} />
                    <Route path="/seo-analytics/pages" element={<PagesPage />} />
                    <Route path="/seo-analytics/queries" element={<QueriesPage />} />
                    <Route path="/seo-analytics/striking-distance" element={<StrikingDistancePage />} />
                    <Route path="/seo-analytics/ctr-opportunities" element={<CtrOpportunitiesPage />} />
                    <Route path="/seo-analytics/query-decay" element={<QueryDecayPage />} />
                    <Route path="/seo-analytics/cannibalization" element={<CannibalizationPage />} />
                    <Route path="/seo-analytics/topic-clusters" element={<TopicClustersPage />} />
                    <Route path="/new-analysis" element={<NewAnalysis />} />
                    <Route path="/history" element={<History />} />
                    <Route path="/select-pages" element={<PageSelector />} />
                    <Route path="/results/:analysisId" element={<Results />} />
                    <Route path="/documents" element={<Documents />} />
                    <Route path="/documents/:documentId" element={<DocumentDetail />} />
                    <Route path="/presentation" element={<Presentation />} />
                </Route>
            </Routes>
            
            <Toaster
                position="top-right"
                toastOptions={{
                    duration: 4000,
                    style: {
                        background: '#1e293b',
                        color: '#fff',
                        border: '1px solid rgba(139,92,246,0.2)',
                        borderRadius: '12px',
                        fontSize: '14px',
                        fontWeight: '600',
                    },
                    success: {
                        iconTheme: { primary: '#10b981', secondary: '#fff' },
                    },
                    error: {
                        iconTheme: { primary: '#ef4444', secondary: '#fff' },
                    },
                }}
            />
        </>
    );
}

function App() {
    return (
        <BrowserRouter>
            <AuthProvider>
                <AppContent />
            </AuthProvider>
        </BrowserRouter>
    );
}

export default App;

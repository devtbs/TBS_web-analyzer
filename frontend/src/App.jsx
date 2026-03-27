import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation, Outlet } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { motion } from 'framer-motion';
import { AuthProvider, useAuth } from './context/AuthContext';

import Header from './components/layout/Header';
import Sidebar from './components/layout/Sidebar';
import Footer from './components/layout/Footer';

import Home from './pages/Home';
import Dashboard from './pages/Dashboard';
import NewAnalysis from './pages/NewAnalysis';
import History from './pages/History';
import Results from './pages/Results';
import PageSelector from './pages/PageSelector';
import SEOAnalytics from './pages/SEOAnalytics';

/* ── Protected Route ─────────────────────────────────────── */
/* ── Persistent Layout for Authenticated Pages ─────────── */
const ProtectedLayout = () => {
    const { user, loading } = useAuth();
    const location = useLocation();

    // If loading, render the sidebar and a spinner in the content area
    // This maintains layout stability and prevents "flashing" on reload
    if (loading) {
        return (
            <div className="flex h-screen overflow-hidden bg-[#1a1d2e]">
                <Sidebar />
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
            <Sidebar />
            <main className="flex-1 overflow-y-auto">
                <motion.div
                    key={location.pathname}
                    initial={{ opacity: 0, y: 15 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.3, ease: 'easeOut' }}
                    className="min-h-full"
                >
                    <Outlet />
                </motion.div>
            </main>
        </div>
    );
};

/* ── Public layout (Home page) ───────────────────────────── */
const PublicLayout = ({ children }) => {
    const { user, loading } = useAuth();
    
    if (loading) return null;
    if (user) return <Navigate to="/dashboard" replace />;
    
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
                    <Route path="/dashboard" element={<Dashboard />} />
                    <Route path="/seo-analytics" element={<SEOAnalytics />} />
                    <Route path="/new-analysis" element={<NewAnalysis />} />
                    <Route path="/history" element={<History />} />
                    <Route path="/select-pages" element={<PageSelector />} />
                    <Route path="/results/:analysisId" element={<Results />} />
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

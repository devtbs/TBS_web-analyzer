import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
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
import Help from './pages/Help';

/* ── Protected Route ─────────────────────────────────────── */
const ProtectedRoute = ({ children }) => {
    const { user, loading } = useAuth();

    if (loading) {
        // Return null or a subtle light background to prevent the dark flash
        return <div className="min-h-screen bg-slate-50" />;
    }

    return user ? children : <Navigate to="/" />;
};

/* ── Sidebar layout (for authenticated app pages) ───────── */
const SidebarLayout = ({ children }) => (
    <div className="flex h-screen overflow-hidden bg-slate-50">
        <Sidebar />
        <main className="flex-1 overflow-y-auto">
            {children}
        </main>
    </div>
);

/* ── Public layout (Home page) ───────────────────────────── */
const PublicLayout = ({ children }) => (
    <div className="min-h-screen flex flex-col">
        <Header />
        <main className="flex-1 flex flex-col">
            {children}
        </main>
        <Footer />
    </div>
);

/* ── App routing ─────────────────────────────────────────── */
function AppContent() {
    return (
        <>
            <Routes>
                {/* Public pages — top header + footer */}
                <Route path="/" element={<PublicLayout><Home /></PublicLayout>} />

                {/* Protected pages — sidebar layout */}
                <Route
                    path="/dashboard"
                    element={
                        <ProtectedRoute>
                            <SidebarLayout><Dashboard /></SidebarLayout>
                        </ProtectedRoute>
                    }
                />
                <Route
                    path="/new-analysis"
                    element={
                        <ProtectedRoute>
                            <SidebarLayout><NewAnalysis /></SidebarLayout>
                        </ProtectedRoute>
                    }
                />
                <Route
                    path="/history"
                    element={
                        <ProtectedRoute>
                            <SidebarLayout><History /></SidebarLayout>
                        </ProtectedRoute>
                    }
                />
                <Route
                    path="/select-pages"
                    element={
                        <ProtectedRoute>
                            <SidebarLayout><PageSelector /></SidebarLayout>
                        </ProtectedRoute>
                    }
                />
                <Route
                    path="/results/:analysisId"
                    element={
                        <ProtectedRoute>
                            <SidebarLayout><Results /></SidebarLayout>
                        </ProtectedRoute>
                    }
                />
                <Route
                    path="/help"
                    element={
                        <ProtectedRoute>
                            <SidebarLayout><Help /></SidebarLayout>
                        </ProtectedRoute>
                    }
                />
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

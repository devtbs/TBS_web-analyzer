import { createContext, useContext, useState, useEffect, useMemo } from 'react';
import api from '../api/axios';

const AuthContext = createContext();

export const useAuth = () => {
    const context = useContext(AuthContext);
    if (!context) {
        throw new Error('useAuth must be used within AuthProvider');
    }
    return context;
};

export const AuthProvider = ({ children }) => {
    const [user, setUser] = useState(() => {
        const cached = localStorage.getItem('user_data');
        if (cached) {
            try { return JSON.parse(cached); } catch { return null; }
        }
        return null;
    });
    const [loading, setLoading] = useState(() => {
        // If we have a token and cached user, we can start in non-loading state
        const token = localStorage.getItem('access_token');
        const cachedUser = localStorage.getItem('user_data');
        return !(token && cachedUser);
    });

    useEffect(() => {
        // Check for existing token and cached user data
        const token = localStorage.getItem('access_token');
        
        // Background / Safety check
        const safetyTimer = setTimeout(() => {
            if (loading) {
                console.warn('Auth check timed out after 15s.');
                setLoading(false);
            }
        }, 15000);

        if (token) {
            // Verify session in background (or foreground if not cached)
            api.get('/auth/me')
                .then(response => {
                    const userData = response.data;
                    setUser(userData);
                    // Cache the user data for next reload
                    localStorage.setItem('user_data', JSON.stringify(userData));
                })
                .catch((err) => {
                    console.error('Session verification failed:', err);
                    // Only clear if it's a real 401/403 auth error
                    if (err.response?.status === 401 || err.response?.status === 403) {
                        localStorage.removeItem('access_token');
                        localStorage.removeItem('user_data');
                        setUser(null);
                    }
                })
                .finally(() => {
                    clearTimeout(safetyTimer);
                    setLoading(false);
                });
        } else {
            clearTimeout(safetyTimer);
            setLoading(false);
        }

        return () => clearTimeout(safetyTimer);
    }, []);

    const login = async (googleToken) => {
        try {
            const response = await api.post('/auth/google/login', {
                token: googleToken
            });

            const { access_token, user: userData } = response.data;
            localStorage.setItem('access_token', access_token);
            localStorage.setItem('user_data', JSON.stringify(userData));
            setUser(userData);

            return userData;
        } catch (error) {
            console.error('Login error:', error);
            throw error;
        }
    };

    // Local development only: sign in without Google OAuth (backend gates this to
    // ENVIRONMENT=development). Lets the app be used on localhost.
    const devLogin = async () => {
        const response = await api.post('/auth/dev-login', {});
        const { access_token, user: userData } = response.data;
        localStorage.setItem('access_token', access_token);
        localStorage.setItem('user_data', JSON.stringify(userData));
        setUser(userData);
        return userData;
    };

    const logout = async () => {
        try {
            await api.post('/auth/logout', {});
        } catch (error) {
            console.error('Logout error:', error);
        } finally {
            localStorage.removeItem('access_token');
            localStorage.removeItem('user_data');
            localStorage.removeItem('gsc_selected_property');
            localStorage.removeItem('gsc_token');  // ← fix: monitor needs this cleared
            sessionStorage.clear();
            setUser(null);
        }
    };

    const value = useMemo(() => ({
        user,
        loading,
        login,
        devLogin,
        logout,
    }), [user, loading]);

    return (
        <AuthContext.Provider value={value}>
            {children}
        </AuthContext.Provider>
    );
};

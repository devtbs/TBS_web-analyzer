import { createContext, useContext, useState, useEffect, useMemo } from 'react';
import api from '../api/axios';
import storage from '../utils/storage';

const AuthContext = createContext();

export const useAuth = () => {
    const context = useContext(AuthContext);
    if (!context) {
        throw new Error('useAuth must be used within AuthProvider');
    }
    return context;
};

export const AuthProvider = ({ children }) => {
    const [user, setUser] = useState(() => storage.getJSON('user_data', null));
    const [loading, setLoading] = useState(() => {
        // If we have a token and cached user, we can start in non-loading state
        const token = storage.get('access_token');
        const cachedUser = storage.get('user_data');
        return !(token && cachedUser);
    });

    useEffect(() => {
        // Check for existing token and cached user data
        const token = storage.get('access_token');

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
                    storage.setJSON('user_data', userData);
                })
                .catch((err) => {
                    console.error('Session verification failed:', err);
                    // Only clear if it's a real 401/403 auth error
                    if (err.response?.status === 401 || err.response?.status === 403) {
                        storage.remove('access_token');
                        storage.remove('user_data');
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

    // Accepts { code } from the authorization-code flow (preferred — grants GSC/GA4
    // data access for the login account) or { token } for legacy id-token login.
    const login = async (payload) => {
        try {
            const body = typeof payload === 'string' ? { token: payload } : payload;
            const response = await api.post('/auth/google/login', body);

            const { access_token, user: userData } = response.data;
            storage.set('access_token', access_token);
            storage.setJSON('user_data', userData);
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
        storage.set('access_token', access_token);
        storage.setJSON('user_data', userData);
        setUser(userData);
        return userData;
    };

    const logout = async () => {
        try {
            await api.post('/auth/logout', {});
        } catch (error) {
            console.error('Logout error:', error);
        } finally {
            storage.remove('access_token');
            storage.remove('user_data');
            storage.remove('gsc_selected_property');
            storage.remove('gsc_token');  // ← fix: monitor needs this cleared
            try { sessionStorage.clear(); } catch { /* storage unavailable */ }
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

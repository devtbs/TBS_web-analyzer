import { createContext, useContext, useState, useEffect, useMemo, useCallback } from 'react';
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
        const token = storage.get('access_token');
        const cachedUser = storage.get('user_data');
        return !(token && cachedUser);
    });

    // Multi-account state
    const [connectedAccounts, setConnectedAccounts] = useState([]);
    const [selectedAccountId, setSelectedAccountId] = useState(() => {
        const raw = storage.get('selected_account_id');
        return raw ? parseInt(raw, 10) : null;
    });

    const fetchAccounts = useCallback(async () => {
        try {
            const res = await api.get('/auth/accounts');
            setConnectedAccounts(res.data.accounts || []);
        } catch {
            setConnectedAccounts([]);
        }
    }, []);

    useEffect(() => {
        const token = storage.get('access_token');

        const safetyTimer = setTimeout(() => {
            if (loading) {
                console.warn('Auth check timed out after 15s.');
                setLoading(false);
            }
        }, 15000);

        if (token) {
            api.get('/auth/me')
                .then(response => {
                    const userData = response.data;
                    setUser(userData);
                    storage.setJSON('user_data', userData);
                    fetchAccounts();
                })
                .catch((err) => {
                    console.error('Session verification failed:', err);
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

    const login = async (payload) => {
        try {
            const body = typeof payload === 'string' ? { token: payload } : payload;
            const response = await api.post('/auth/google/login', body);
            const { access_token, user: userData } = response.data;
            storage.set('access_token', access_token);
            storage.setJSON('user_data', userData);
            setUser(userData);
            await fetchAccounts();
            return userData;
        } catch (error) {
            console.error('Login error:', error);
            throw error;
        }
    };

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
            storage.remove('gsc_token');
            storage.remove('selected_account_id');
            try { sessionStorage.clear(); } catch { /* storage unavailable */ }
            setUser(null);
            setConnectedAccounts([]);
            setSelectedAccountId(null);
        }
    };

    const switchAccount = useCallback((id) => {
        setSelectedAccountId(id);
        if (id == null) {
            storage.remove('selected_account_id');
        } else {
            storage.set('selected_account_id', String(id));
        }
    }, []);

    const connectAccount = useCallback(async (code) => {
        const res = await api.post('/auth/accounts/connect', { code });
        await fetchAccounts();
        return res.data;
    }, [fetchAccounts]);

    const disconnectAccount = useCallback(async (accountId) => {
        await api.delete(`/auth/accounts/${accountId}`);
        await fetchAccounts();
        if (selectedAccountId === accountId) switchAccount(null);
    }, [fetchAccounts, selectedAccountId, switchAccount]);

    const value = useMemo(() => ({
        user,
        loading,
        login,
        devLogin,
        logout,
        connectedAccounts,
        selectedAccountId,
        switchAccount,
        connectAccount,
        disconnectAccount,
    }), [user, loading, connectedAccounts, selectedAccountId, switchAccount, connectAccount, disconnectAccount]);

    return (
        <AuthContext.Provider value={value}>
            {children}
        </AuthContext.Provider>
    );
};

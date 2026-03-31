import axios from 'axios';

const api = axios.create({
    // By defaulting to '' (relative path) instead of localhost, 
    // API calls automatically use the current domain (e.g. ngrok link). 
    // Vite's proxy rules in vite.config.js will safely route them to the backend without CORS or Mixed Content errors!
    baseURL: import.meta.env.VITE_API_BASE_URL || '',
    timeout: 300000, 
});

// Request interceptor to add authorization header to every request
api.interceptors.request.use(
    (config) => {
        const token = localStorage.getItem('access_token');
        if (token) {
            config.headers.Authorization = `Bearer ${token}`;
        }
        return config;
    },
    (error) => {
        return Promise.reject(error);
    }
);

// Response interceptor for handling common errors (like 401 Unauthorized)
api.interceptors.response.use(
    (response) => response,
    (error) => {
        if (error.response?.status === 401) {
            // Auto logout on 401
            localStorage.removeItem('access_token');
            // Optional: window.location.href = '/'; 
        }
        return Promise.reject(error);
    }
);

export default api;

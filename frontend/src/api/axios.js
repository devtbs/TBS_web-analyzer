import axios from 'axios';

const api = axios.create({
    baseURL: '', // API base URL if needed, currently relative
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

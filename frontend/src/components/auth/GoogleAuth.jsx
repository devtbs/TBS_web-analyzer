import { GoogleOAuthProvider, useGoogleLogin } from '@react-oauth/google';
import { useAuth } from '../../context/AuthContext';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';

// Sign in AND grant Search Console + Analytics + Google Ads read access in one consent,
// so the data shown in the app always belongs to the account the user logged in with.
const GOOGLE_DATA_SCOPES =
    'https://www.googleapis.com/auth/webmasters.readonly https://www.googleapis.com/auth/analytics.readonly https://www.googleapis.com/auth/adwords';

const SignInButton = () => {
    const { login } = useAuth();
    const navigate = useNavigate();

    const handleLogin = useGoogleLogin({
        flow: 'auth-code',
        scope: GOOGLE_DATA_SCOPES,
        // Force the consent screen every time so Google re-issues a refresh token
        // carrying the *current* scopes. Without this, accounts that connected before
        // the analytics.readonly scope existed never get an upgraded refresh token on
        // reconnect (Google only returns one on first consent), so GA4 stays 403.
        prompt: 'consent',
        onSuccess: async (codeResponse) => {
            try {
                await login({ code: codeResponse.code });
                navigate('/dashboard');
            } catch (error) {
                console.error('Login failed:', error);
            }
        },
        onError: () => console.error('Google login failed'),
    });

    return (
        <button
            onClick={() => handleLogin()}
            className="flex items-center gap-3 px-6 py-2.5 rounded-lg border border-slate-300 bg-white text-sm font-semibold text-slate-700 hover:bg-slate-50 hover:shadow-sm transition-all"
        >
            <svg className="w-5 h-5" viewBox="0 0 24 24" aria-hidden="true">
                <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1Z" />
                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.99.66-2.26 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23Z" />
                <path fill="#FBBC05" d="M5.84 14.1a6.6 6.6 0 0 1 0-4.2V7.06H2.18a11 11 0 0 0 0 9.88l3.66-2.84Z" />
                <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1A11 11 0 0 0 2.18 7.06l3.66 2.84C6.71 7.3 9.14 5.38 12 5.38Z" />
            </svg>
            Sign in with Google
        </button>
    );
};

const GoogleAuth = () => {
    const { user, logout, loading } = useAuth();

    if (loading) {
        return (
            <div className="flex items-center space-x-2">
                <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-violet-600"></div>
            </div>
        );
    }

    if (user) {
        return (
            <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                className="flex items-center gap-3"
            >
                {/* User chip */}
                <div className="hidden sm:flex items-center gap-2.5 px-3 py-1.5 rounded-full bg-slate-100/80 border border-slate-200/60">
                    {user.picture ? (
                        <img
                            src={user.picture}
                            alt={user.name}
                            className="w-6 h-6 rounded-full object-cover border border-white shadow-sm"
                        />
                    ) : (
                        <div className="w-6 h-6 rounded-full bg-gradient-to-br from-violet-500 to-fuchsia-500 flex items-center justify-center text-[10px] font-black text-white">
                            {user.name?.[0] ?? '?'}
                        </div>
                    )}
                    <span className="text-sm font-semibold text-slate-700 leading-none">{user.name}</span>
                </div>

                {/* Sign Out */}
                <button
                    onClick={logout}
                    className="px-3.5 py-1.5 rounded-full border border-slate-200 text-xs font-bold text-slate-500 hover:text-red-500 hover:border-red-200 hover:bg-red-50 transition-all duration-200"
                >
                    Sign out
                </button>
            </motion.div>
        );
    }

    return (
        <GoogleOAuthProvider clientId={import.meta.env.VITE_GOOGLE_CLIENT_ID}>
            <SignInButton />
        </GoogleOAuthProvider>
    );
};

export default GoogleAuth;

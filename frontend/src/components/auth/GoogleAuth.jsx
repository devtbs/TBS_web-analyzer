import { GoogleOAuthProvider, GoogleLogin } from '@react-oauth/google';
import { useAuth } from '../../context/AuthContext';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';

const GoogleAuth = () => {
    const { user, login, logout, loading } = useAuth();
    const navigate = useNavigate();

    const handleSuccess = async (credentialResponse) => {
        try {
            await login(credentialResponse.credential);
            navigate('/dashboard');
        } catch (error) {
            console.error('Login failed:', error);
        }
    };

    const handleError = () => console.error('Google login failed');

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
            <GoogleLogin
                onSuccess={handleSuccess}
                onError={handleError}
                theme="outline"
                size="large"
                text="signin_with"
                shape="rectangular"
            />
        </GoogleOAuthProvider>
    );
};

export default GoogleAuth;

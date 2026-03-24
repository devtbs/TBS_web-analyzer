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
                className="flex items-center gap-5 sm:gap-8 pr-2"
            >
                {/* User Info */}
                <div className="hidden sm:flex items-center gap-4">
                    {user.picture && (
                        <img
                            src={user.picture}
                            alt={user.name}
                            className="w-11 h-11 rounded-full border-2 border-violet-100 object-cover shadow-sm"
                        />
                    )}
                    <div className="flex flex-col text-left">
                        <span className="text-base font-bold text-slate-800 leading-snug">{user.name}</span>
                        <span className="text-sm font-medium text-slate-400 leading-snug">{user.email}</span>
                    </div>
                </div>

                {/* Sign Out Button */}
                <button
                    onClick={logout}
                    className="px-5 py-2.5 border border-slate-200 rounded-xl text-sm font-semibold text-slate-600 hover:bg-slate-50 hover:text-red-500 hover:border-red-200 transition-all duration-200 shadow-sm"
                >
                    Sign Out
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

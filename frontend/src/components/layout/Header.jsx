import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { ChartBarIcon } from '@heroicons/react/24/solid';
import GoogleAuth from '../auth/GoogleAuth';

const Header = () => {
    const { user } = useAuth();
    const location = useLocation();

    const isActive = (path) => location.pathname === path;

    return (
        <header className="w-full bg-white border-b border-slate-100/80 sticky top-0 z-50 shadow-sm">
            <div className="max-w-[1800px] mx-auto px-6 sm:px-10 py-4 flex flex-col sm:flex-row items-center justify-between gap-4">
                
                {/* Left Section: Logo & Nav */}
                <div className="flex flex-col sm:flex-row items-center gap-4 sm:gap-10">
                    {/* Logo */}
                    <Link to="/" className="flex items-center gap-3 group">
                        <div className="w-10 h-10 sm:w-11 sm:h-11 bg-gradient-to-br from-violet-600 to-purple-600 rounded-xl flex items-center justify-center shadow-lg shadow-violet-200">
                            <ChartBarIcon className="w-6 h-6 text-white transform group-hover:scale-110 transition-transform" />
                        </div>
                        <span className="text-xl sm:text-2xl font-bold text-slate-800 tracking-tight">
                            Web Analyzer
                        </span>
                    </Link>

                    {/* Navigation */}
                    {user && (
                        <nav className="flex items-center gap-2">
                            <Link
                                to="/dashboard"
                                className={`px-5 py-2.5 rounded-xl text-base font-semibold transition-all duration-200 ${
                                    isActive('/dashboard') 
                                        ? 'bg-slate-100 text-slate-800' 
                                        : 'text-slate-500 hover:bg-slate-50 hover:text-slate-700'
                                }`}
                            >
                                Dashboard
                            </Link>
                            <Link
                                to="/history"
                                className={`px-5 py-2.5 rounded-xl text-base font-semibold transition-all duration-200 ${
                                    isActive('/history') 
                                        ? 'bg-slate-100 text-slate-800' 
                                        : 'text-slate-500 hover:bg-slate-50 hover:text-slate-700'
                                }`}
                            >
                                History
                            </Link>
                        </nav>
                    )}
                </div>

                {/* Right Section: Auth */}
                <div>
                    <GoogleAuth />
                </div>
                
            </div>
        </header>
    );
};

export default Header;

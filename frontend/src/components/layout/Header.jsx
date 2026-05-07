import { Link } from 'react-router-dom';
import GoogleAuth from '../auth/GoogleAuth';

const Header = () => {
    return (
        <header className="w-full sticky top-0 z-50 bg-white border-b border-slate-200">
            <div className="max-w-7xl mx-auto px-5 sm:px-8 h-16 flex items-center justify-between">
                {/* Logo */}
                <Link to="/" className="flex items-center gap-3 outline-none">
                    <img 
                        src="/TBS-Logo.webp" 
                        alt="TBS Marketing" 
                        className="h-8 w-auto object-contain"
                    />
                </Link>

                {/* Auth */}
                <GoogleAuth />
            </div>
        </header>
    );
};

export default Header;

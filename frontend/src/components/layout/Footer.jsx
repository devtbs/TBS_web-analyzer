const Footer = () => {
    return (
        <footer className="mt-auto border-t border-slate-200 bg-white">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
                <div className="text-center text-[13px] text-slate-500 font-medium">
                    © {new Date().getFullYear()} TBS Marketing. Developed by Dale &amp; Phyo Min Thein.
                </div>
            </div>
        </footer>
    );
};

export default Footer;

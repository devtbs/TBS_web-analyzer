import { Component } from 'react';

/**
 * Catches render/runtime errors in the subtree and shows a recovery card
 * instead of letting a single component crash blank the whole app.
 *
 * Reset via `resetKey` — when the prop changes (e.g. route path), the
 * boundary clears its error so navigating away recovers automatically.
 */
class ErrorBoundary extends Component {
    constructor(props) {
        super(props);
        this.state = { error: null };
    }

    static getDerivedStateFromError(error) {
        return { error };
    }

    componentDidCatch(error, info) {
        // Keep a console trail in dev; stripped from production build.
        if (import.meta.env.DEV) {
            console.error('ErrorBoundary caught an error:', error, info);
        }
    }

    componentDidUpdate(prevProps) {
        if (this.state.error && prevProps.resetKey !== this.props.resetKey) {
            this.setState({ error: null });
        }
    }

    render() {
        if (this.state.error) {
            return (
                <div className="flex items-center justify-center min-h-[60vh] p-8">
                    <div className="flex flex-col items-center gap-5 max-w-md text-center bg-white rounded-2xl shadow-sm border border-slate-100 p-8">
                        <div className="w-12 h-12 rounded-full bg-red-50 flex items-center justify-center text-2xl">
                            ⚠️
                        </div>
                        <div className="space-y-1.5">
                            <h2 className="text-lg font-bold text-slate-800">Something went wrong</h2>
                            <p className="text-sm text-slate-500">
                                This part of the page hit an unexpected error. You can reload to try again.
                            </p>
                        </div>
                        {import.meta.env.DEV && (
                            <pre className="w-full text-left text-xs text-red-600 bg-red-50 rounded-lg p-3 overflow-auto max-h-40 whitespace-pre-wrap">
                                {String(this.state.error?.stack || this.state.error)}
                            </pre>
                        )}
                        <div className="flex gap-3 pt-1">
                            <button
                                onClick={() => this.setState({ error: null })}
                                className="text-sm font-semibold text-slate-600 hover:text-slate-800 bg-slate-100 px-4 py-2 rounded-lg transition-colors"
                            >
                                Try again
                            </button>
                            <button
                                onClick={() => window.location.reload()}
                                className="text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-700 px-4 py-2 rounded-lg transition-colors"
                            >
                                Reload page
                            </button>
                        </div>
                    </div>
                </div>
            );
        }

        return this.props.children;
    }
}

export default ErrorBoundary;

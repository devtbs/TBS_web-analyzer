import { lazy, Suspense, useState } from 'react';
import { SparklesIcon } from '@heroicons/react/24/outline';
const AssistantWidget = lazy(() => import('./AssistantWidget'));

// Keep the conversation mounted after first use so closing it preserves a running reply.
export default function AssistantLauncher() {
    const [activated, setActivated] = useState(false);
    const launcher = <button onClick={() => setActivated(true)} aria-label="Open AI assistant"
        className="fixed bottom-5 right-5 z-[60] w-12 h-12 rounded-2xl bg-emerald-700 text-white shadow-lg flex items-center justify-center hover:bg-emerald-800">
        <SparklesIcon className="w-6 h-6" />
    </button>;
    return activated ? <Suspense fallback={launcher}><AssistantWidget /></Suspense> : launcher;
}

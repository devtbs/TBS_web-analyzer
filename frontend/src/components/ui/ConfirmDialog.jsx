import { useEffect, useId } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ExclamationTriangleIcon, XMarkIcon } from '@heroicons/react/24/outline';
import Button from './Button';

const ConfirmDialog = ({ isOpen, onClose, onConfirm, title, message, confirmText = 'Delete', cancelText = 'Cancel' }) => {
    const titleId = useId();
    const messageId = useId();

    // Close on Escape while open.
    useEffect(() => {
        if (!isOpen) return;
        const onKey = (e) => { if (e.key === 'Escape') onClose(); };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [isOpen, onClose]);

    if (!isOpen) return null;

    return (
        <AnimatePresence>
            {isOpen && (
                <>
                    {/* Backdrop */}
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        onClick={onClose}
                        className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50"
                    />

                    {/* Dialog */}
                    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
                        <motion.div
                            role="dialog"
                            aria-modal="true"
                            aria-labelledby={titleId}
                            aria-describedby={messageId}
                            initial={{ opacity: 0, scale: 0.95, y: 20 }}
                            animate={{ opacity: 1, scale: 1, y: 0 }}
                            exit={{ opacity: 0, scale: 0.95, y: 20 }}
                            className="bg-white rounded-2xl shadow-2xl max-w-md w-full overflow-hidden"
                        >
                            {/* Header */}
                            <div className="relative p-6 pb-4">
                                <button
                                    onClick={onClose}
                                    aria-label="Close dialog"
                                    className="absolute top-4 right-4 p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
                                >
                                    <XMarkIcon className="w-5 h-5" aria-hidden="true" />
                                </button>

                                <div className="flex items-start gap-4">
                                    <div className="flex-shrink-0 w-12 h-12 bg-red-100 rounded-full flex items-center justify-center">
                                        <ExclamationTriangleIcon className="w-6 h-6 text-red-600" aria-hidden="true" />
                                    </div>
                                    <div className="flex-1 pt-1">
                                        <h3 id={titleId} className="text-xl font-bold text-slate-900 mb-2">
                                            {title}
                                        </h3>
                                        <p id={messageId} className="text-slate-600 leading-relaxed">
                                            {message}
                                        </p>
                                    </div>
                                </div>
                            </div>

                            {/* Actions */}
                            <div className="px-6 py-4 bg-slate-50 border-t border-slate-100 flex items-center justify-end gap-3">
                                <Button
                                    variant="outline"
                                    onClick={onClose}
                                    className="min-w-[100px]"
                                >
                                    {cancelText}
                                </Button>
                                <Button
                                    onClick={() => {
                                        onConfirm();
                                        onClose();
                                    }}
                                    className="min-w-[100px] bg-red-600 hover:bg-red-700 text-white"
                                >
                                    {confirmText}
                                </Button>
                            </div>
                        </motion.div>
                    </div>
                </>
            )}
        </AnimatePresence>
    );
};

export default ConfirmDialog;

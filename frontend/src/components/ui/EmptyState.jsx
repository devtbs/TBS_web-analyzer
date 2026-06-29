/**
 * Friendly placeholder for zero-data / no-results / error scenarios so pages
 * never render a blank void. Pass an optional `icon`, `title`, `description`,
 * and an `action` node (e.g. a retry or "create" button).
 */
const EmptyState = ({ icon, title, description, action, className = '' }) => (
    <div className={`flex flex-col items-center justify-center text-center py-16 px-6 ${className}`}>
        {icon && (
            <div className="w-14 h-14 mb-4 rounded-2xl bg-slate-100 flex items-center justify-center text-3xl text-slate-400" aria-hidden="true">
                {icon}
            </div>
        )}
        {title && <h3 className="text-base font-semibold text-slate-700">{title}</h3>}
        {description && <p className="mt-1.5 text-sm text-slate-500 max-w-sm">{description}</p>}
        {action && <div className="mt-5">{action}</div>}
    </div>
);

export default EmptyState;

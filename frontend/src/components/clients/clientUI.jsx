import { useState } from 'react';
import { XMarkIcon } from '@heroicons/react/24/outline';
import toast from 'react-hot-toast';
import api from '../../api/axios';

/* Shared client UI — used by both the Clients portfolio and the client detail hub. */

/* Real period-over-period delta badge. Negative clicks/impressions = bad; caller sets direction. */
export const Delta = ({ value, positiveGood = true }) => {
    if (value === null || value === undefined) return <span className="text-[12px] font-bold text-slate-400">—</span>;
    if (Math.abs(value) < 0.5) return <span className="text-[12px] font-bold text-slate-500">~0%</span>;
    const good = positiveGood ? value >= 0 : value <= 0;
    return (
        <span className={`text-[12px] font-bold inline-flex items-center gap-0.5 ${good ? 'text-[#16a34a]' : 'text-[#dc2626]'}`}>
            <span className="text-[9px]">{value >= 0 ? '▲' : '▼'}</span>{Math.abs(value).toFixed(0)}%
        </span>
    );
};

export const fmt = (n) => (n == null ? '—' : n.toLocaleString());

// A client is "attention" when GSC data failed OR clicks fell hard — the portfolio red flag.
export const needsAttention = (c) => !!c.error || (c.deltas && c.deltas.clicks != null && c.deltas.clicks <= -25);

/* Slide-over drawer to edit a client's name / GA4 / Ads / brand terms, or archive it.
   `onSaved(updated)` on save, `onSaved(null, id)` on archive — matching the Clients page contract. */
export function EditDrawer({ client, onClose, onSaved }) {
    const [form, setForm] = useState({
        name: client.name || '', ga4_property_id: client.ga4_property_id || '',
        ads_customer_id: client.ads_customer_id || '', brand_terms: client.brand_terms || '',
    });
    const [saving, setSaving] = useState(false);
    const save = async () => {
        setSaving(true);
        try {
            const res = await api.put(`/api/clients/${client.id}`, form);
            toast.success('Client updated');
            onSaved(res.data);
        } catch { toast.error('Could not save'); } finally { setSaving(false); }
    };
    const archive = async () => {
        if (!confirm(`Archive "${client.name}"? It will be removed from your clients.`)) return;
        try { await api.delete(`/api/clients/${client.id}`); toast.success('Client archived'); onSaved(null, client.id); }
        catch { toast.error('Could not archive'); }
    };
    const field = (k, label, ph) => (
        <label className="block mb-4">
            <span className="block text-[13px] font-semibold text-slate-700 mb-1">{label}</span>
            <input value={form[k]} onChange={e => setForm(f => ({ ...f, [k]: e.target.value }))}
                placeholder={ph} className="w-full border border-slate-300 rounded-lg px-3 py-2 text-[14px] outline-none focus:ring-2 focus:ring-emerald-500/30" />
        </label>
    );
    return (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/30" onClick={onClose}>
            <div className="w-full max-w-md bg-white h-full shadow-2xl p-6 overflow-y-auto" onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-between mb-5">
                    <h2 className="text-lg font-bold text-slate-800">Edit client</h2>
                    <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-100"><XMarkIcon className="w-5 h-5 text-slate-500" /></button>
                </div>
                {field('name', 'Name')}
                {field('ga4_property_id', 'GA4 property ID', 'e.g. 123456789')}
                {field('ads_customer_id', 'Google Ads customer ID', 'digits only')}
                {field('brand_terms', 'Branded queries to exclude', 'brand, nicknames, comma separated')}
                <div className="flex items-center gap-3 mt-6">
                    <button onClick={save} disabled={saving}
                        className="flex-1 bg-[#26397A] text-white rounded-lg py-2.5 font-bold text-[14px] disabled:opacity-60">
                        {saving ? 'Saving…' : 'Save'}
                    </button>
                    <button onClick={archive} className="px-4 py-2.5 rounded-lg text-red-600 font-semibold text-[14px] hover:bg-red-50">Archive</button>
                </div>
            </div>
        </div>
    );
}

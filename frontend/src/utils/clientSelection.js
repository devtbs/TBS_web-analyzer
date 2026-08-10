/**
 * Selecting a client just populates the per-channel selection keys the rest of the app already
 * reads. So picking a client makes SEOAnalytics, GA4Analytics, GoogleAds and Presentation all open
 * on that client's assets with zero changes to those pages — they never learn about "clients".
 */
import storage from './storage';

export function selectClient(client) {
    if (!client) return;
    storage.set('selected_client_id', client.id);
    // account axis (axios sends this as X-Account-Id); null/absent = primary token
    if (client.google_account_id != null) storage.set('selected_account_id', String(client.google_account_id));
    else storage.remove('selected_account_id');
    // per-channel property keys the existing pages consume
    if (client.gsc_property) storage.set('gsc_selected_property', client.gsc_property);
    if (client.ga4_property_id) storage.set('ga4_selected_property', client.ga4_property_id);
    if (client.ads_customer_id) storage.set('google_ads_selected_customer', client.ads_customer_id);
    // tell the GSC pages the property changed (Sidebar/SEOAnalytics listen for this)
    try { window.dispatchEvent(new Event('gsc_property_changed')); } catch { /* noop */ }
}

export function selectedClientId() {
    return storage.get('selected_client_id');
}

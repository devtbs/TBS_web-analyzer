/**
 * Safe localStorage / sessionStorage helpers.
 *
 * Wraps every access in try/catch so that:
 *   - Private-mode / disabled-storage browsers don't throw and crash the app.
 *   - Corrupt JSON returns the provided fallback instead of blowing up render.
 *
 * Use `getJSON`/`setJSON` for objects, `get`/`set` for raw strings.
 */

function backend(session) {
    return session ? window.sessionStorage : window.localStorage;
}

export function get(key, fallback = null, { session = false } = {}) {
    try {
        const value = backend(session).getItem(key);
        return value === null ? fallback : value;
    } catch {
        return fallback;
    }
}

export function set(key, value, { session = false } = {}) {
    try {
        backend(session).setItem(key, value);
        return true;
    } catch {
        return false;
    }
}

export function remove(key, { session = false } = {}) {
    try {
        backend(session).removeItem(key);
        return true;
    } catch {
        return false;
    }
}

export function getJSON(key, fallback = null, { session = false } = {}) {
    try {
        const raw = backend(session).getItem(key);
        if (raw === null) return fallback;
        return JSON.parse(raw);
    } catch {
        return fallback;
    }
}

export function setJSON(key, value, { session = false } = {}) {
    try {
        backend(session).setItem(key, JSON.stringify(value));
        return true;
    } catch {
        return false;
    }
}

export default { get, set, remove, getJSON, setJSON };

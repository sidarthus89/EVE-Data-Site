// cacheUtils.js
const CACHE_PREFIX = 'eve-data-';
const DEFAULT_CACHE_TIME = 5 * 60 * 1000; // 5 minutes

export function getCacheKey(endpoint) {
    return `${CACHE_PREFIX}${endpoint}`;
}

export function getCachedData(key) {
    try {
        const item = localStorage.getItem(key);
        if (!item) return null;

        const { data, timestamp, expiry } = JSON.parse(item);
        if (Date.now() - timestamp > expiry) {
            localStorage.removeItem(key);
            return null;
        }

        return data;
    } catch {
        return null;
    }
}

export function setCacheData(key, data, expiry = DEFAULT_CACHE_TIME) {
    try {
        const item = {
            data,
            timestamp: Date.now(),
            expiry
        };
        localStorage.setItem(key, JSON.stringify(item));
    } catch (e) {
        console.warn('Cache write failed:', e);
    }
}

// Debounce helper
export function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

// src/utils/api.js
// Shared API module with base URLs for Azure and ESI and retry logic

// Preferred data source: same-origin static files under /data (served by GitHub Pages or Static Web Apps)
// Optional override: VITE_DATA_BASE (absolute or relative)
const BASE_URL = import.meta.env.BASE_URL || '/';
const DEFAULT_DATA_BASE = `${BASE_URL.replace(/\/$/, '')}/data`;
export const DATA_BASE = (import.meta.env.VITE_DATA_BASE || '').replace(/\/$/, '') || DEFAULT_DATA_BASE;


// Azure Functions base; allow override for local dev (e.g., VITE_AZURE_BASE=http://localhost:7071/api)
export const AZURE_BASE = (import.meta.env.VITE_AZURE_BASE || process.env.VITE_AZURE_BASE || 'https://evedatafunc01.azurewebsites.net/api').replace(/\/$/, '');
export const ESI_BASE = 'https://esi.evetech.net/latest';

// Build mode helpers
export const IS_DEV_BUILD = (import.meta.env.MODE === 'development');

/**
 * Fetch with retry logic and exponential backoff
 */
export async function fetchWithRetry(url, options = {}, retries = 3) {
    for (let i = 0; i < retries; i++) {
        try {
            const response = await fetch(url, options);

            if (!response.ok) {
                const errorText = await response.text();
                console.error(`❌ HTTP ${response.status}: ${response.statusText}`, errorText);
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            const contentType = response.headers.get('content-type');
            if (contentType && contentType.includes('application/json')) {
                return await response.json();
            } else {
                const text = await response.text();
                console.error('❌ Non-JSON response:', text);
                throw new Error('Response is not JSON');
            }
        } catch (err) {
            console.error(`❌ Fetch attempt ${i + 1} failed:`, err.message);
            if (i === retries - 1) throw err;
            await new Promise(res => setTimeout(res, Math.pow(2, i) * 1000));
        }
    }
}

// Try a list of URLs in order and resolve on the first success
async function fetchAny(urls) {
    let lastErr;
    for (const u of urls.filter(Boolean)) {
        try {
            return await fetchWithRetry(u);
        } catch (e) {
            lastErr = e;
        }
    }
    throw lastErr || new Error('No sources available');
}

export function fetchMarketTree() {
    return fetchAny([
        `${DATA_BASE}/market.json`,
        `${DATA_BASE}/market/market.json`,
    ]);
}

export function fetchRegions() {
    return fetchAny([
        `${DATA_BASE}/regions.json`,
        `${DATA_BASE}/regions/regions.json`,
    ]).then((data) => {
        if (Array.isArray(data)) return data;
        if (data && Array.isArray(data.regions)) return data.regions;
        throw new Error('Invalid regions.json format');
    });
}

export function fetchStructures() {
    return fetchAny([
        `${DATA_BASE}/structures.json`,
        `${DATA_BASE}/structures/structures.json`,
    ]);
}

export function fetchStationsNPC() {
    return fetchAny([
        `${DATA_BASE}/stations.json`,
        `${DATA_BASE}/stations/stations_npc.json`,
    ]);
}

export function fetchSystems() {
    return fetchAny([
        `${DATA_BASE}/systems.json`,
        `${DATA_BASE}/systems/systems.json`,
    ]);
}

export function fetchRegionsWithMarkets() {
    // Project decision: only regions.json will be maintained; treat all regions as market-capable.
    return fetchRegions();
}

// Precomputed region hauling artifacts (optional). Will try multiple common paths.
export function fetchPrecomputedRegionHauling() {
    // Disabled: no precomputed region_hauling artifact fetches or telemetry beacons.
    return Promise.reject(new Error('region_hauling_artifacts_disabled'));
}

// Precomputed per-region best quotes snapshot
export function fetchRegionOrdersSnapshot(regionId) {
    const id = String(regionId);
    // Fire-and-forget log to Azure Function (silent)
    try {
        const name = `${id}.json`;
        const url = `${AZURE_BASE}/log/request?name=${encodeURIComponent(name)}&source=${encodeURIComponent('spa:region_orders')}`;
        if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
            navigator.sendBeacon(url, '1');
        } else {
            fetch(url, { method: 'GET', mode: 'no-cors', cache: 'no-store', keepalive: true }).catch(() => { });
        }
    } catch { }
    // Quiet fetch to avoid console noise on 404s (snapshots are optional)
    const url = `${DATA_BASE}/region_orders/${id}.json`;
    return fetch(url).then(async (res) => {
        if (!res.ok) throw new Error(`snapshot-missing:${res.status}`);
        const ct = res.headers.get('content-type') || '';
        if (!ct.includes('application/json')) throw new Error('snapshot-not-json');
        return res.json();
    });
}

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

// Lightweight helper: fetch route between two systems via ESI and return jump count
export async function fetchRouteJumps(originSystemId, destinationSystemId) {
    const o = Number(originSystemId);
    const d = Number(destinationSystemId);
    if (!Number.isFinite(o) || !Number.isFinite(d)) throw new Error('invalid-system-ids');
    const url = `${ESI_BASE}/route/${o}/${d}/`;
    const res = await fetch(url, { headers: { 'User-Agent': 'EVE-Data-Site' } });
    if (!res.ok) throw new Error(`ESI route ${res.status}`);
    const arr = await res.json();
    return Array.isArray(arr) ? Math.max(0, arr.length - 1) : null;
}

// Retrieve full route system ID array with optional flag ('shortest' | 'secure')
export async function fetchRouteSystems(originSystemId, destinationSystemId, flag = 'shortest') {
    const o = Number(originSystemId);
    const d = Number(destinationSystemId);
    if (!Number.isFinite(o) || !Number.isFinite(d)) throw new Error('invalid-system-ids');
    const safeFlag = (flag === 'secure' || flag === 'shortest') ? flag : 'shortest';
    const url = `${ESI_BASE}/route/${o}/${d}/?flag=${safeFlag}`;
    const res = await fetch(url, { headers: { 'User-Agent': 'EVE-Data-Site' } });
    if (!res.ok) throw new Error(`ESI route ${res.status}`);
    const arr = await res.json();
    return Array.isArray(arr) ? arr : null;
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

// Resolve repo owner and name from DATA_BASE or window.location (GitHub Pages), fallback to defaults
function detectRepoInfoFromEnvironment() {
    try {
        let owner = null, repo = null;
        const defaultOwner = 'sidarthus89';
        const defaultRepo = 'EVE-Data-Site';
        const tryParse = (href) => {
            const u = new URL(href);
            const host = u.hostname || '';
            const pathParts = (u.pathname || '/').split('/').filter(Boolean);
            if (host.endsWith('github.io') && pathParts.length > 0) {
                const sub = host.split('.')[0];
                return { owner: sub || defaultOwner, repo: pathParts[0] || defaultRepo };
            }
            return null;
        };
        // Prefer DATA_BASE if absolute
        if (/^https?:\/\//i.test(DATA_BASE)) {
            const info = tryParse(DATA_BASE);
            if (info) return info;
        }
        if (typeof window !== 'undefined') {
            const info = tryParse(window.location.href);
            if (info) return info;
        }
        return { owner: defaultOwner, repo: defaultRepo };
    } catch {
        return { owner: 'sidarthus89', repo: 'EVE-Data-Site' };
    }
}

// Fetch the ISO timestamp of the most recent commit that touched the data/ folder on gh-pages
export async function fetchDataLastCommitTime() {
    const { owner, repo } = detectRepoInfoFromEnvironment();
    const apiUrl = `https://api.github.com/repos/${owner}/${repo}/commits?sha=gh-pages&path=data&per_page=1`;
    try {
        const res = await fetch(apiUrl, { headers: { 'Accept': 'application/vnd.github+json' } });
        if (res.ok) {
            const arr = await res.json();
            const first = Array.isArray(arr) ? arr[0] : null;
            const iso = first?.commit?.committer?.date || first?.commit?.author?.date;
            if (iso) return new Date(iso).toISOString();
        }
    } catch { /* noop */ }
    return null;
}

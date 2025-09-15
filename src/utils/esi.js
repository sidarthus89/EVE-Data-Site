// src/utils/esi.js
// ESI helpers for structure accessibility (Forbidden filtering) with localStorage caching

const FORBID_CACHE_KEY = 'esi.forbidden.structures.v1';
const ID_IS_STRUCTURE = (id) => Number(id) >= 1_000_000_000_000; // Upwell structure ID heuristic

function readCache() {
    try {
        const raw = localStorage.getItem(FORBID_CACHE_KEY);
        return raw ? JSON.parse(raw) : {};
    } catch {
        return {};
    }
}

function writeCache(obj) {
    try { localStorage.setItem(FORBID_CACHE_KEY, JSON.stringify(obj)); } catch { }
}

// Return cached status: true = forbidden, false = allowed, undefined = unknown
export function isStructureForbiddenCached(id) {
    try {
        const cache = readCache();
        const rec = cache[String(id)];
        if (!rec) return undefined;
        if (rec.status === 'forbidden') return true;
        if (rec.status === 'allowed') return false;
        return undefined;
    } catch {
        return undefined;
    }
}

async function esiCheckStructureForbidden(id) {
    const sid = String(id);
    const url = `https://esi.evetech.net/latest/universe/structures/${encodeURIComponent(sid)}/?datasource=tranquility`;
    try {
        const res = await fetch(url, { headers: { 'User-Agent': 'EVE-Data-Site' }, cache: 'no-store' });
        // 200 => accessible (allowed). 403/401/404 => treat as forbidden (not visible or removed)
        if (res.ok) return false;
        if ([401, 403, 404].includes(res.status)) return true;
        // Other errors: be conservative and do not mark forbidden to avoid over-filtering
        return false;
    } catch {
        // Network errors: do not mark forbidden
        return false;
    }
}

// Ensure statuses for a set of IDs; returns a Set of forbidden IDs
export async function ensureStructuresStatus(ids, { concurrency = 4 } = {}) {
    const all = Array.from(new Set(ids)).filter(ID_IS_STRUCTURE);
    if (all.length === 0) return new Set();

    const cache = readCache();
    const unknown = all.filter(id => !cache[String(id)]);

    if (unknown.length > 0) {
        // Concurrency-limited probing
        const buckets = Array.from({ length: Math.max(1, Math.min(concurrency, unknown.length)) }, () => []);
        unknown.forEach((id, i) => buckets[i % buckets.length].push(id));
        await Promise.all(buckets.map(async (bucket) => {
            for (const id of bucket) {
                const forbidden = await esiCheckStructureForbidden(id);
                cache[String(id)] = { status: forbidden ? 'forbidden' : 'allowed', checkedAt: Date.now() };
            }
        }));
        writeCache(cache);
    }

    const forbiddenSet = new Set(
        all.filter(id => (cache[String(id)]?.status === 'forbidden'))
    );
    return forbiddenSet;
}

// Convenience: get forbidden set for provided IDs using cache and probing unknowns
export async function getForbiddenSetFor(ids) {
    return ensureStructuresStatus(ids);
}

export const __private = { readCache, writeCache, ID_IS_STRUCTURE };

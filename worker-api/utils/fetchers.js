// worker-api/utils/fetchers.js

export async function fetchMarketHistory(itemId, regionId, env) {
    const key = `history:${regionId}:${itemId}`;
    const raw = await env.MARKET_HISTORY.get(key);
    if (!raw) return []; // fallback if no data
    try {
        return JSON.parse(raw);
    } catch (e) {
        console.warn(`⚠️ Failed to parse history for ${regionId}:${itemId}`, e);
        return [];
    }
}

export async function fetchMarketOrdersFromBackend(regionID) {
    const esiUrl = `https://esi.evetech.net/latest/markets/${regionID}/orders/?order_type=all`;
    const response = await fetch(esiUrl);
    if (!response.ok) throw new Error("ESI fetch failed");
    return await response.json();
}

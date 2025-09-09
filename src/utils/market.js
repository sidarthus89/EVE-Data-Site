// src/utils/market.js
// Market data functions (Azure first; no ESI fallbacks for orders)

import { fetchWithRetry, AZURE_BASE, ESI_BASE, fetchMarketTree, fetchStationsNPC, fetchStructures, fetchRegionOrdersSnapshot } from './api.js';

// Simple localStorage cache for market history keyed by typeId:regionId
const HISTORY_CACHE_KEY = 'marketHistoryCache.v1';

function readHistoryCache() {
    try {
        const raw = localStorage.getItem(HISTORY_CACHE_KEY);
        return raw ? JSON.parse(raw) : {};
    } catch {
        return {};
    }
}

function writeHistoryCache(cache) {
    try {
        localStorage.setItem(HISTORY_CACHE_KEY, JSON.stringify(cache));
    } catch {
        // ignore quota errors
    }
}

export async function fetchMarketOrders(typeId, regionId = null, locationId = null, isBuyOrder = null) {
    const params = new URLSearchParams({ type_id: typeId });
    if (regionId) params.append('region_id', regionId);
    if (locationId) params.append('location_id', locationId);
    if (isBuyOrder !== null) params.append('is_buy_order', isBuyOrder);

    console.log(`🎯 Fetching market orders for type_id: ${typeId}, region_id: ${regionId}`);

    try {
        // 0) Try static region snapshot first (best quotes only), except PLEX region (19000001 has no snapshots)
        const PLEX_REGION_ID = 19000001;
        if (regionId && Number(regionId) !== PLEX_REGION_ID) {
            try {
                const snap = await fetchRegionOrdersSnapshot(regionId);
                if (snap && snap.best_quotes && snap.best_quotes[typeId]) {
                    const entry = snap.best_quotes[typeId];
                    const buy = entry.best_buy ? [{ ...entry.best_buy, is_buy_order: true, type_id: typeId, region_id: regionId }] : [];
                    const sell = entry.best_sell ? [{ ...entry.best_sell, is_buy_order: false, type_id: typeId, region_id: regionId }] : [];
                    return { buyOrders: buy, sellOrders: sell, meta: { source: 'snapshot', last_updated: snap.last_updated } };
                }
            } catch { }
        }

        const url = `${AZURE_BASE}/market/orders?${params}`;
        const response = await fetchWithRetry(url, {}, 1);
        console.log('✅ Azure response received:', response);

        // Validate response structure
        if (!response || typeof response !== 'object') {
            throw new Error('Invalid response structure from Azure');
        }

        // Ensure we have the expected structure
        const result = {
            buyOrders: response.buyOrders || [],
            sellOrders: response.sellOrders || [],
            meta: response.meta || {}
        };

        console.log(`📊 Azure orders: ${result.buyOrders.length} buy, ${result.sellOrders.length} sell`);
        return result;

    } catch (azureError) {
        console.error('❌ Azure fetch failed for market orders:', azureError);
        return { buyOrders: [], sellOrders: [], meta: { source: 'none' } };
    }
}

export async function fetchMarketSummary(typeId, regionId = null) {
    const params = new URLSearchParams({ type_id: typeId });
    if (regionId) params.append('region_id', regionId);
    return fetchWithRetry(`${AZURE_BASE}/market/summary?${params}`, {}, 3);
}

export async function fetchMarketHistory(type_id, region_id, days = 365) {
    // Cache key and read existing cache
    const key = `${type_id}:${region_id}`;
    const cache = readHistoryCache();
    const now = Date.now();

    // Keep up to 365 days; if cached and fresh for today, return it
    const cached = cache[key];
    if (cached && Array.isArray(cached.data)) {
        // If lastUpdated is today, serve cached
        const last = new Date(cached.lastUpdated);
        const sameDay = last.toDateString() === new Date(now).toDateString();
        if (sameDay) {
            return cached.data;
        }
    }

    // ESI direct: https://esi.evetech.net/latest/markets/{region_id}/history/?type_id={type_id}
    const url = `${ESI_BASE}/markets/${region_id}/history/?type_id=${encodeURIComponent(type_id)}`;
    console.log(`📈 Fetching market history from ESI: type_id=${type_id}, region_id=${region_id}`);

    try {
        const response = await fetch(url, { headers: { 'User-Agent': 'EVE-Data-Site' } });
        if (!response.ok) {
            throw new Error(`Failed to fetch market history: ${response.statusText} (${response.status})`);
        }

        const data = await response.json();
        return persistHistory(key, now, cache, cached, data);
    } catch (error) {
        console.warn(`📈 ESI history unavailable for type_id=${type_id}, region_id=${region_id}:`, error?.message || error);
        if (cached && Array.isArray(cached.data)) return cached.data;
        throw error;
    }
}

function persistHistory(key, now, cache, cached, data) {
    // Normalize and clamp to 365 days, sorted by date asc
    const normalized = (Array.isArray(data) ? data : [])
        .filter(e => e && e.date)
        .sort((a, b) => new Date(a.date) - new Date(b.date))
        .slice(-365);

    // Merge with cached if present to avoid losing older days when API returns fewer
    let merged = normalized;
    if (cached && Array.isArray(cached.data) && cached.data.length) {
        const map = new Map(cached.data.map(e => [e.date, e]));
        for (const e of normalized) map.set(e.date, e);
        merged = Array.from(map.values()).sort((a, b) => new Date(a.date) - new Date(b.date)).slice(-365);
    }

    cache[key] = { lastUpdated: now, data: merged };
    writeHistoryCache(cache);
    return merged;
}

export async function fetchAggregatedOrders(typeId, regionId) {
    const params = new URLSearchParams({ type_id: typeId, region_id: regionId });
    return fetchWithRetry(`${AZURE_BASE}/aggregated-orders?${params}`, {}, 3);
}

export async function fetchUniverseMarketHistory(typeId) {
    console.log('🌍 fetchUniverseMarketHistory called with typeID:', typeId, typeof typeId);

    const hubs = [10000002, 10000043, 10000032, 10000030, 10000042]; // major trade hub regions
    console.log('🌍 Fetching from hubs:', hubs);

    const historyLists = await Promise.all(hubs.map(async (rid) => {
        try {
            console.log(`🌍 Fetching hub ${rid} for typeID ${typeId}`);
            const result = await fetchMarketHistory(typeId, rid);
            console.log(`🌍 Hub ${rid} returned:`, result ? result.length : 'null', 'items');
            if (result && result.length > 0) {
                console.log(`🌍 Sample data from hub ${rid}:`, result[0]);
            }
            return result;
        } catch (error) {
            console.error(`🌍 Hub ${rid} failed:`, error);
            return [];
        }
    }));

    console.log('🌍 All hub responses:', historyLists.map(list => Array.isArray(list) ? list.length : 'not array'));

    // Aggregate by date across all regions
    const dateMap = new Map();
    historyLists.forEach((list, index) => {
        console.log(`🌍 Processing hub ${hubs[index]} with ${Array.isArray(list) ? list.length : 'not array'} items`);
        if (Array.isArray(list)) {
            list.forEach(entry => {
                const date = entry.date;
                if (!dateMap.has(date)) {
                    dateMap.set(date, {
                        date,
                        totalVolume: 0,
                        totalValue: 0,
                        highest: 0,
                        lowest: Infinity,
                        orderCount: 0
                    });
                }
                const bucket = dateMap.get(date);
                const vol = entry.volume || 0;
                const avg = entry.average || 0;
                bucket.totalVolume += vol;
                bucket.totalValue += vol * avg;
                bucket.highest = Math.max(bucket.highest, entry.highest || 0);
                bucket.lowest = Math.min(bucket.lowest, entry.lowest || bucket.lowest);
                bucket.orderCount += entry.order_count || 0;
            });
        }
    });

    console.log('🌍 Date map size:', dateMap.size);

    // Convert to array with weighted average
    const aggregated = Array.from(dateMap.values())
        .map(item => ({
            date: item.date,
            average: item.totalVolume > 0 ? item.totalValue / item.totalVolume : 0,
            totalVolume: item.totalVolume,
            highest: item.highest,
            lowest: item.lowest === Infinity ? 0 : item.lowest,
            order_count: item.orderCount
        }))
        .sort((a, b) => new Date(a.date) - new Date(b.date));

    console.log('🌍 Final aggregated result:', aggregated.length, 'items');
    if (aggregated.length > 0) {
        console.log('🌍 Sample aggregated item:', aggregated[0]);
    }

    return aggregated;
}

export async function fetchTradeRouteData(fromId, toId, types = [34, 44992]) {
    const opportunities = [];
    for (const typeId of types) {
        // Fetch sell orders (buying from source) and buy orders (selling to destination)
        const sellResult = await fetchMarketOrders(typeId, fromId, null, false);
        const buyResult = await fetchMarketOrders(typeId, toId, null, true);
        const sellOrders = sellResult.sellOrders || [];
        const buyOrders = buyResult.buyOrders || [];
        if (sellOrders.length && buyOrders.length) {
            const bestSell = Math.min(...sellOrders.map(o => o.price));
            const bestBuy = Math.max(...buyOrders.map(o => o.price));
            const profit = bestBuy - bestSell;
            const profitPct = bestSell > 0 ? (profit / bestSell) * 100 : 0;
            const maxSellVol = sellOrders.find(o => o.price === bestSell)?.volume_remain || 0;
            const maxBuyVol = buyOrders.find(o => o.price === bestBuy)?.volume_remain || 0;
            opportunities.push({
                type_id: typeId,
                buy_price: bestBuy,
                sell_price: bestSell,
                profit_per_unit: profit,
                profit_percentage: profitPct,
                max_volume: Math.min(maxSellVol, maxBuyVol),
                from_region: fromId,
                to_region: toId
            });
        }
    }
    // Sort by descending profit percentage
    return opportunities.sort((a, b) => b.profit_percentage - a.profit_percentage);
}

// Deprecated: live region hauling API and precomputed artifacts are not used.
export async function fetchRegionHaulingData() { return []; }

// Build cross-region trade routes from precomputed region_orders snapshots (best quotes per region)
export async function generateRegionRoutesFromSnapshots(originRegionId, destinationRegionId) {
    const from = Number(originRegionId);
    const to = Number(destinationRegionId || originRegionId);
    try {
        const [snapA, snapB] = await Promise.all([
            fetchRegionOrdersSnapshot(from),
            fetchRegionOrdersSnapshot(to)
        ]);

        if (!snapA || !snapB || !snapA.best_quotes || !snapB.best_quotes) return [];
        const routes = [];
        // Iterate over intersection of types present in both snapshots
        const typeIds = Object.keys(snapA.best_quotes);
        for (const t of typeIds) {
            const a = snapA.best_quotes[t];
            const b = snapB.best_quotes[t];
            if (!a || !b) continue;
            const sellA = a.best_sell; // we buy at origin's best sell
            const buyB = b.best_buy;   // we sell to destination's best buy
            if (!sellA || !buyB) continue;
            const profit = (buyB.price || 0) - (sellA.price || 0);
            if (profit <= 0) continue;
            const qty = Math.min(Number(sellA.volume_remain || 0), Number(buyB.volume_remain || 0));
            const roi = sellA.price > 0 ? (profit / sellA.price) * 100 : 0;
            routes.push({
                type_id: Number(t),
                origin_id: sellA.location_id,
                destination_id: buyB.location_id,
                sell_price: sellA.price,
                buy_price: buyB.price,
                profit_per_unit: profit,
                profit_margin: roi,
                max_volume: qty,
                origin_region_id: from,
                destination_region_id: to,
                _fallback: true
            });
        }
        // Sort by profit per unit desc and cap to a reasonable size
        return routes.sort((x, y) => (y.profit_per_unit || 0) - (x.profit_per_unit || 0)).slice(0, 5000);
    } catch {
        return [];
    }
}

// Prefer snapshots only: use precomputed region_hauling artifact; if missing/empty, derive from region_orders snapshots; never call live Azure route API
export async function fetchRegionHaulingSnapshotsOnly(originRegionId, destinationRegionId = null) {
    // Build from region_orders snapshots only (no region_hauling artifacts)
    return generateRegionRoutesFromSnapshots(originRegionId, destinationRegionId || originRegionId);
}
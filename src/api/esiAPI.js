// src/api/esiAPI.js

const IS_DEV = import.meta.env.IS_DEV;

export const WORKER_ESI_BASE = IS_DEV
    ? 'http://127.0.0.1:8787/markets/'
    : 'https://eve-data-api.sidarthus89.workers.dev/markets/';

export const WORKER_KV_BASE = IS_DEV
    ? 'http://127.0.0.1:8787/api/'
    : 'https://eve-data-api.sidarthus89.workers.dev/api/';

const GLOBAL_MARKET_TYPES = new Set([44992]);
const allRegionsCache = {};
const DEBUG = false;

export function getRegionID(regionRef, regionMap) {
    if (!regionRef) return null;
    if (!isNaN(regionRef)) return Number(regionRef);
    return regionMap?.[regionRef]?.regionID ?? null;
}

function getEffectiveRegionID(typeID, regionRef, locationsMap) {
    if (GLOBAL_MARKET_TYPES.has(typeID)) return 19000001;
    if (!regionRef) return null;
    if (!isNaN(regionRef)) return Number(regionRef);
    return locationsMap?.[regionRef]?.regionID ?? null;
}

export async function fetchJSON(path) {
    const url = getAPIUrl(path);
    const res = await fetch(url);

    if (!res.ok) {
        const text = await res.text(); // read raw body to avoid JSON.parse crash
        throw new Error(`Fetch failed: ${res.status} — ${text}`);
    }

    return await res.json();
}

export async function fetchMarketOrders(typeID, regionRef = null, locationsMap = {}) {
    const regionID = getEffectiveRegionID(typeID, regionRef, locationsMap);
    if (!regionID) throw new Error(`Invalid regionRef provided: ${regionRef}`);

    const baseUrl = `${WORKER_ESI_BASE}${regionID}/orders/?type_id=${typeID}`;
    let orders = [];
    let page = 1;

    while (true) {
        const res = await fetch(`${baseUrl}&page=${page}`);
        if (!res.ok) break;

        const data = await res.json();
        orders.push(...data);

        const totalPages = parseInt(res.headers.get('X-Pages') || '1', 10);
        if (page >= totalPages) break;
        page++;
    }

    return {
        buyOrders: orders.filter(o => o.is_buy_order && o.price > 0),
        sellOrders: orders.filter(o => !o.is_buy_order && o.price > 0)
    };
}

export async function fetchMarketHistory(regionID, typeID) {
    if (!regionID || !typeID) throw new Error('regionID and typeID are required');
    const url = `${WORKER_ESI_BASE}${regionID}/history/?type_id=${typeID}`;
    return await safeFetchJSON(url);
}

export async function fetchRegionOrdersByID(typeID, regionID) {
    if (!regionID) throw new Error('regionID is required');
    const baseUrl = `${WORKER_ESI_BASE}${regionID}/orders/?type_id=${typeID}`;

    let orders = [];
    let page = 1;

    while (true) {
        const res = await fetch(`${baseUrl}&page=${page}`);
        if (!res.ok) break;

        const data = await res.json();
        orders.push(...data);

        const totalPages = parseInt(res.headers.get('X-Pages') || '1', 10);
        if (page >= totalPages) break;
        page++;
    }

    return orders;
}

async function runTasksWithLimit(tasks, concurrency = 5) {
    const results = [];
    let index = 0;

    async function worker() {
        while (index < tasks.length) {
            const i = index++;
            try {
                results[i] = await tasks[i]();
            } catch (e) {
                results[i] = [];
                if (DEBUG) console.warn(`Task ${i} failed:`, e);
            }
        }
    }

    const workers = Array.from({ length: concurrency }, () => worker());
    await Promise.all(workers);
    return results;
}

export async function fetchOrdersForAllRegions(typeID, locations) {
    if (allRegionsCache[typeID]) return allRegionsCache[typeID];

    const fetchTasks = Object.entries(locations)
        .filter(([_, region]) => region.regionID)
        .map(([regionKey, region]) => () =>
            fetchRegionOrdersByID(typeID, region.regionID).then(orders =>
                orders.map(order => ({
                    ...order,
                    source_region_id: region.regionID,
                    source_region_key: regionKey
                }))
            ).catch(e => {
                console.warn(`Failed fetching orders for region ${regionKey}:`, e);
                return [];
            })
        );

    const allResults = await runTasksWithLimit(fetchTasks, 6);
    const allOrders = allResults.flat();

    allRegionsCache[typeID] = allOrders;
    return allOrders;
}

export async function fetchAggregatedMarketHistory(typeID, locations) {
    if (!typeID || !locations || Object.keys(locations).length === 0) {
        console.warn('Missing typeID or locations for aggregated market history');
        return [];
    }

    const fetchTasks = Object.values(locations)
        .filter(region => region.regionID)
        .map(region => async () => {
            try {
                return await fetchMarketHistory(region.regionID, typeID);
            } catch (e) {
                console.warn(`Failed to fetch market history for region ${region.regionID}`, e);
                return [];
            }
        });

    const results = await runTasksWithLimit(fetchTasks, 5);
    const aggregationMap = {};

    results.forEach(regionData => {
        regionData.forEach(day => {
            if (!aggregationMap[day.date]) {
                aggregationMap[day.date] = {
                    date: day.date,
                    totalVolume: 0,
                    weightedPriceSum: 0,
                    totalOrders: 0
                };
            }

            aggregationMap[day.date].totalVolume += day.volume;
            aggregationMap[day.date].weightedPriceSum += day.average * day.volume;
            aggregationMap[day.date].totalOrders += day.order_count;
        });
    });

    return Object.values(aggregationMap)
        .map(day => ({
            date: day.date,
            average: day.totalVolume > 0 ? day.weightedPriceSum / day.totalVolume : 0,
            volume: day.totalVolume,
            order_count: day.totalOrders
        }))
        .sort((a, b) => a.date.localeCompare(b.date));
}

export async function fetchMineralPricesFromTypeIDs(typeIDList, regionRef = null) {
    const prices = {};
    for (const typeID of typeIDList) {
        try {
            const orders = await fetchRegionOrdersByID(typeID, getRegionID(regionRef));
            const buyOrders = orders.filter(o => o.is_buy_order && o.price > 0);
            prices[typeID] = buyOrders.length
                ? Math.max(...buyOrders.map(o => o.price))
                : 0;
        } catch (e) {
            console.error(`Mineral ${typeID} failed:`, e);
            prices[typeID] = 0;
        }
    }
    return prices;
}

export async function fetchOreBuyPrices(typeIDList, regionRef = null) {
    const prices = {};
    for (const typeID of typeIDList) {
        try {
            const orders = await fetchRegionOrdersByID(typeID, getRegionID(regionRef));
            const buyOrders = orders.filter(o => o.is_buy_order && o.price > 0);
            prices[typeID] = buyOrders.length
                ? buyOrders.reduce((sum, o) => sum + o.price, 0) / buyOrders.length
                : 0;
        } catch (e) {
            console.error(`Ore ${typeID} failed:`, e);
            prices[typeID] = 0;
        }
    }
    return prices;
}

export function getAPIUrl(path) {
    const base = import.meta.env.IS_DEV
        ? '/api'
        : 'https://eve-data-api.sidarthus89.workers.dev/api';
    return `${base}/${path}`;
}
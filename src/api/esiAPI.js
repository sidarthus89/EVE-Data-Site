// src/api/esiAPI.js

const IS_DEV = import.meta.env.DEV;


export const WORKER_ESI_BASE = IS_DEV
    ? 'http://127.0.0.1:8787/markets/'
    : 'https://eve-data-api.sidarthus89.workers.dev/markets/';

export const WORKER_KV_BASE = IS_DEV
    ? '/api/'  // Dev: fetches from public folder
    : 'https://eve-data-api.sidarthus89.workers.dev/api/'; // Prod: fetches from Worker

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

export async function fetchJSON(endpoint, isFullUrl = false) {
    const url = isFullUrl ? endpoint : `${WORKER_KV_BASE}${endpoint}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Failed to fetch ${endpoint}: ${res.status}`);
    return res.json();
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
    return await fetchJSON(url, true); // pass full URL
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

// Run tasks with concurrency limit
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
            fetchRegionOrdersByID(typeID, region.regionID)
                .then(orders => orders.map(order => ({
                    ...order,
                    source_region_id: region.regionID,
                    source_region_key: regionKey
                })))
                .catch(e => {
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
        return { data: [], failedRegions: [] };
    }

    const failedRegions = [];
    const fetchTasks = Object.values(locations)
        .filter(region => region.regionID && region.regionID !== 19000001)
        .map(region => async () => {
            try {
                return await fetchMarketHistory(region.regionID, typeID);
            } catch (e) {
                console.warn(`❌ Failed to fetch market history for region ${region.regionID}`, e);
                failedRegions.push(region.regionID);
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

    const aggregated = Object.values(aggregationMap)
        .map(day => ({
            date: day.date,
            average: day.totalVolume > 0 ? day.weightedPriceSum / day.totalVolume : 0,
            totalVolume: day.totalVolume,
            order_count: day.totalOrders
        }))
        .sort((a, b) => a.date.localeCompare(b.date));

    return {
        data: aggregated,
        failedRegions
    };
}

export async function fetchMineralPricesFromTypeIDs(typeIDList, regionRef = null) {
    const prices = {};
    for (const typeID of typeIDList) {
        try {
            const orders = await fetchRegionOrdersByID(typeID, getRegionID(regionRef));
            const buyOrders = orders.filter(o => o.is_buy_order && o.price > 0);
            prices[typeID] = buyOrders.length ? Math.max(...buyOrders.map(o => o.price)) : 0;
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

export async function fetchLocations() {
    try {
        // Use the same endpoint for both dev and prod
        const res = await fetch(`${WORKER_KV_BASE}locations`);
        if (!res.ok) throw new Error('Failed to fetch locations from worker');
        return res.json();
    } catch (err) {
        console.warn('Worker fetch failed, falling back to public:', err);
        const res = await fetch('/data/locations.json');
        if (!res.ok) throw new Error('Failed to fetch locations from public');
        return res.json();
    }
}

export async function fetchMarketTree() {
    try {
        // Use the same endpoint for both dev and prod
        const res = await fetch(`${WORKER_KV_BASE}market-tree`);
        if (!res.ok) throw new Error('Failed to fetch market tree from worker');
        return res.json();
    } catch (err) {
        console.warn('Worker fetch failed, falling back to public:', err);
        const res = await fetch('/data/market.json');
        if (!res.ok) throw new Error('Failed to fetch market tree from public');
        return res.json();
    }
}


// Custom API URL helper
export function getAPIUrl(path) {
    const base = IS_DEV
        ? 'http://127.0.0.1:8787/api'
        : 'https://eve-data-api.sidarthus89.workers.dev/api';
    return `${base}/${path.replace(/^\/+/, '')}`;
}


/**
 * Fetch trade route data from the Worker
 * @param {Object} params
 * @param {string} params.startRegionID
 * @param {string} params.endRegionID
 * @param {'buyToSell'|'sellToBuy'} params.tradeMode
 * @param {number} [params.profitAbove=500000]
 * @param {number} [params.roi=0]
 * @param {number} [params.budget=Infinity]
 * @param {number} [params.capacity=Infinity]
 * @param {number} [params.salesTax=7.5]
 * @param {number} [params.maxJumps=Infinity]
 * @param {function} [params.updateProgress] optional progress callback
 */
export async function fetchTradeRouteData(params) {
    const {
        startRegionID,
        endRegionID,
        tradeMode,
        profitAbove = 500_000,
        roi = 0,
        budget = Infinity,
        capacity = Infinity,
        salesTax = 7.5,
        maxJumps = Infinity,
        updateProgress
    } = params;

    const url = new URL(getAPIUrl('trade-route'));

    url.searchParams.set('startRegionID', startRegionID);
    url.searchParams.set('endRegionID', endRegionID);
    url.searchParams.set('tradeMode', tradeMode);
    url.searchParams.set('profitAbove', profitAbove);
    url.searchParams.set('roi', roi);
    url.searchParams.set('budget', budget);
    url.searchParams.set('capacity', capacity);
    url.searchParams.set('salesTax', salesTax);
    url.searchParams.set('maxJumps', maxJumps);

    try {
        const res = await fetch(url.toString(), { method: 'GET' });

        if (!res.ok) {
            throw new Error(`Trade route fetch failed: ${res.status}`);
        }

        const data = await res.json();

        if (updateProgress) updateProgress(100);

        return data;
    } catch (err) {
        console.error('fetchTradeRouteData error:', err);
        throw err;
    }
}

export async function fetchOrdersByStation(stationID) {
    if (!stationID) throw new Error('stationID is required');
    const url = `https://esi.evetech.net/latest/markets/orders/?order_type=all&structure_id=${stationID}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Failed to fetch orders for station ${stationID}`);
    return await res.json();
}


const fetch = require('node-fetch');
const { upsertDataToAll } = require('./github');

const ESI_BASE = process.env.ESI_BASE || 'https://esi.evetech.net/latest';
const REGION_CONCURRENCY = Math.max(1, Number(process.env.REGION_CONCURRENCY || 2));
const PAGE_CONCURRENCY = Math.max(1, Number(process.env.PAGE_CONCURRENCY || 2));

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

function buildUrl(endpoint) {
    if (endpoint.startsWith('http')) return endpoint;
    return `${ESI_BASE}${endpoint}`;
}

async function fetchJson(url, retries = 3) {
    for (let i = 0; i <= retries; i++) {
        const res = await fetch(url, { headers: { 'User-Agent': 'EVE-Data-Site-Functions' } });
        if (res.ok) return res;
        const status = res.status;
        if (status === 420 || status === 429 || status >= 500) {
            await sleep(200 + i * 200);
            continue;
        }
        const text = await res.text().catch(() => '');
        throw new Error(`ESI ${status} ${res.statusText} ${text}`);
    }
    throw new Error('ESI request failed after retries');
}

async function fetchRegionOrdersPage(regionId, page) {
    const url = buildUrl(`/markets/${regionId}/orders/?page=${page}`);
    const res = await fetchJson(url);
    const data = await res.json();
    const pagesHeader = res.headers.get('x-pages');
    const totalPages = pagesHeader ? parseInt(pagesHeader, 10) : null;
    return { data, totalPages };
}

function updateBestQuotes(map, order) {
    const t = order.type_id;
    let entry = map.get(t);
    if (!entry) {
        entry = { best_buy: null, best_sell: null };
        map.set(t, entry);
    }
    if (order.is_buy_order) {
        if (!entry.best_buy || order.price > entry.best_buy.price) {
            entry.best_buy = {
                price: order.price,
                location_id: order.location_id,
                volume_remain: order.volume_remain,
                // add fields to compute expiration client-side
                issued: order.issued || null,
                duration: typeof order.duration === 'number' ? order.duration : null,
            };
        }
    } else {
        if (!entry.best_sell || order.price < entry.best_sell.price) {
            entry.best_sell = {
                price: order.price,
                location_id: order.location_id,
                volume_remain: order.volume_remain,
                // add fields to compute expiration client-side
                issued: order.issued || null,
                duration: typeof order.duration === 'number' ? order.duration : null,
            };
        }
    }
}

async function generateBestQuotesForRegion(regionId, log) {
    const first = await fetchRegionOrdersPage(regionId, 1);
    const totalPages = Math.max(1, first.totalPages || 1);
    const bestMap = new Map();
    const structureIds = new Set();
    for (const o of first.data) {
        updateBestQuotes(bestMap, o);
        if (o && o.location_id && o.location_id > 1000000000000) structureIds.add(o.location_id);
    }

    let nextPage = 2;
    async function worker() {
        while (nextPage <= totalPages) {
            const p = nextPage++;
            try {
                const { data } = await fetchRegionOrdersPage(regionId, p);
                for (const o of data) {
                    updateBestQuotes(bestMap, o);
                    if (o && o.location_id && o.location_id > 1000000000000) structureIds.add(o.location_id);
                }
            } catch (e) {
                log && log(`Region ${regionId} page ${p} failed: ${e.message}`);
                await sleep(200);
            }
            await sleep(40);
        }
    }
    const workers = Array.from({ length: PAGE_CONCURRENCY }, () => worker());
    await Promise.all(workers);

    const best_quotes = {};
    for (const [typeId, v] of bestMap.entries()) {
        best_quotes[typeId] = {
            best_buy: v.best_buy || null,
            best_sell: v.best_sell || null,
        };
    }

    return {
        region_id: regionId,
        last_updated: new Date().toISOString(),
        best_quotes,
        structure_ids: Array.from(structureIds),
    };
}

async function upsertRegionSnapshot(regionId, snapshot, message) {
    const content = JSON.stringify(snapshot);
    const path = `region_orders/${regionId}.json`;
    return upsertDataToAll(path, content, message || `chore(region-orders): update ${regionId}.json`);
}

async function listAllRegionIds() {
    const url = buildUrl('/universe/regions/');
    const res = await fetchJson(url);
    const ids = await res.json();
    if (!Array.isArray(ids)) throw new Error('Invalid regions list');
    return ids;
}

module.exports = {
    REGION_CONCURRENCY,
    PAGE_CONCURRENCY,
    generateBestQuotesForRegion,
    upsertRegionSnapshot,
    listAllRegionIds,
    sleep,
};

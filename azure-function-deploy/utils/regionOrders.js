const fetch = require('node-fetch');
const { upsertDataToAll } = require('./github');

const ESI_BASE = process.env.ESI_BASE || 'https://esi.evetech.net/latest';
const REGION_CONCURRENCY = Math.max(1, Number(process.env.REGION_CONCURRENCY || 2));
const PAGE_CONCURRENCY = Math.max(1, Number(process.env.PAGE_CONCURRENCY || 2));
const GH_RAW_OWNER = process.env.GITHUB_OWNER || 'sidarthus89';
const GH_RAW_REPO = process.env.GITHUB_REPO || 'EVE-Data-Site';
const GH_DATA_BRANCH = process.env.GITHUB_BRANCH_DATA || 'gh-pages';
const SNAPSHOT_MAX_AGE_MINUTES = Number(process.env.SNAPSHOT_MAX_AGE_MINUTES || 10);
const SNAPSHOT_MAX_AGE_MS = SNAPSHOT_MAX_AGE_MINUTES * 60 * 1000;

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
                // preserve buy order range so UI can show Station/System/Region
                range: typeof order.range !== 'undefined' ? order.range : null,
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
                // sell orders are always station-bound; keep null for consistency
                range: null,
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

// Internal helper to fetch snapshot meta (last_updated) from raw branch
async function getRegionSnapshotInfo(regionId) {
    const url = `https://raw.githubusercontent.com/${GH_RAW_OWNER}/${GH_RAW_REPO}/${GH_DATA_BRANCH}/data/region_orders/${regionId}.json`;
    try {
        const res = await fetch(url, { headers: { 'User-Agent': 'EVE-Data-Site-Functions' } });
        if (res.status === 404) return { exists: false };
        if (!res.ok) return { exists: false, error: `status ${res.status}` };
        const json = await res.json();
        const ts = json && json.last_updated ? Date.parse(json.last_updated) : NaN;
        const lastUpdated = Number.isFinite(ts) ? new Date(ts) : null;
        const ageMs = lastUpdated ? Date.now() - lastUpdated.getTime() : null;
        return { exists: true, lastUpdated, ageMs, count: json.best_quotes ? Object.keys(json.best_quotes).length : 0 };
    } catch (e) {
        return { exists: false, error: e.message };
    }
}

// Decide whether to (re)generate snapshot: missing, no timestamp, or stale beyond threshold.
async function shouldGenerateRegionSnapshot(regionId) {
    const info = await getRegionSnapshotInfo(regionId);
    if (!info.exists) return { generate: true, reason: 'missing', ageMs: null };
    if (!info.lastUpdated) return { generate: true, reason: 'no-timestamp', ageMs: null };
    if (info.ageMs > SNAPSHOT_MAX_AGE_MS) return { generate: true, reason: 'stale', ageMs: info.ageMs };
    return { generate: false, reason: 'fresh', ageMs: info.ageMs };
}

module.exports = {
    REGION_CONCURRENCY,
    PAGE_CONCURRENCY,
    generateBestQuotesForRegion,
    upsertRegionSnapshot,
    listAllRegionIds,
    getRegionSnapshotInfo,
    shouldGenerateRegionSnapshot,
    sleep,
};

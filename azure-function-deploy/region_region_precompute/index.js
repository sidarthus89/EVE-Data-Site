const fetch = require('node-fetch');
const telemetry = require('../utils/telemetry');
const { upsertDataToAll } = require('../utils/github');

const GH_RAW_BASE = process.env.GH_RAW_BASE || 'https://raw.githubusercontent.com';
const GH_OWNER = process.env.GITHUB_OWNER || 'sidarthus89';
const GH_REPO = process.env.GITHUB_REPO || 'EVE-Data-Site';
const GH_BRANCH_DATA = process.env.GITHUB_BRANCH_DATA || 'gh-pages';
const ROUTE_CAP = Math.max(100, Number(process.env.REGION_REGION_MAX || 5000));

function getHubRegions() {
    const env = process.env.HUB_REGIONS;
    if (env) return env.split(',').map((s) => Number(s.trim())).filter(Boolean);
    return [10000002, 10000043, 10000032, 10000030, 10000042];
}

async function fetchSnapshot(regionId) {
    const url = `${GH_RAW_BASE}/${GH_OWNER}/${GH_REPO}/${GH_BRANCH_DATA}/data/region_orders/${regionId}.json`;
    const res = await fetch(url, { headers: { 'User-Agent': 'EVE-Data-Site-Functions' } });
    if (!res.ok) return null;
    return res.json();
}

function computeRoutes(fromSnap, toSnap, fromId, toId) {
    if (!fromSnap || !toSnap || !fromSnap.best_quotes || !toSnap.best_quotes) return [];
    const routes = [];
    const typeIds = Object.keys(fromSnap.best_quotes);
    for (const t of typeIds) {
        const a = fromSnap.best_quotes[t];
        const b = toSnap.best_quotes[t];
        if (!a || !b) continue;
        const sellA = a.best_sell; // buy at origin's best sell
        const buyB = b.best_buy;   // sell to destination's best buy
        if (!sellA || !buyB) continue;
        const profit = (buyB.price || 0) - (sellA.price || 0);
        if (!Number.isFinite(profit) || profit <= 0) continue;
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
            origin_region_id: fromId,
            destination_region_id: toId
        });
    }
    return routes.sort((x, y) => (y.profit_per_unit || 0) - (x.profit_per_unit || 0)).slice(0, ROUTE_CAP);
}

module.exports = async function (context, myTimer) {
    telemetry.init();
    const hubs = getHubRegions();
    const pairs = [];
    for (let i = 0; i < hubs.length; i++) {
        for (let j = 0; j < hubs.length; j++) {
            if (i === j) continue;
            pairs.push([hubs[i], hubs[j]]);
        }
    }
    context.log(`region_region_precompute tick: pairs=${pairs.length}`);
    telemetry.trackEvent('REGION_REGION_TICK', { pairs: String(pairs.length) });

    // Fetch all needed snapshots in parallel but dedupe region fetches
    const uniqueRegionIds = Array.from(new Set(hubs));
    const snapMap = new Map();
    await Promise.all(uniqueRegionIds.map(async (rid) => {
        try {
            const snap = await fetchSnapshot(rid);
            if (snap) snapMap.set(rid, snap);
        } catch (e) {
            context.log.error(`Failed to fetch snapshot ${rid}: ${e.message}`);
            telemetry.trackException(e, { area: 'region_region_precompute', step: 'fetchSnapshot', regionId: String(rid) });
        }
    }));

    let success = 0, failed = 0;
    for (const [fromId, toId] of pairs) {
        try {
            const fromSnap = snapMap.get(fromId) || null;
            const toSnap = snapMap.get(toId) || null;
            const routes = computeRoutes(fromSnap, toSnap, fromId, toId);
            const body = {
                from_region_id: fromId,
                to_region_id: toId,
                last_updated: new Date().toISOString(),
                count: routes.length,
                routes
            };
            const path = `region_region/${fromId}-${toId}.json`;
            // eslint-disable-next-line no-await-in-loop
            const res = await upsertDataToAll(path, JSON.stringify(body), `data(region-region): ${fromId}-${toId}`);
            context.log(`Committed region_region ${fromId}-${toId}: ${routes.length}`);
            success++;
        } catch (e) {
            context.log.error(`Failed region_region ${fromId}-${toId}: ${e.message}`);
            telemetry.trackException(e, { area: 'region_region_precompute', pair: `${fromId}-${toId}` });
            failed++;
        }
    }

    context.log(`region_region_precompute done. success=${success} failed=${failed}`);
    telemetry.trackEvent('REGION_REGION_DONE', { success: String(success), failed: String(failed) });
};

const telemetry = require('../utils/telemetry');
const {
    REGION_CONCURRENCY,
    generateBestQuotesForRegion,
    upsertRegionSnapshot,
    upsertRegionItems,
    sleep,
    shouldGenerateRegionSnapshot,
} = require('../utils/regionOrders');

// Default hub regions; override via env HUB_REGIONS="10000002,10000043,..."
function getHubRegions() {
    const env = process.env.HUB_REGIONS;
    if (env) return env.split(',').map((s) => Number(s.trim())).filter(Boolean);
    return [10000002, 10000043, 10000032, 10000030, 10000042];
}

module.exports = async function (context, myTimer) {
    telemetry.init();
    const BULK = process.env.GITHUB_DATA_BULK_SQUASH === '1';
    if (BULK) {
        context.log('region_orders_hubs: bulk squash mode active; skipping (handled by others function)');
        telemetry.trackEvent('REGION_ORDERS_HUBS_SKIPPED_BULK');
        return;
    }
    const hubs = getHubRegions();
    context.log(`region_orders_hubs tick: processing ${hubs.length} hubs with concurrency ${REGION_CONCURRENCY}`);
    telemetry.trackEvent('REGION_ORDERS_HUBS_TICK', { count: String(hubs.length) });

    const queue = hubs.slice();
    let success = 0, failed = 0;

    async function worker(id) {
        while (queue.length) {
            const regionId = queue.shift();
            try {
                const decision = await shouldGenerateRegionSnapshot(regionId);
                if (!decision.generate) {
                    context.log(`[H${id}] Skip region ${regionId} (${decision.reason}, ageMs=${decision.ageMs})`);
                    success++;
                } else {
                    context.log(`[H${id}] Generating region ${regionId} (${decision.reason})`);
                    const snapshot = await generateBestQuotesForRegion(regionId, (msg) => context.log(`[H${id}] ${msg}`));
                    const res = await upsertRegionSnapshot(regionId, snapshot, `chore(region-orders): hub ${regionId} (${decision.reason})`);
                    context.log(`[H${id}] Committed ${regionId}: ${JSON.stringify(res)}`);
                    try {
                        const itemsRes = await upsertRegionItems(regionId, snapshot, `data(region-item): hub ${regionId}`);
                        context.log(`[H${id}] region_item writes for ${regionId}: ${JSON.stringify(itemsRes)}`);
                        telemetry.trackEvent('REGION_ITEM_EMIT', { regionId: String(regionId), written: String(itemsRes.written || 0), failed: String(itemsRes.failed || 0) });
                    } catch (e) {
                        context.log.error(`[H${id}] region_item emit failed for ${regionId}: ${e.message}`);
                        telemetry.trackException(e, { area: 'region_orders_hubs', step: 'region_item_emit', regionId: String(regionId) });
                    }
                    success++;
                }
            } catch (e) {
                context.log.error(`[H${id}] Failed region ${regionId}: ${e.message}`);
                telemetry.trackException(e, { area: 'region_orders_hubs', regionId: String(regionId) });
                failed++;
            }
            await sleep(100);
        }
    }

    const workers = Array.from({ length: Math.min(REGION_CONCURRENCY, hubs.length) }, (_, i) => worker(i + 1));
    await Promise.all(workers);

    context.log(`region_orders_hubs done. success=${success} failed=${failed}`);
    telemetry.trackEvent('REGION_ORDERS_HUBS_DONE', { success: String(success), failed: String(failed) });
};

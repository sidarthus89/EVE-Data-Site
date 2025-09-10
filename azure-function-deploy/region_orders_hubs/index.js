const telemetry = require('../utils/telemetry');
const {
    REGION_CONCURRENCY,
    generateBestQuotesForRegion,
    upsertRegionSnapshot,
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

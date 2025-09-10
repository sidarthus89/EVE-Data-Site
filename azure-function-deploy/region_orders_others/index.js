const telemetry = require('../utils/telemetry');
const {
    REGION_CONCURRENCY,
    generateBestQuotesForRegion,
    upsertRegionSnapshot,
    listAllRegionIds,
    sleep,
    shouldGenerateRegionSnapshot,
} = require('../utils/regionOrders');

function getHubRegions() {
    const env = process.env.HUB_REGIONS;
    if (env) return env.split(',').map((s) => Number(s.trim())).filter(Boolean);
    return [10000002, 10000043, 10000032, 10000030, 10000042];
}

module.exports = async function (context, myTimer) {
    telemetry.init();
    const hubs = new Set(getHubRegions());
    let all = [];
    try {
        all = await listAllRegionIds();
    } catch (e) {
        context.log.error('Failed to list regions from ESI:', e.message);
        telemetry.trackException(e, { area: 'region_orders_others', step: 'listRegions' });
        return;
    }
    const others = all.filter((id) => !hubs.has(Number(id)));
    context.log(`region_orders_others tick: processing ${others.length} regions with concurrency ${REGION_CONCURRENCY}`);
    telemetry.trackEvent('REGION_ORDERS_OTHERS_TICK', { count: String(others.length) });

    const queue = others.slice();
    let success = 0, failed = 0;

    async function worker(id) {
        while (queue.length) {
            const regionId = queue.shift();
            try {
                const decision = await shouldGenerateRegionSnapshot(regionId);
                if (!decision.generate) {
                    context.log(`[W${id}] Skip region ${regionId} (${decision.reason}, ageMs=${decision.ageMs})`);
                    success++;
                } else {
                    context.log(`[W${id}] Generating region ${regionId} (${decision.reason})`);
                    const snapshot = await generateBestQuotesForRegion(regionId, (msg) => context.log(`[W${id}] ${msg}`));
                    const res = await upsertRegionSnapshot(regionId, snapshot, `chore(region-orders): region ${regionId} (${decision.reason})`);
                    context.log(`[W${id}] Committed ${regionId}: ${JSON.stringify(res)}`);
                    success++;
                }
            } catch (e) {
                context.log.error(`[W${id}] Failed region ${regionId}: ${e.message}`);
                telemetry.trackException(e, { area: 'region_orders_others', regionId: String(regionId) });
                failed++;
            }
            await sleep(120);
        }
    }

    const workers = Array.from({ length: Math.min(REGION_CONCURRENCY, others.length) }, (_, i) => worker(i + 1));
    await Promise.all(workers);

    context.log(`region_orders_others done. success=${success} failed=${failed}`);
    telemetry.trackEvent('REGION_ORDERS_OTHERS_DONE', { success: String(success), failed: String(failed) });
};

const telemetry = require('../utils/telemetry');
const {
    REGION_CONCURRENCY,
    generateBestQuotesForRegion,
    upsertRegionSnapshot,
    listAllRegionIds,
    upsertRegionItems,
    sleep,
    shouldGenerateRegionSnapshot,
} = require('../utils/regionOrders');
const { bulkReplaceDataFiles } = require('../utils/github');

function getHubRegions() {
    const env = process.env.HUB_REGIONS;
    if (env) return env.split(',').map((s) => Number(s.trim())).filter(Boolean);
    return [10000002, 10000043, 10000032, 10000030, 10000042];
}

module.exports = async function (context, myTimer) {
    telemetry.init();
    const BULK = process.env.GITHUB_DATA_BULK_SQUASH === '1';
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
    context.log(`region_orders_others tick: processing ${others.length} regions with concurrency ${REGION_CONCURRENCY} (bulk=${BULK})`);
    telemetry.trackEvent('REGION_ORDERS_OTHERS_TICK', { count: String(others.length), bulk: String(BULK) });

    const queue = others.slice();
    let success = 0, failed = 0;
    const bulkFiles = [];

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
                    const content = JSON.stringify(snapshot);
                    if (BULK) {
                        bulkFiles.push({ path: `region_orders/${regionId}.json`, content });
                    } else {
                        const res = await upsertRegionSnapshot(regionId, snapshot, `chore(region-orders): region ${regionId} (${decision.reason})`);
                        context.log(`[W${id}] Committed ${regionId}: ${JSON.stringify(res)}`);
                        try {
                            const itemsRes = await upsertRegionItems(regionId, snapshot, `data(region-item): region ${regionId}`);
                            context.log(`[W${id}] region_item writes for ${regionId}: ${JSON.stringify(itemsRes)}`);
                            telemetry.trackEvent('REGION_ITEM_EMIT', { regionId: String(regionId), written: String(itemsRes.written || 0), failed: String(itemsRes.failed || 0) });
                        } catch (e) {
                            context.log.error(`[W${id}] region_item emit failed for ${regionId}: ${e.message}`);
                            telemetry.trackException(e, { area: 'region_orders_others', step: 'region_item_emit', regionId: String(regionId) });
                        }
                    }
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

    if (BULK) {
        try {
            if (bulkFiles.length === 0) {
                context.log('Bulk mode: nothing to write (no regions regenerated)');
            } else {
                context.log(`Bulk mode: replacing ${bulkFiles.length} snapshot files with single squash commit`);
                const res = await bulkReplaceDataFiles(bulkFiles, 'data(region-orders): bulk squash snapshots');
                context.log('Bulk replace result:', JSON.stringify(res));
                telemetry.trackEvent('REGION_ORDERS_BULK_SQUASH', { files: String(bulkFiles.length) });
            }
        } catch (e) {
            context.log.error('Bulk squash failed:', e.message);
            telemetry.trackException(e, { area: 'region_orders_others', step: 'bulkReplace' });
        }
    }

    context.log(`region_orders_others done. success=${success} failed=${failed} bulk=${BULK}`);
    telemetry.trackEvent('REGION_ORDERS_OTHERS_DONE', { success: String(success), failed: String(failed), bulk: String(BULK) });
};

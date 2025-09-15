const telemetry = require('../utils/telemetry');
const {
    REGION_CONCURRENCY,
    generateBestQuotesForRegion,
    upsertRegionSnapshot,
    sleep,
    shouldGenerateRegionSnapshot,
} = require('../utils/regionOrders');
const { appendStructureIds, readExistingStructures, updateStructuresFromIds } = require('../utils/structures');

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
                    // region_item writes removed to avoid rate limiting
                    // Structure enrichment: find missing structure IDs, fetch details from ESI, and merge into structures.json
                    try {
                        const structureIds = Array.isArray(snapshot.structure_ids) ? snapshot.structure_ids : [];
                        if (structureIds.length) {
                            const existing = await readExistingStructures().catch(() => []);
                            const byId = new Map(existing.map(s => [String(s.stationID), s]));
                            const missing = structureIds.filter(id => !byId.has(String(id)));
                            // Also include IDs that exist but are incomplete (no details fetched yet)
                            const incomplete = structureIds.filter(id => {
                                const rec = byId.get(String(id));
                                if (!rec) return false;
                                const hasDetails = !!(rec.locationName || rec.systemID || rec.regionID || rec.systemName || rec.regionName || (typeof rec.security === 'number'));
                                return !hasDetails;
                            });
                            const toEnrich = Array.from(new Set([...missing, ...incomplete]));
                            if (toEnrich.length) {
                                const enrichRes = await updateStructuresFromIds(toEnrich, context);
                                context.log(`[H${id}] structures.json enriched (missing+incomplete): ${toEnrich.length} ids, total ${enrichRes.total}`);
                                telemetry.trackEvent('STRUCTURES_ENRICH', { regionId: String(regionId), new: String(toEnrich.length), total: String(enrichRes.total) });
                            } else {
                                context.log(`[H${id}] structures.json: all ${structureIds.length} present and enriched`);
                            }
                        }
                    } catch (e) {
                        context.log.error(`[H${id}] structures.json enrichment failed for ${regionId}: ${e.message}`);
                        telemetry.trackException(e, { area: 'region_orders_hubs', step: 'structures_enrich', regionId: String(regionId) });
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

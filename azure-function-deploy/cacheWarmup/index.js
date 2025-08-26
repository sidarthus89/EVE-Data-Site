// in azure-function-deploy/cacheWarmup/index.js
module.exports = async function (context) {
    const endpoints = [
        '/api/market-structure',
        '/api/market/summary?type_id=34&region_id=10000002',
        '/api/hauling?from=10000002&to=10000030'
    ];
    // Warm core HTTP endpoints
    for (let path of endpoints) {
        try {
            await fetch(`https://<your-app>.azurewebsites.net${path}`);
            context.log(`Warmed ${path}`);
        } catch (e) {
            context.log.error(`Warmup failed for ${path}:`, e);
        }
    }
    // Hybrid cache warm: precompute region hauling for popular trade hubs
    const hubs = [10000002, 10000043, 10000032, 10000030, 10000042]; // Jita, Amarr, Dodixie, Hek, Rens
    for (let i = 0; i < hubs.length; i++) {
        for (let j = 0; j < hubs.length; j++) {
            if (i === j) continue;
            const origin = hubs[i];
            const destination = hubs[j];
            const path = `/api/region_hauling?origin_region_id=${origin}&destination_region_id=${destination}`;
            try {
                await fetch(`https://<your-app>.azurewebsites.net${path}`);
                context.log(`Hybrid warmed region hauling ${origin}->${destination}`);
            } catch (e) {
                context.log.error(`Hybrid warmup failed for ${origin}->${destination}:`, e);
            }
        }
    }
};
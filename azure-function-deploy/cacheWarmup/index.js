// in azure-function-deploy/cacheWarmup/index.js
module.exports = async function (context) {
    const endpoints = [
        '/api/market-structure',
        '/api/market/summary?type_id=34&region_id=10000002',
        '/api/hauling?from=10000002&to=10000030'
    ];
    for (let path of endpoints) {
        try {
            await fetch(`https://<your-app>.azurewebsites.net${path}`);
            context.log(`Warmed ${path}`);
        } catch (e) {
            context.log.error(`Warmup failed for ${path}:`, e);
        }
    }
};
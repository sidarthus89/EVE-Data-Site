const { uploadJsonBlob } = require('../utils/old_blob');
const fetch = require('node-fetch');

// Pull from existing endpoint and cache to blob for hot pairs
const HOT_PAIRS = [
    { from: 10000002, to: 10000043 }, // Forge -> Domain
    { from: 10000002, to: 10000064 },
    { from: 10000043, to: 10000002 } // Domain -> Forge
];

module.exports = async function (context) {
    context.log('hauling_cache started');
    try {
        const base = process.env.PUBLIC_API_BASE || 'https://evedatafunc01.azurewebsites.net/api';
        for (const p of HOT_PAIRS) {
            const url = `${base}/region_hauling?from_region=${p.from}&to_region=${p.to}&limit=200`;
            try {
                const res = await fetch(url);
                if (!res.ok) continue;
                const data = await res.json();
                const path = `hauling/${p.from}-${p.to}.json`;
                await uploadJsonBlob(path, data, 'public, max-age=1800');
                context.log(`Cached ${path}`);
            } catch (e) {
                context.log(`cache miss for ${p.from}-${p.to}: ${e.message}`);
            }
        }
    } catch (err) {
        context.log.error('hauling_cache failed', err);
        throw err;
    }
};

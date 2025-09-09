// Fetch a region-hauling snapshot from Azure Functions and write it under public/data
// Usage: node scripts/seed-region-hauling-static.cjs <FROM_REGION> <TO_REGION> [limit]

const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');

async function main() {
    const from = process.argv[2];
    const to = process.argv[3];
    const limit = process.argv[4] || '2000';
    if (!from || !to) {
        console.error('Usage: node scripts/seed-region-hauling-static.cjs <FROM_REGION> <TO_REGION> [limit]');
        process.exit(1);
    }

    const AZURE_BASE = (process.env.AZURE_BASE || 'https://evedatafunc01.azurewebsites.net/api').replace(/\/$/, '');
    const url = `${AZURE_BASE}/region_hauling?from_region=${encodeURIComponent(from)}&to_region=${encodeURIComponent(to)}&limit=${encodeURIComponent(limit)}`;
    console.log(`Fetching ${url}`);
    const res = await fetch(url);
    if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`HTTP ${res.status} ${res.statusText} - ${text}`);
    }
    const data = await res.json();
    const payload = JSON.stringify({
        origin_region_id: Number(from),
        destination_region_id: Number(to),
        count: Array.isArray(data.routes) ? data.routes.length : 0,
        routes: Array.isArray(data.routes) ? data.routes : []
    });

    const outDir = path.join(__dirname, '..', 'public', 'data', 'region_hauling');
    fs.mkdirSync(outDir, { recursive: true });
    const outPath = path.join(outDir, `${from}-${to}.json`);
    fs.writeFileSync(outPath, payload);
    console.log(`Wrote ${outPath}`);
}

main().catch((e) => {
    console.error(e.message || e);
    process.exit(1);
});

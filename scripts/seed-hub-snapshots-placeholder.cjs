// Write placeholder hub-to-hub region hauling snapshots into public/data so Pages stops 404-ing
const fs = require('fs');
const path = require('path');

const HUBS = (process.env.HUB_REGIONS || '10000002,10000043,10000032,10000030,10000042')
    .split(',').map(s => s.trim()).filter(Boolean);

const outDir = path.join(__dirname, '..', 'public', 'data', 'region_hauling');
fs.mkdirSync(outDir, { recursive: true });

let count = 0;
for (const from of HUBS) {
    for (const to of HUBS) {
        if (from === to) continue;
        const payload = JSON.stringify({
            origin_region_id: Number(from),
            destination_region_id: Number(to),
            count: 0,
            routes: []
        });
        const filePath = path.join(outDir, `${from}-${to}.json`);
        fs.writeFileSync(filePath, payload);
        count++;
    }
}
console.log(`Wrote ${count} placeholder snapshots to ${outDir}`);

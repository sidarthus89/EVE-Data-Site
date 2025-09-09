#!/usr/bin/env node
// Direct runner to generate region order snapshots for hub regions and upsert to GitHub
// Bypasses Azure Functions host and Azure Storage

const fs = require('fs');
const path = require('path');
const { generateBestQuotesForRegion, upsertRegionSnapshot, sleep } = require('../utils/regionOrders');
const { updateStructuresFromIds } = require('../utils/structures');

function loadLocalSettingsEnv() {
    try {
        const settingsPath = path.resolve(__dirname, '..', 'local.settings.json');
        const raw = fs.readFileSync(settingsPath, 'utf-8');
        const json = JSON.parse(raw);
        const values = json && json.Values ? json.Values : {};
        for (const [k, v] of Object.entries(values)) {
            if (process.env[k] == null) process.env[k] = String(v);
        }
    } catch { /* ignore if missing */ }
}

function getHubRegions() {
    const env = process.env.HUB_REGIONS;
    if (env) return env.split(',').map((s) => Number(s.trim())).filter(Boolean);
    return [10000002, 10000043, 10000032, 10000030, 10000042];
}

async function main() {
    loadLocalSettingsEnv();
    const hubs = getHubRegions();
    console.log(`Generating region order snapshots for ${hubs.length} hubs...`);
    let ok = 0, fail = 0;
    const structureIdSet = new Set();
    for (const regionId of hubs) {
        try {
            console.log(`- Region ${regionId} ...`);
            const snapshot = await generateBestQuotesForRegion(regionId, (msg) => console.log(`[${regionId}] ${msg}`));
            const res = await upsertRegionSnapshot(regionId, snapshot, `chore(region-orders): direct hubs ${regionId}`);
            console.log(`  ✓ committed ${regionId}`, JSON.stringify(res));
            if (Array.isArray(snapshot.structure_ids)) {
                snapshot.structure_ids.forEach((id) => structureIdSet.add(id));
            }
            ok++;
        } catch (e) {
            console.error(`  ✗ failed ${regionId}:`, e.message);
            fail++;
        }
        await sleep(100);
    }
    try {
        const summary = await updateStructuresFromIds(structureIdSet, { log: console });
        console.log(`structures update: updated=${summary.updated} total=${summary.total ?? 'n/a'}`);
    } catch (e) {
        console.error('structures update failed:', e.message);
    }
    console.log(`Done. success=${ok} failed=${fail}`);
}

main().catch((e) => { console.error(e); process.exit(1); });

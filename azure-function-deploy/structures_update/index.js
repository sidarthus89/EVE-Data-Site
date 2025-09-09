const fetch = require('node-fetch');
const { updateStructuresFromIds } = require('../utils/structures');

const GH_RAW = process.env.GH_RAW_BASE || 'https://raw.githubusercontent.com';
const GH_OWNER = process.env.GITHUB_OWNER || 'sidarthus89';
const GH_REPO = process.env.GITHUB_REPO || 'EVE-Data-Site';
const GH_BRANCH_DATA = process.env.GITHUB_BRANCH_DATA || 'gh-pages';

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function listRegionIds() {
    const url = `${GH_RAW}/${GH_OWNER}/${GH_REPO}/${GH_BRANCH_DATA}/data/regions.json`;
    const res = await fetch(url);
    if (!res.ok) return [];
    const data = await res.json();
    const ids = Array.isArray(data) ? data.map(r => r.regionID || r.region_id) : Array.isArray(data.regions) ? data.regions.map(r => r.regionID || r.region_id) : [];
    return ids.filter((v) => Number.isFinite(Number(v))).map(Number);
}

async function fetchSnapshot(regionId) {
    const url = `${GH_RAW}/${GH_OWNER}/${GH_REPO}/${GH_BRANCH_DATA}/data/region_orders/${regionId}.json`;
    const res = await fetch(url);
    if (!res.ok) return null;
    return res.json();
}

function collectIdsFromSnapshot(snapshot) {
    const set = new Set();
    if (!snapshot) return set;
    if (Array.isArray(snapshot.structure_ids)) snapshot.structure_ids.forEach((id) => set.add(id));
    const best = snapshot.best_quotes || {};
    for (const v of Object.values(best)) {
        const bb = v && v.best_buy; const bs = v && v.best_sell;
        if (bb && bb.location_id && bb.location_id > 1000000000000) set.add(bb.location_id);
        if (bs && bs.location_id && bs.location_id > 1000000000000) set.add(bs.location_id);
    }
    return set;
}

module.exports = async function (context, myTimer) {
    const started = Date.now();
    context.log('structures_update tick');
    try {
        const regions = await listRegionIds();
        const union = new Set();
        for (const r of regions) {
            const snap = await fetchSnapshot(r).catch(() => null);
            if (!snap) continue;
            collectIdsFromSnapshot(snap).forEach((id) => union.add(id));
            await sleep(10);
        }
        context.log(`structures_update collected ${union.size} structure ids`);
        const summary = await updateStructuresFromIds(union, context);
        context.log(`structures_update done: updated=${summary.updated} total=${summary.total ?? 'n/a'} in ${Date.now() - started}ms`);
    } catch (e) {
        context.log.error('structures_update failed:', e.message);
        throw e;
    }
};

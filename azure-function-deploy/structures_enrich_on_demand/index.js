const { updateStructuresFromIds } = require('../utils/structures');
const fetch = require('node-fetch');

const GH_RAW = process.env.GH_RAW_BASE || 'https://raw.githubusercontent.com';
const GH_OWNER = process.env.GITHUB_OWNER || 'sidarthus89';
const GH_REPO = process.env.GITHUB_REPO || 'EVE-Data-Site';
const GH_BRANCH_DATA = process.env.GITHUB_BRANCH_DATA || 'gh-pages';

async function fetchRegionIds() {
    const url = `${GH_RAW}/${GH_OWNER}/${GH_REPO}/${GH_BRANCH_DATA}/data/regions.json`;
    const res = await fetch(url);
    if (!res.ok) return [];
    const data = await res.json();
    const arr = Array.isArray(data) ? data : data.regions || [];
    return arr.map(r => r.regionID || r.region_id).filter(n => Number.isFinite(Number(n))).map(Number);
}

async function fetchRegionSnapshot(regionId) {
    const url = `${GH_RAW}/${GH_OWNER}/${GH_REPO}/${GH_BRANCH_DATA}/data/region_orders/${regionId}.json`;
    const res = await fetch(url);
    if (!res.ok) return null;
    return res.json();
}

function extractStructureIds(snapshot) {
    const ids = new Set();
    if (!snapshot) return ids;
    if (Array.isArray(snapshot.structure_ids)) snapshot.structure_ids.forEach(id => ids.add(id));
    const best = snapshot.best_quotes || {};
    for (const v of Object.values(best)) {
        const bb = v?.best_buy; const bs = v?.best_sell;
        if (bb?.location_id && bb.location_id > 1000000000000) ids.add(bb.location_id);
        if (bs?.location_id && bs.location_id > 1000000000000) ids.add(bs.location_id);
    }
    return ids;
}

module.exports = async function (context, req) {
    const started = Date.now();
    try {
        const bodyIds = (req.body && (req.body.ids || req.body.structures)) || [];
        const queryIds = (req.query.ids ? String(req.query.ids).split(',') : []);
        const provided = [...bodyIds, ...queryIds].map(n => Number(n)).filter(n => n > 1000000000000);

        let collected = new Set(provided);
        if (!req.query.skipScan && !req.body?.skipScan) {
            const regionIds = await fetchRegionIds();
            for (const rid of regionIds) {
                const snap = await fetchRegionSnapshot(rid).catch(() => null);
                extractStructureIds(snap).forEach(id => collected.add(id));
            }
        }

        if (collected.size === 0) {
            context.res = { status: 200, jsonBody: { ok: true, updated: 0, total: 0, note: 'no-structure-ids-found' } };
            return;
        }

        const enrichment = await updateStructuresFromIds(collected, context);
        context.res = { status: 200, jsonBody: { ok: true, mode: enrichment.mode, updated: enrichment.updated, total: enrichment.total, elapsed_ms: Date.now() - started } };
    } catch (e) {
        context.log.error('structures_enrich_on_demand failed', e);
        context.res = { status: 500, jsonBody: { ok: false, error: e.message } };
    }
};

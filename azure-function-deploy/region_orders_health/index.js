const fetch = require('node-fetch');

const GH_RAW = process.env.GH_RAW_BASE || 'https://raw.githubusercontent.com';
const GH_OWNER = process.env.GITHUB_OWNER || 'sidarthus89';
const GH_REPO = process.env.GITHUB_REPO || 'EVE-Data-Site';
const GH_BRANCH_DATA = process.env.GITHUB_BRANCH_DATA || 'gh-pages';

function getHubRegions() {
    const env = process.env.HUB_REGIONS;
    if (env) return env.split(',').map(s => Number(s.trim())).filter(Boolean);
    return [10000002, 10000043, 10000032, 10000030, 10000042];
}

async function fetchSnapshot(regionId) {
    const url = `${GH_RAW}/${GH_OWNER}/${GH_REPO}/${GH_BRANCH_DATA}/data/region_orders/${regionId}.json`;
    try {
        const res = await fetch(url, { headers: { 'User-Agent': 'EVE-Data-Site-Health' } });
        if (res.status === 404) return { exists: false };
        if (!res.ok) return { exists: false, error: `status ${res.status}` };
        const json = await res.json();
        return { exists: true, last_updated: json.last_updated, count_types: json.best_quotes ? Object.keys(json.best_quotes).length : 0 };
    } catch (e) {
        return { exists: false, error: e.message };
    }
}

module.exports = async function (context, req) {
    const hubs = getHubRegions();
    const queryRegions = req.query.regions ? req.query.regions.split(',').map(r => Number(r.trim())).filter(Boolean) : [];
    const targets = queryRegions.length ? queryRegions : hubs;
    const results = [];
    for (const id of targets) { // sequential to avoid GH raw rate limit bursts
        // eslint-disable-next-line no-await-in-loop
        const snap = await fetchSnapshot(id);
        results.push({ region_id: id, ...snap });
    }
    const missing = results.filter(r => !r.exists).map(r => r.region_id);
    context.res = {
        status: 200,
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
        body: { checked: targets.length, missing, results }
    };
};

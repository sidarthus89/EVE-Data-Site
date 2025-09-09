const fetch = require('node-fetch');
const { upsertDataToAll } = require('../utils/github');

const ESI_BASE = process.env.ESI_BASE || 'https://esi.evetech.net/latest';
const GH_RAW = process.env.GH_RAW_BASE || 'https://raw.githubusercontent.com';
const GH_OWNER = process.env.GITHUB_OWNER || 'sidarthus89';
const GH_REPO = process.env.GITHUB_REPO || 'EVE-Data-Site';
const GH_BRANCH_DATA = process.env.GITHUB_BRANCH_DATA || 'gh-pages';

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function buildUrl(endpoint) {
    if (endpoint.startsWith('http')) return endpoint;
    return `${ESI_BASE}${endpoint}`;
}

async function fetchJson(url, options = {}, retries = 3) {
    for (let i = 0; i <= retries; i++) {
        const res = await fetch(url, options);
        if (res.ok) return res;
        const { status } = res;
        if (status === 420 || status === 429 || status >= 500) {
            await sleep(250 + i * 250);
            continue;
        }
        const text = await res.text().catch(() => '');
        throw new Error(`HTTP ${status}: ${res.statusText} ${text}`);
    }
    throw new Error('request failed after retries');
}

// Discover available region snapshots from the gh-pages branch
async function listRegionSnapshotIds() {
    const regionsUrl = `${GH_RAW}/${GH_OWNER}/${GH_REPO}/${GH_BRANCH_DATA}/data/regions.json`;
    const res = await fetch(regionsUrl);
    if (res.ok) {
        const data = await res.json();
        const ids = Array.isArray(data) ? data.map(r => r.regionID || r.region_id) : Array.isArray(data.regions) ? data.regions.map(r => r.regionID || r.region_id) : [];
        return ids.filter((v) => Number.isFinite(Number(v))).map(Number);
    }
    const esi = await fetch(buildUrl('/universe/regions/'), { headers: { 'User-Agent': 'EVE-Data-Site-Functions' } });
    if (!esi.ok) throw new Error(`Failed to load regions from gh-pages (${res.status}) and ESI (${esi.status})`);
    const ids = await esi.json();
    return Array.isArray(ids) ? ids.filter(n => Number.isFinite(Number(n))).map(Number) : [];
}

async function fetchRegionOrdersSnapshot(regionId) {
    const url = `${GH_RAW}/${GH_OWNER}/${GH_REPO}/${GH_BRANCH_DATA}/data/region_orders/${regionId}.json`;
    const res = await fetch(url);
    if (!res.ok) return null;
    return res.json();
}

function collectStructureIdsFromSnapshot(snapshot) {
    const set = new Set();
    if (!snapshot || typeof snapshot !== 'object') return set;
    if (Array.isArray(snapshot.structure_ids)) {
        for (const id of snapshot.structure_ids) {
            const n = Number(id);
            if (Number.isFinite(n) && n > 1000000000000) set.add(n);
        }
    }
    const best = snapshot.best_quotes || {};
    for (const v of Object.values(best)) {
        const bb = v && v.best_buy; const bs = v && v.best_sell;
        if (bb && bb.location_id && bb.location_id > 1000000000000) set.add(bb.location_id);
        if (bs && bs.location_id && bs.location_id > 1000000000000) set.add(bs.location_id);
    }
    return set;
}

async function getAccessTokenIfAvailable() {
    const refresh = process.env.ESI_REFRESH_TOKEN;
    const clientId = process.env.ESI_CLIENT_ID;
    const secret = process.env.ESI_CLIENT_SECRET;
    if (!refresh || !clientId || !secret) return null;
    const auth = Buffer.from(`${clientId}:${secret}`).toString('base64');
    const res = await fetch('https://login.eveonline.com/v2/oauth/token', {
        method: 'POST',
        headers: {
            'Authorization': `Basic ${auth}`,
            'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: new URLSearchParams({
            grant_type: 'refresh_token',
            refresh_token: refresh
        })
    });
    if (!res.ok) return null;
    const json = await res.json();
    return json.access_token || null;
}

async function fetchSystemInfo(systemId) {
    const res = await fetchJson(buildUrl(`/universe/systems/${systemId}/`), { headers: { 'User-Agent': 'EVE-Data-Site-Functions' } });
    const json = await res.json();
    return { region_id: json.region_id, security: typeof json.security_status === 'number' ? json.security_status : null };
}

async function fetchStructureDetail(structureId, bearer) {
    if (!bearer) return null;
    const res = await fetch(buildUrl(`/universe/structures/${structureId}/`), {
        headers: {
            'Authorization': `Bearer ${bearer}`,
            'User-Agent': 'EVE-Data-Site-Functions'
        }
    });
    if (!res.ok) return null;
    const json = await res.json();
    const sys = await fetchSystemInfo(json.solar_system_id).catch(() => null);
    return {
        structureID: structureId,
        name: json.name,
        ownerID: json.owner_id,
        systemID: json.solar_system_id,
        regionID: sys?.region_id || null,
        security: sys?.security ?? null,
        structure_id: structureId,
        owner_id: json.owner_id,
        solar_system_id: json.solar_system_id,
        type_id: json.type_id,
    };
}

async function run(context) {
    const start = Date.now();
    const regionIds = await listRegionSnapshotIds();
    const union = new Set();
    for (const rid of regionIds) {
        const snap = await fetchRegionOrdersSnapshot(rid).catch(() => null);
        if (!snap) continue;
        const set = collectStructureIdsFromSnapshot(snap);
        for (const id of set) union.add(id);
        await sleep(15);
    }

    const ids = Array.from(union);
    context.log(`Found ${ids.length} structure ids from region orders`);

    const bearer = await getAccessTokenIfAvailable();
    const results = [];
    const CONC = Math.max(1, Number(process.env.STRUCTURES_ENRICH_CONCURRENCY || 6));
    let idx = 0;
    async function worker() {
        while (idx < ids.length) {
            const id = ids[idx++];
            try {
                const rec = await fetchStructureDetail(id, bearer);
                if (rec) results.push(rec);
            } catch { }
            await sleep(50);
        }
    }
    await Promise.all(Array.from({ length: CONC }, () => worker()));

    let targets = [];
    if (results.length > 0) {
        const body = JSON.stringify(results);
        const relPath = 'structures/structures.json';
        const message = `chore(structures): update from region orders (${results.length} structures)`;
        targets = await upsertDataToAll(relPath, body, message);
    } else {
        context.log('No structures discovered from region orders; skipping GitHub upsert.');
    }

    const elapsed = Date.now() - start;
    return { idsCount: ids.length, count: results.length, elapsed, targets };
}

module.exports = async function (context) {
    context.log('old_structures_from_orders invoked (deprecated)');
    const summary = await run(context);
    context.log(JSON.stringify(summary));
};

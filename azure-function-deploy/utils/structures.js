const fetch = require('node-fetch');
const { upsertDataToAll } = require('./github');

const ESI_BASE = process.env.ESI_BASE || 'https://esi.evetech.net/latest';
const GH_RAW = process.env.GH_RAW_BASE || 'https://raw.githubusercontent.com';
const GH_OWNER = process.env.GITHUB_OWNER || 'sidarthus89';
const GH_REPO = process.env.GITHUB_REPO || 'EVE-Data-Site';
const GH_BRANCH_DATA = process.env.GITHUB_BRANCH_DATA || 'gh-pages';
const GH_BRANCH_MAIN = process.env.GITHUB_BRANCH || 'main';

function buildUrl(endpoint) {
    if (endpoint.startsWith('http')) return endpoint;
    return `${ESI_BASE}${endpoint}`;
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function fetchJson(url, options = {}, retries = 3) {
    for (let i = 0; i <= retries; i++) {
        const res = await fetch(url, options);
        if (res.ok) return res;
        const { status } = res;
        if (status === 420 || status === 429 || status >= 500) {
            await sleep(200 + i * 200);
            continue;
        }
        const text = await res.text().catch(() => '');
        throw new Error(`HTTP ${status}: ${res.statusText} ${text}`);
    }
    throw new Error('request failed after retries');
}

async function getAccessTokenIfAvailable() {
    const direct = process.env.ESI_ACCESS_TOKEN;
    if (direct) return direct;
    const refresh = process.env.ESI_REFRESH_TOKEN;
    const clientId = process.env.ESI_CLIENT_ID;
    const secret = process.env.ESI_CLIENT_SECRET;
    if (!refresh || !clientId || !secret) return null;
    const auth = Buffer.from(`${clientId}:${secret}`).toString('base64');
    const res = await fetch('https://login.eveonline.com/v2/oauth/token', {
        method: 'POST',
        headers: {
            Authorization: `Basic ${auth}`,
            'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refresh }),
    });
    if (!res.ok) return null;
    const json = await res.json();
    return json.access_token || null;
}

const systemCache = new Map();
const regionNameCache = new Map();

async function fetchSystem(systemId) {
    if (systemCache.has(systemId)) return systemCache.get(systemId);
    const res = await fetchJson(buildUrl(`/universe/systems/${systemId}/`), {
        headers: { 'User-Agent': 'EVE-Data-Site-Functions' },
    });
    const json = await res.json();
    const info = { id: systemId, name: json.name, region_id: json.region_id, security: json.security_status };
    systemCache.set(systemId, info);
    return info;
}

async function fetchRegionName(regionId) {
    if (regionNameCache.has(regionId)) return regionNameCache.get(regionId);
    const res = await fetchJson(buildUrl(`/universe/regions/${regionId}/`), {
        headers: { 'User-Agent': 'EVE-Data-Site-Functions' },
    });
    const json = await res.json();
    const name = json.name;
    regionNameCache.set(regionId, name);
    return name;
}

async function fetchStructureDetail(structureId, bearer) {
    if (!bearer) return null; // require auth for structures endpoint
    const res = await fetch(buildUrl(`/universe/structures/${structureId}/`), {
        headers: {
            Authorization: `Bearer ${bearer}`,
            'User-Agent': 'EVE-Data-Site-Functions',
        },
    });
    if (!res.ok) return null;
    const json = await res.json();
    const sys = await fetchSystem(json.solar_system_id).catch(() => null);
    const regionName = sys ? await fetchRegionName(sys.region_id).catch(() => null) : null;
    return {
        stationID: String(structureId),
        locationName: json.name,
        regionID: sys?.region_id || null,
        regionName: regionName || null,
        systemID: json.solar_system_id,
        systemName: sys?.name || null,
        security: typeof sys?.security === 'number' ? sys.security : null,
        type: 'player',
    };
}

// Merge new records with existing file (append/update), preserving prior enriched entries.
function mergeStructures(existing, incoming) {
    const map = new Map();
    for (const rec of existing || []) {
        if (rec && rec.stationID) map.set(String(rec.stationID), rec);
    }
    for (const rec of incoming || []) {
        if (rec && rec.stationID) map.set(String(rec.stationID), rec);
    }
    return Array.from(map.values());
}

async function readExistingStructures() {
    // Prefer gh-pages data path, fallback to main
    const urls = [
        `${GH_RAW}/${GH_OWNER}/${GH_REPO}/${GH_BRANCH_DATA}/data/structures.json`,
        `${GH_RAW}/${GH_OWNER}/${GH_REPO}/${GH_BRANCH_MAIN}/public/data/structures.json`,
    ];
    for (const url of urls) {
        try {
            const res = await fetch(url);
            if (res.ok) {
                const json = await res.json();
                if (Array.isArray(json)) return json;
            }
        } catch { /* ignore */ }
    }
    return [];
}

async function upsertStructures(list) {
    const body = JSON.stringify(list);
    const relPath = 'structures.json';
    const message = `chore(structures): merge update from region orders (${list.length} structures)`;
    return upsertDataToAll(relPath, body, message);
}

async function updateStructuresFromIds(structureIds, context) {
    const ids = Array.from(structureIds || []).filter((n) => Number(n) > 1000000000000);
    if (ids.length === 0) return { ok: true, updated: 0, skipped: 'no-ids' };
    const bearer = await getAccessTokenIfAvailable();
    if (!bearer) {
        context && context.log && context.log('No ESI access token; skipping structures enrichment');
        return { ok: false, updated: 0, skipped: 'no-token' };
    }
    const results = [];
    let idx = 0;
    const CONC = Math.max(1, Number(process.env.STRUCTURES_ENRICH_CONCURRENCY || 6));
    async function worker() {
        while (idx < ids.length) {
            const id = ids[idx++];
            try {
                const rec = await fetchStructureDetail(id, bearer);
                if (rec) results.push(rec);
            } catch {
                // ignore individual errors
            }
            await sleep(50);
        }
    }
    await Promise.all(Array.from({ length: CONC }, () => worker()));

    // Read existing, merge, then write
    const existing = await readExistingStructures().catch(() => []);
    const merged = mergeStructures(existing, results);
    const targets = await upsertStructures(merged);
    return { ok: true, updated: results.length, total: merged.length, targets, mode: 'merge' };
}

module.exports = {
    updateStructuresFromIds,
};

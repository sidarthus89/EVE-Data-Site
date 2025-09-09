// Local-only: Pull structures from ESI and write ../public/data/structures.json
// Env required: ESI_CLIENT_ID, ESI_CLIENT_SECRET, ESI_REFRESH_TOKEN
// Optional:
//   - STRUCTURES_CONCURRENCY (default 8)
//   - STRUCTURES_MARKET_PROBE = off | loose | strict (default off)
//   - STRUCTURES_DEBUG = 1 (prints HTTP status tallies)
//   - STRUCTURES_INCLUDE_SNAPSHOT_IDS = 1 (union structure IDs seen in region_order snapshots)
//   - STRUCTURES_INCLUDE_PLACEHOLDERS = 1 (emit placeholder rows when metadata is not readable)
//   - STRUCTURES_IDS_JSON = path to JSON array of extra structure IDs to include
/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');

// Best-effort load of dotenv if available (not required)
// Load env from current folder, else fall back to repo root (../../.env)
try { require('dotenv').config(); } catch { }
if (!process.env.ESI_CLIENT_ID || !process.env.ESI_CLIENT_SECRET || !process.env.ESI_REFRESH_TOKEN) {
    try { require('dotenv').config({ path: path.resolve(__dirname, '..', '..', '.env') }); } catch { }
}

const CLIENT_ID = process.env.ESI_CLIENT_ID;
const CLIENT_SECRET = process.env.ESI_CLIENT_SECRET;
const REFRESH_TOKEN = process.env.ESI_REFRESH_TOKEN;
const DEBUG = /^(1|true)$/i.test(String(process.env.STRUCTURES_DEBUG || ''));
const MARKET_PROBE_MODE = String(process.env.STRUCTURES_MARKET_PROBE || 'off').toLowerCase();
const PROBE_MARKET = MARKET_PROBE_MODE !== 'off';
const STRICT_MARKET = MARKET_PROBE_MODE === 'strict';
const CONCURRENCY = Number(process.env.STRUCTURES_CONCURRENCY || 8);
const INCLUDE_SNAPSHOT_IDS = /^(1|true)$/i.test(String(process.env.STRUCTURES_INCLUDE_SNAPSHOT_IDS || ''));
const INCLUDE_PLACEHOLDERS = /^(1|true)$/i.test(String(process.env.STRUCTURES_INCLUDE_PLACEHOLDERS || ''));
const EXTRA_IDS_JSON = process.env.STRUCTURES_IDS_JSON ? path.resolve(process.cwd(), process.env.STRUCTURES_IDS_JSON) : null;

if (!CLIENT_ID || !CLIENT_SECRET || !REFRESH_TOKEN) {
    console.error('Missing ESI env vars. Please set ESI_CLIENT_ID, ESI_CLIENT_SECRET, ESI_REFRESH_TOKEN (in ../../.env or your shell)');
    process.exit(1);
}

const statusCounts = new Map();
function countStatus(code) {
    if (!DEBUG) return;
    const k = String(code);
    statusCounts.set(k, (statusCounts.get(k) || 0) + 1);
}
async function getAccessToken() {
    const auth = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64');
    const res = await fetch('https://login.eveonline.com/v2/oauth/token', {
        method: 'POST',
        headers: {
            Authorization: `Basic ${auth}`,
            'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: REFRESH_TOKEN }),
    });
    if (!res.ok) {
        const t = await res.text();
        throw new Error(`ESI token refresh failed ${res.status}: ${t}`);
    }
    const json = await res.json();
    return json.access_token;
}

async function listStructureIds(accessToken) {
    const res = await fetch('https://esi.evetech.net/latest/universe/structures/', {
        headers: { Authorization: `Bearer ${accessToken}`, 'User-Agent': 'EVE-Data-Site/local-sync' },
    });
    if (!res.ok) throw new Error(`List structures failed ${res.status}`);
    return res.json();
}

const systemCache = new Map();
async function getSystemInfo(systemId) {
    if (!systemId) return null;
    if (systemCache.has(systemId)) return systemCache.get(systemId);
    const res = await fetch(`https://esi.evetech.net/latest/universe/systems/${systemId}/`, {
        headers: { 'User-Agent': 'EVE-Data-Site/local-sync' },
    });
    if (!res.ok) { countStatus(res.status); systemCache.set(systemId, null); return null; }
    const json = await res.json();
    const info = { region_id: json.region_id, security: typeof json.security_status === 'number' ? json.security_status : null };
    systemCache.set(systemId, info);
    return info;
}

async function probeStructure(accessToken, id) {
    // Structure metadata (public docking visibility)
    const sRes = await fetch(`https://esi.evetech.net/latest/universe/structures/${id}/`, {
        headers: { Authorization: `Bearer ${accessToken}`, 'User-Agent': 'EVE-Data-Site/local-sync' },
    });
    countStatus(sRes.status);
    if (!sRes.ok) return null; // not visible
    const s = await sRes.json();

    // Optional market probe (public market readability)
    if (PROBE_MARKET) {
        const typeIdProbe = 34; // Tritanium
        const mRes = await fetch(`https://esi.evetech.net/latest/markets/structures/${id}/?type_id=${typeIdProbe}`, {
            headers: { Authorization: `Bearer ${accessToken}`, 'User-Agent': 'EVE-Data-Site/local-sync' },
        });
        countStatus(mRes.status);
        if (STRICT_MARKET) {
            // In strict mode, drop on 403 or unexpected error
            if (mRes.status === 403) return null;
            if (!mRes.ok && mRes.status !== 404) return null;
        } else {
            // Non-strict: ignore 403/others; still include the structure
        }
    }

    const sys = await getSystemInfo(s.solar_system_id);
    return {
        structureID: id,
        name: s.name,
        ownerID: s.owner_id,
        systemID: s.solar_system_id,
        regionID: sys?.region_id || null,
        security: sys?.security ?? null,
    };
}

function isLikelyStructureId(id) {
    // Keep very large IDs (Upwell structures), exclude stations (smaller ids)
    return typeof id === 'number' && id >= 1_000_000_000_000; // 1e12
}

function extractLocationIdsFromJson(data, setOut) {
    // Try common shapes: array of orders, object with orders, or nested arrays
    if (Array.isArray(data)) {
        for (const o of data) {
            const lid = o && o.location_id;
            if (isLikelyStructureId(lid)) setOut.add(lid);
        }
        return;
    }
    if (data && typeof data === 'object') {
        const tryArrays = [];
        if (Array.isArray(data.orders)) tryArrays.push(data.orders);
        if (Array.isArray(data.sell)) tryArrays.push(data.sell);
        if (Array.isArray(data.buy)) tryArrays.push(data.buy);
        if (Array.isArray(data.marketOrders)) tryArrays.push(data.marketOrders);
        if (Array.isArray(data.best_quotes)) {
            for (const q of data.best_quotes) {
                const lid = q && (q.sell_location_id || q.buy_location_id || q.location_id);
                if (isLikelyStructureId(lid)) setOut.add(lid);
            }
        }
        for (const arr of tryArrays) {
            for (const o of arr) {
                const lid = o && o.location_id;
                if (isLikelyStructureId(lid)) setOut.add(lid);
            }
        }
    }
}

async function collectSnapshotStructureIds() {
    const ids = new Set();
    const root = path.resolve(__dirname, '..', '..', 'public', 'data', 'region_orders');
    if (!fs.existsSync(root)) return ids;
    const files = fs.readdirSync(root).filter(f => f.endsWith('.json'));
    for (const f of files) {
        try {
            const full = path.join(root, f);
            const text = fs.readFileSync(full, 'utf-8');
            const json = JSON.parse(text);
            extractLocationIdsFromJson(json, ids);
        } catch { /* ignore parse errors */ }
    }
    return ids;
}

function collectExtraIdsFromFile() {
    const out = new Set();
    if (!EXTRA_IDS_JSON) return out;
    try {
        const raw = fs.readFileSync(EXTRA_IDS_JSON, 'utf-8');
        const arr = JSON.parse(raw);
        if (Array.isArray(arr)) {
            for (const v of arr) { if (isLikelyStructureId(v)) out.add(v); }
        }
    } catch { /* ignore */ }
    return out;
}

async function main() {
    const started = Date.now();
    console.log('🔑 Getting ESI access token...');
    const token = await getAccessToken();
    console.log('📋 Listing structures...');
    const esiIds = await listStructureIds(token);
    let idSet = new Set(esiIds);

    if (INCLUDE_SNAPSHOT_IDS) {
        console.log('➕ Collecting structure IDs from region_order snapshots...');
        const snapIds = await collectSnapshotStructureIds();
        console.log(`  Found ${snapIds.size} unique structure IDs in snapshots.`);
        for (const v of snapIds) idSet.add(v);
    }
    if (EXTRA_IDS_JSON) {
        console.log(`➕ Collecting extra IDs from ${EXTRA_IDS_JSON} ...`);
        const extra = collectExtraIdsFromFile();
        console.log(`  Found ${extra.size} extra IDs.`);
        for (const v of extra) idSet.add(v);
    }

    const ids = Array.from(idSet);
    console.log(`Found ${ids.length} unique structure IDs. Probing with concurrency=${CONCURRENCY} (marketProbe=${MARKET_PROBE_MODE})...`);

    const results = [];
    let index = 0;
    let processed = 0;

    async function worker() {
        while (index < ids.length) {
            const id = ids[index++];
            try {
                const rec = await probeStructure(token, id);
                if (rec) {
                    results.push(rec);
                } else if (INCLUDE_PLACEHOLDERS) {
                    results.push({
                        structureID: id,
                        name: `Structure ${id}`,
                        ownerID: null,
                        systemID: null,
                        regionID: null,
                        security: null,
                        placeholder: true,
                    });
                }
            } catch { }
            processed++;
            if (processed % 200 === 0) {
                console.log(`...processed ${processed}/${ids.length} (kept ${results.length})`);
            }
        }
    }

    await Promise.all(Array.from({ length: CONCURRENCY }, worker));

    // Ensure output folder exists
    const outDir = path.resolve(__dirname, '..', '..', 'public', 'data');
    const outFile = path.join(outDir, 'structures.json');
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(outFile, JSON.stringify(results, null, 2) + '\n', 'utf-8');

    const ms = Date.now() - started;
    console.log(`✅ Wrote ${results.length} structures to ${outFile} in ${ms}ms`);
    if (DEBUG) {
        console.log('HTTP status tallies:', Object.fromEntries(statusCounts));
    }
    console.log('Commit and push to publish.');
}

main().catch(err => {
    console.error('❌ Sync failed:', err.message || err);
    process.exit(1);
});

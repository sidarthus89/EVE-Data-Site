const fetch = require('node-fetch');
const { uploadJsonBlob } = require('../utils/blob');

// Requires ESI refresh flow via env secrets
// EVE ESI: POST https://login.eveonline.com/v2/oauth/token
// Scope: esi-universe.read_structures.v1

async function getAccessToken() {
    const refresh = process.env.ESI_REFRESH_TOKEN;
    const clientId = process.env.ESI_CLIENT_ID;
    const secret = process.env.ESI_CLIENT_SECRET;
    if (!refresh || !clientId || !secret) throw new Error('ESI OAuth env vars missing');

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
    if (!res.ok) {
        const t = await res.text();
        throw new Error(`ESI token refresh failed ${res.status}: ${t}`);
    }
    const json = await res.json();
    return json.access_token;
}

async function fetchDockableMarketStructures(accessToken) {
    // Strategy: read structure IDs from /universe/structures (requires auth) but many are inaccessible.
    // Then filter by public/market availability by attempting GET /universe/structures/{structure_id}/ with token.
    const idsRes = await fetch('https://esi.evetech.net/latest/universe/structures/', {
        headers: {
            'Authorization': `Bearer ${accessToken}`,
            'User-Agent': 'EVE-Data-Site/1.0 (structures sync)'
        }
    });
    if (!idsRes.ok) throw new Error(`ESI structures list failed ${idsRes.status}`);
    const ids = await idsRes.json();

    const results = [];
    // limit concurrent fetches to avoid 420/429
    const concurrency = 10;
    let index = 0;

    async function worker() {
        while (index < ids.length) {
            const id = ids[index++];
            try {
                const sRes = await fetch(`https://esi.evetech.net/latest/universe/structures/${id}/`, {
                    headers: {
                        'Authorization': `Bearer ${accessToken}`,
                        'User-Agent': 'EVE-Data-Site/1.0 (structures sync)'
                    }
                });
                if (!sRes.ok) continue; // skip inaccessible
                const s = await sRes.json();
                // Heuristic: markets are usually service present or type indicates market hub (Keepstar, Fortizar etc.). ESI doesn't expose services for structures.
                // We'll include all successful ones; frontend can filter by known market regions or historical list.
                results.push({
                    structure_id: id,
                    name: s.name,
                    owner_id: s.owner_id,
                    solar_system_id: s.solar_system_id,
                    type_id: s.type_id,
                    position: s.position
                });
            } catch (_) { /* ignore */ }
        }
    }

    await Promise.all(Array.from({ length: concurrency }, worker));
    return results;
}

module.exports = async function (context) {
    context.log('structures_sync timer started');
    try {
        const token = await getAccessToken();
        const data = await fetchDockableMarketStructures(token);

        // Write to blob as structures.json
        const path = 'structures/structures.json';
        const url = await uploadJsonBlob(path, data, 'public, max-age=3600');
        context.log(`Uploaded ${data.length} structures to ${url}`);
    } catch (err) {
        context.log.error('structures_sync failed', err);
        throw err;
    }
};

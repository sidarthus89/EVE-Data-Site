// handlers/kv.js

const JSON_HEADERS = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
};

function safeParse(json) {
    try {
        return JSON.parse(json);
    } catch {
        return null;
    }
}

function jsonResponse(data, status = 200) {
    const body = typeof data === 'string' ? data : JSON.stringify(data);
    return new Response(body, {
        status,
        headers: JSON_HEADERS,
    });
}

async function handleKVFetch(env, namespace, key, label) {
    const raw = await env[namespace]?.get(key);

    console.log(`[KV] ${label} raw preview:`, raw?.slice(0, 200));

    if (!raw || raw.trim() === '') {
        console.warn(`[KV] ${label} missing or empty`);
        return jsonResponse({ error: `${label} not found or empty in KV` }, 500);
    }

    const parsed = safeParse(raw);
    if (!parsed) {
        console.warn(`[KV] ${label} contains invalid JSON`);
        return jsonResponse({ error: `Invalid JSON in ${label}`, detail: raw }, 500);
    }

    return jsonResponse(parsed);
}

export async function handleMarketTree(request, env) {
    return handleKVFetch(env, 'MARKET_TREE', 'market:tree', 'market:tree');
}

export async function handleLocations(request, env) {
    try {
        const raw = await env.LOCATIONS.get("locations:all");
        if (!raw) throw new Error("KV 'locations:all' is empty");

        const parsed = JSON.parse(raw);
        const regionLookup = {};

        for (const regionName in parsed) {
            const regionBlock = parsed[regionName];
            const regionID = regionBlock?.regionID;

            if (regionID && regionName) {
                regionLookup[regionID] = regionName;
            }
        }

        return new Response(JSON.stringify({ regionLookup }), {
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            }
        });
    } catch (err) {
        console.error("❌ handleLocations failed:", err);
        return new Response(`Internal error: ${err.message}`, { status: 500 });
    }
}

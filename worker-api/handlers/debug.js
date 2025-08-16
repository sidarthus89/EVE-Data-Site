// worker-api/handlers/debug.js

export async function onRequest({ request, env }) {
    const url = new URL(request.url);

    if (url.pathname === "/api/debug/market-tree") {
        return handleDebugKV(env.MARKET_TREE, "market:tree");
    }

    if (url.pathname === "/api/debug/locations") {
        return handleDebugKV(env.LOCATIONS, "locations:all");
    }

    if (url.pathname === "/api/debug/clean-kv") {
        return handleCleanKV(env);
    }

    return new Response("Unknown debug route", { status: 404 });
}

export async function handleDebugKV(env, key) {
    const raw = await env.get(key);
    return new Response(`${key}:\n${raw}`, {
        headers: { 'Content-Type': 'text/plain' }
    });
}

export async function handleCleanKV(env) {
    const marketRaw = await env.MARKET_TREE.get("market:tree");
    const locationRaw = await env.LOCATIONS.get("locations:all");

    let marketParsed, locationParsed;
    let messages = [];

    try {
        marketParsed = JSON.parse(marketRaw);
        await env.MARKET_TREE.put("market:tree", JSON.stringify(marketParsed));
        messages.push("✅ market:tree cleaned");
    } catch (err) {
        messages.push(`❌ market:tree invalid JSON:\n${marketRaw}`);
    }

    try {
        locationParsed = JSON.parse(locationRaw);
        await env.LOCATIONS.put("locations:all", JSON.stringify(locationParsed));
        messages.push("✅ locations:all cleaned");
    } catch (err) {
        messages.push(`❌ locations:all invalid JSON:\n${locationRaw}`);
    }

    return new Response(messages.join("\n\n"), {
        headers: { 'Content-Type': 'text/plain' }
    });
}

// Add this to your handlers/debug.js or create a new debug handler

export async function handleDebugOrders(request, env) {
    try {
        const url = new URL(request.url);
        const regionID = Number(url.searchParams.get('regionID')) || 10000002; // Default to The Forge

        // Import your fetcher
        const { fetchMarketOrdersFromBackend } = await import('../utils/fetchers.js');

        const orders = await fetchMarketOrdersFromBackend(regionID);

        // Get some stats
        const buyOrders = orders.filter(o => o.is_buy_order);
        const sellOrders = orders.filter(o => !o.is_buy_order);
        const uniqueTypes = new Set(orders.map(o => o.type_id));

        return new Response(JSON.stringify({
            regionID,
            totalOrders: orders.length,
            buyOrders: buyOrders.length,
            sellOrders: sellOrders.length,
            uniqueItemTypes: uniqueTypes.size,
            sampleOrders: orders.slice(0, 5), // First 5 orders for inspection
            uniqueTypesPreview: Array.from(uniqueTypes).slice(0, 20) // First 20 type IDs
        }, null, 2), {
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            }
        });

    } catch (err) {
        return new Response(JSON.stringify({
            error: err.message,
            stack: err.stack
        }), {
            status: 500,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            }
        });
    }
}

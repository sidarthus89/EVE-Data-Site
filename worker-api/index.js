// worker-api/index.js
import { handleMarketOrders } from './handlers/market-orders.js';
import { handlePriceHistory } from './handlers/price-history.js';
import { handleMarketDistribution } from './handlers/market-distribution.js';
import { proxyToESI } from './utils/proxy.js';

import { handleMarketTree, handleLocations } from './handlers/kv.js';
import * as debugHandler from './handlers/debug.js';

import marketData from './data/market.json';
import locationsData from './data/locations.json';

export default {
    async fetch(request, env, ctx) {
        const url = new URL(request.url);
        const pathname = url.pathname;

        // ✅ Use runtime-safe IS_DEV from Wrangler vars
        const IS_DEV = env.IS_DEV === 'true';

        const WORKER_ESI_BASE = IS_DEV
            ? 'http://localhost:8787/markets/'
            : 'https://eve-data-api.sidarthus89.workers.dev/markets/';

        const WORKER_KV_BASE = IS_DEV
            ? 'http://localhost:8787/api/'
            : 'https://eve-data-api.sidarthus89.workers.dev/api/';

        // 🔁 Proxy raw ESI routes
        if (pathname.startsWith('/markets/')) {
            return proxyToESI(url);
        }

        // 📦 Route map
        const routeMap = {
            '/market-orders': () => handleMarketOrders(url, env),
            '/price-history': () => handlePriceHistory(url),
            '/market-distribution': () => handleMarketDistribution(url, env),
            '/api/market-tree': () => handleMarketTree(request, env),
            '/api/locations': () => handleLocations(request, env),
            '/api/debug/kv': () => handleDebugKV(env),
            '/api/debug/market-tree': () => debugHandler.onRequest({ request, env }),
            '/api/debug/locations': () => debugHandler.onRequest({ request, env }),
            '/api/debug/clean-kv': () => handleCleanKV(env),
            '/api/seed': () =>
                request.method === 'POST'
                    ? seedKV(env)
                    : new Response('Method Not Allowed', { status: 405 })
        };

        if (routeMap[pathname]) {
            return routeMap[pathname]();
        }

        return new Response('Not found', { status: 404 });
    }
};

// 🧪 Debug KV summary (internal KV reads)
async function handleDebugKV(env) {
    const marketRaw = await env.MARKET_TREE.get("market:tree");
    const locationRaw = await env.LOCATIONS.get("locations:all");

    // 🔍 Log raw KV contents for inspection
    console.log("📦 Raw KV: market:tree =", marketRaw?.slice(0, 500));
    console.log("📦 Raw KV: locations:all =", locationRaw?.slice(0, 500));

    let marketTree = [];
    let locations = [];

    try {
        marketTree = JSON.parse(marketRaw || '[]');
    } catch (e) {
        console.warn('⚠️ Failed to parse market:tree', e);
    }

    try {
        locations = JSON.parse(locationRaw || '[]');
    } catch (e) {
        console.warn('⚠️ Failed to parse locations:all', e);
    }

    return new Response(JSON.stringify({
        marketTreePreview: Array.isArray(marketTree) ? marketTree.slice(0, 500) : [],
        locationsPreview: Array.isArray(locations) ? locations.slice(0, 500) : [],
        marketTreeType: typeof marketTree,
        locationsType: typeof locations
    }, null, 2), {
        headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*'
        }
    });
}

// 🧼 Cleaner logic
async function handleCleanKV(env) {
    const marketRaw = await env.MARKET_TREE.get("market:tree");
    const locationRaw = await env.LOCATIONS.get("locations:all");

    let messages = [];

    try {
        const parsedMarket = JSON.parse(marketRaw);
        await env.MARKET_TREE.put("market:tree", JSON.stringify(parsedMarket));
        messages.push("✅ market:tree cleaned");
    } catch (err) {
        messages.push(`❌ market:tree invalid JSON:\n${marketRaw}`);
    }

    try {
        const parsedLocations = JSON.parse(locationRaw);
        await env.LOCATIONS.put("locations:all", JSON.stringify(parsedLocations));
        messages.push("✅ locations:all cleaned");
    } catch (err) {
        messages.push(`❌ locations:all invalid JSON:\n${locationRaw}`);
    }

    return new Response(messages.join("\n\n"), {
        headers: {
            'Content-Type': 'text/plain',
            'Access-Control-Allow-Origin': '*'
        }
    });
}

// 🚀 Seeder logic
async function seedKV(env) {
    try {
        const marketString = JSON.stringify(marketData);
        const locationsString = JSON.stringify(locationsData);

        await env.MARKET_TREE.put('market:tree', marketString);
        await env.LOCATIONS.put('locations:all', locationsString);

        return new Response(JSON.stringify({
            message: 'KV seeded successfully',
            marketPreview: marketString.slice(0, 300),
            locationsPreview: locationsString.slice(0, 300)
        }, null, 2), {
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            }
        });
    } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), {
            status: 500,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            }
        });
    }
}
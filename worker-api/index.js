// worker-api/index.js
import { handleMarketOrders } from './handlers/market-orders.js';
import { handlePriceHistory } from './handlers/price-history.js';
import { handleMarketDistribution } from './handlers/market-distribution.js';
import { proxyToESI } from './utils/proxy.js';
import { handleTradeRoute } from './handlers/trade-route.js';
import { handleMarketTree, handleLocations } from './handlers/kv.js';
import * as debugHandler from './handlers/debug.js';

const CORS_HEADERS = {
    'Access-Control-Allow-Origin': '*', // adjust to your domain if needed
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
};

function withCORS(response) {
    const headers = new Headers(response.headers);
    for (const [key, value] of Object.entries(CORS_HEADERS)) {
        headers.set(key, value);
    }
    return new Response(response.body, { status: response.status, headers });
}

export default {
    async fetch(request, env) {
        const url = new URL(request.url);
        const pathname = url.pathname.replace(/\/$/, ''); // strip trailing slash

        // Handle OPTIONS preflight
        if (request.method === 'OPTIONS') {
            return new Response(null, { headers: CORS_HEADERS });
        }

        const IS_DEV = env.IS_DEV === 'true';
        const WORKER_ESI_BASE = IS_DEV
            ? 'http://localhost:8787/markets/'
            : 'https://eve-data-api.sidarthus89.workers.dev/markets/';
        const WORKER_KV_BASE = IS_DEV
            ? 'http://localhost:8787/api/'
            : 'https://eve-data-api.sidarthus89.workers.dev/api/';

        // Special Price History rewrite
        if (pathname.match(/^\/markets\/\d+\/history\/$/)) {
            const regionID = pathname.split('/')[2];
            const typeID = url.searchParams.get('type_id');
            if (!regionID || !typeID) {
                return withCORS(new Response('Missing regionID or typeID', { status: 400 }));
            }
            url.searchParams.set('itemId', typeID);
            url.searchParams.delete('type_id');
            url.searchParams.set('region', regionID);
            try {
                const res = await handlePriceHistory(url, env);
                return withCORS(res);
            } catch (err) {
                return withCORS(new Response(JSON.stringify({ error: err.message }), {
                    status: 500,
                    headers: { 'Content-Type': 'application/json' }
                }));
            }
        }

        // Proxy raw ESI routes
        if (pathname.startsWith('/markets/')) {
            try {
                const res = await proxyToESI(url);
                return withCORS(res);
            } catch (err) {
                return withCORS(new Response(JSON.stringify({ error: err.message }), {
                    status: 500,
                    headers: { 'Content-Type': 'application/json' }
                }));
            }
        }

        // Route map
        const routeMap = {
            '/market-orders': () => handleMarketOrders(url, env),
            '/price-history': () => handlePriceHistory(url, env),
            '/market-distribution': () => handleMarketDistribution(url, env),
            '/api/market-tree': () => handleMarketTree(request, env),
            '/api/locations': () => handleLocations(request, env),
            '/api/trade-route': () => handleTradeRoute(request, env),
            '/api/debug/kv': () => handleDebugKV(env),
            '/api/debug/market-tree': () => debugHandler.onRequest({ request, env }),
            '/api/debug/locations': () => debugHandler.onRequest({ request, env }),
            '/api/debug/clean-kv': () => handleCleanKV(env),
            '/api/seed': () =>
                request.method === 'POST'
                    ? seedKV(env)
                    : new Response('Method Not Allowed', { status: 405 }),
        };

        if (routeMap[pathname]) {
            try {
                const res = await routeMap[pathname]();
                return withCORS(res);
            } catch (err) {
                return withCORS(new Response(JSON.stringify({ error: err.message }), {
                    status: 500,
                    headers: { 'Content-Type': 'application/json' }
                }));
            }
        }

        return withCORS(new Response('Not found', { status: 404 }));
    }
};

// Debug KV preview
async function handleDebugKV(env) {
    const marketRaw = await env.MARKET_TREE.get('market:tree');
    const locationRaw = await env.LOCATIONS.get('locations:all');

    let marketTree = [];
    let locations = [];

    try { marketTree = JSON.parse(marketRaw || '[]'); } catch { }
    try { locations = JSON.parse(locationRaw || '[]'); } catch { }

    return new Response(JSON.stringify({
        marketTreePreview: Array.isArray(marketTree) ? marketTree.slice(0, 500) : [],
        locationsPreview: Array.isArray(locations) ? locations.slice(0, 500) : [],
        marketTreeType: typeof marketTree,
        locationsType: typeof locations
    }, null, 2), { headers: { 'Content-Type': 'application/json' } });
}

// Clean KV
async function handleCleanKV(env) {
    const messages = [];
    const marketRaw = await env.MARKET_TREE.get('market:tree');
    const locationRaw = await env.LOCATIONS.get('locations:all');

    try {
        const parsedMarket = JSON.parse(marketRaw);
        await env.MARKET_TREE.put('market:tree', JSON.stringify(parsedMarket));
        messages.push('✅ market:tree cleaned');
    } catch (err) {
        messages.push(`❌ market:tree invalid JSON`);
    }

    try {
        const parsedLocations = JSON.parse(locationRaw);
        await env.LOCATIONS.put('locations:all', JSON.stringify(parsedLocations));
        messages.push('✅ locations:all cleaned');
    } catch (err) {
        messages.push(`❌ locations:all invalid JSON`);
    }

    return new Response(messages.join('\n\n'), { headers: { 'Content-Type': 'text/plain' } });
}

// Seed KV
async function seedKV(env) {
    try {
        await env.MARKET_TREE.put('market:tree', JSON.stringify(marketData));
        await env.LOCATIONS.put('locations:all', JSON.stringify(locationsData));
        return new Response(JSON.stringify({ message: 'KV seeded successfully' }, null, 2), {
            headers: { 'Content-Type': 'application/json' }
        });
    } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
}

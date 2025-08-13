// worker-api/kv-seeder.js

import marketData from './data/market.json';
import locationsData from './data/locations.json';

export default {
    async fetch(request, env) {
        const headers = {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'POST',
            'Access-Control-Allow-Headers': 'Content-Type'
        };

        if (request.method === 'OPTIONS') {
            return new Response(null, { status: 204, headers });
        }

        if (request.method !== "POST") {
            return new Response("Use POST to seed KV", { status: 405, headers });
        }

        try {
            await env.MARKET_TREE.put("market:tree", JSON.stringify(marketData));
            await env.LOCATIONS.put("locations:all", JSON.stringify(locationsData));
            return new Response("KV seeded successfully", { status: 200, headers });
        } catch (err) {
            return new Response("Seeder failed: " + err.message, { status: 500, headers });
        }
    }
};
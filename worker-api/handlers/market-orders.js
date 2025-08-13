// worker-api/handlers/market-orders.js

import { getSecurityLevel, getStationName } from '../utils/locations.js';
import { fetchMarketOrdersFromBackend } from '../utils/fetchers.js';

export async function handleMarketOrders(url, env) {
    const region = url.searchParams.get("region");
    if (!region) return new Response("Missing region", { status: 400 });

    const cacheKey = `orders:${region}`;
    const cached = await env.MARKET_ORDERS?.get(cacheKey);
    if (cached) {
        return new Response(cached, {
            headers: { "Content-Type": "application/json", "Cache-Control": "max-age=300" }
        });
    }

    const rawOrders = await fetchMarketOrdersFromBackend(region);

    const enriched = rawOrders.map(order => ({
        ...order,
        security: getSecurityLevel(order.stationID),
        station: getStationName(order.stationID),
        region,
    }));

    const json = JSON.stringify(enriched);
    await env.MARKET_ORDERS?.put(cacheKey, json, { expirationTtl: 600 });

    return new Response(json, {
        headers: { "Content-Type": "application/json", "Cache-Control": "max-age=300" }
    });
}
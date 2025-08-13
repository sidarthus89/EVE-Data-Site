import { getRegionName } from '../utils/locations.js';

export async function handleMarketDistribution(url, env) {
    const allOrdersRaw = await env.MARKET_ORDERS.get("orders:all");
    if (!allOrdersRaw) {
        return new Response("No cached orders", { status: 404 });
    }

    const orders = JSON.parse(allOrdersRaw);
    const prices = orders.map(o => o.price).filter(p => p > 0).sort((a, b) => a - b);

    const p1 = prices[Math.floor(prices.length * 0.01)];
    const p99 = prices[Math.floor(prices.length * 0.99)];

    const filtered = orders.filter(o =>
        o.price >= p1 &&
        o.price <= p99 &&
        o.volume_remain > 0
    );

    const map = {};
    filtered.forEach(order => {
        const region = getRegionName(order.regionID);
        if (!map[region]) {
            map[region] = { region, buyerVolume: 0, sellerVolume: 0 };
        }

        if (order.is_buy_order) {
            map[region].buyerVolume += order.volume_remain;
        } else {
            map[region].sellerVolume += order.volume_remain;
        }
    });

    const result = Object.values(map);

    return new Response(JSON.stringify(result), {
        headers: { "Content-Type": "application/json", "Cache-Control": "max-age=300" }
    });
}
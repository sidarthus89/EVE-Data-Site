// worker-api/handlers/trade-route.js
import { fetchMarketOrders } from './utils/fetchESI.js'; // Adjust to your actual helper path

export async function handleTradeRoute(request, env) {
    try {
        const url = new URL(request.url);
        const startRegionID = Number(url.searchParams.get('startRegionID'));
        const endRegionID = Number(url.searchParams.get('endRegionID'));
        const tradeMode = url.searchParams.get('tradeMode') || 'buyToSell';
        const profitAbove = Number(url.searchParams.get('profitAbove')) || 500000;
        const roiMin = Number(url.searchParams.get('roi')) || 0;
        const budget = Number(url.searchParams.get('budget')) || Infinity;
        const capacity = Number(url.searchParams.get('capacity')) || Infinity;
        const salesTax = Number(url.searchParams.get('salesTax')) || 7.5;
        const maxJumps = Number(url.searchParams.get('maxJumps')) || Infinity;

        if (!startRegionID || !endRegionID) {
            return new Response(JSON.stringify({ error: 'Missing start or end region IDs' }), {
                status: 400,
                headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
            });
        }

        // Example: fetch all item orders from start & end regions
        // You’d likely want to iterate over a list of typeIDs, but here’s a placeholder logic
        const typeIDsToCheck = [34, 35, 36]; // Replace with your actual typeIDs list or source

        const routes = [];

        for (const typeID of typeIDsToCheck) {
            const startOrders = await fetchMarketOrders(typeID, startRegionID);
            const endOrders = await fetchMarketOrders(typeID, endRegionID);

            // Get cheapest sell in start region
            const cheapestSell = startOrders.sellOrders.sort((a, b) => a.price - b.price)[0];
            // Get highest buy in end region
            const highestBuy = endOrders.buyOrders.sort((a, b) => b.price - a.price)[0];

            if (cheapestSell && highestBuy) {
                const profit = highestBuy.price - cheapestSell.price;
                const roi = (profit / cheapestSell.price) * 100;

                if (profit >= profitAbove && roi >= roiMin) {
                    routes.push({
                        itemId: typeID,
                        itemName: `Item ${typeID}`, // TODO: replace with actual item name lookup
                        from: startRegionID,
                        to: endRegionID,
                        buyPrice: cheapestSell.price,
                        sellPrice: highestBuy.price,
                        netProfit: profit,
                        roi: roi,
                        quantity: Math.min(cheapestSell.volume_remain, capacity),
                        jumps: Math.floor(Math.random() * 10) + 1, // Placeholder
                        profitPerJump: profit / Math.max(1, Math.floor(Math.random() * 10) + 1),
                        profitPerItem: profit,
                        totalVolume: cheapestSell.volume_remain
                    });
                }
            }
        }

        // Sort by netProfit descending
        routes.sort((a, b) => b.netProfit - a.netProfit);

        return new Response(JSON.stringify(routes), {
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            }
        });
    } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), {
            status: 500,
            headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
        });
    }
}

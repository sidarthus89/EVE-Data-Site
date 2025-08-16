// worker-api/handlers/trade-route.js

import { fetchMarketOrdersFromBackend } from '../utils/fetchers.js';

export async function handleTradeRoute(request, env) {
    try {
        const url = new URL(request.url);
        const startRegionParam = url.searchParams.get('startRegionID');
        const endRegionParam = url.searchParams.get('endRegionID');
        const tradeMode = url.searchParams.get('tradeMode') || 'buyToSell';
        const profitAbove = Number(url.searchParams.get('profitAbove')) || 500000;
        const roiMin = Number(url.searchParams.get('roi')) || 0;
        const budget = Number(url.searchParams.get('budget')) || Infinity;
        const capacity = Number(url.searchParams.get('capacity')) || Infinity;
        const salesTax = Number(url.searchParams.get('salesTax')) || 7.5;
        const maxJumps = Number(url.searchParams.get('maxJumps')) || Infinity;

        // Handle "all" regions
        if (startRegionParam === 'all' || endRegionParam === 'all') {
            return new Response(JSON.stringify({
                error: 'All-region trading not yet implemented. Please select specific regions.',
                message: 'Processing all regions requires significant computation time. Please select specific start and end regions.'
            }), {
                status: 400,
                headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
            });
        }

        const startRegionID = Number(startRegionParam);
        const endRegionID = Number(endRegionParam);

        if (!startRegionID || !endRegionID) {
            return new Response(JSON.stringify({
                error: 'Invalid region IDs',
                startRegionID: startRegionParam,
                endRegionID: endRegionParam,
                message: 'Both start and end region IDs must be valid numbers'
            }), {
                status: 400,
                headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
            });
        }

        console.log(`Starting trade route analysis: ${startRegionID} -> ${endRegionID}`);

        // Fetch ALL orders from both regions
        console.log('Fetching start region orders...');
        const startOrders = await fetchMarketOrdersFromBackend(startRegionID);
        console.log('Fetching end region orders...');
        const endOrders = await fetchMarketOrdersFromBackend(endRegionID);

        console.log(`Found ${startOrders.length} orders in start region, ${endOrders.length} orders in end region`);

        // Group orders by type_id for easier processing
        const startOrdersByType = {};
        const endOrdersByType = {};

        // Process start region orders
        startOrders.forEach(order => {
            if (!startOrdersByType[order.type_id]) {
                startOrdersByType[order.type_id] = { buyOrders: [], sellOrders: [] };
            }
            if (order.is_buy_order) {
                startOrdersByType[order.type_id].buyOrders.push(order);
            } else {
                startOrdersByType[order.type_id].sellOrders.push(order);
            }
        });

        // Process end region orders
        endOrders.forEach(order => {
            if (!endOrdersByType[order.type_id]) {
                endOrdersByType[order.type_id] = { buyOrders: [], sellOrders: [] };
            }
            if (order.is_buy_order) {
                endOrdersByType[order.type_id].buyOrders.push(order);
            } else {
                endOrdersByType[order.type_id].sellOrders.push(order);
            }
        });

        // Find all unique type_ids that have orders in both regions
        const startTypeIds = new Set(Object.keys(startOrdersByType));
        const endTypeIds = new Set(Object.keys(endOrdersByType));
        const commonTypeIds = [...startTypeIds].filter(typeId => endTypeIds.has(typeId));

        console.log(`Found ${commonTypeIds.length} items with orders in both regions`);

        const routes = [];
        let processedItems = 0;

        for (const typeID of commonTypeIds) {
            processedItems++;

            // Log progress every 100 items
            if (processedItems % 100 === 0) {
                console.log(`Processed ${processedItems}/${commonTypeIds.length} items...`);
            }

            const startTypeOrders = startOrdersByType[typeID];
            const endTypeOrders = endOrdersByType[typeID];

            // Sort orders for best prices
            const startSellOrders = startTypeOrders.sellOrders
                .filter(o => o.price > 0 && o.volume_remain > 0)
                .sort((a, b) => a.price - b.price);

            const endBuyOrders = endTypeOrders.buyOrders
                .filter(o => o.price > 0 && o.volume_remain > 0)
                .sort((a, b) => b.price - a.price);

            if (startSellOrders.length === 0 || endBuyOrders.length === 0) {
                continue; // Skip if no viable orders
            }

            const cheapestSell = startSellOrders[0];
            const highestBuy = endBuyOrders[0];

            // Calculate profit (accounting for sales tax)
            const buyPrice = cheapestSell.price;
            const sellPrice = highestBuy.price;
            const taxAdjustedSellPrice = sellPrice * (1 - salesTax / 100);
            const grossProfit = taxAdjustedSellPrice - buyPrice;
            const roi = (grossProfit / buyPrice) * 100;

            // Check if it meets profit criteria
            if (grossProfit >= profitAbove && roi >= roiMin) {
                // Calculate maximum quantity we can trade
                const maxQuantityFromOrders = Math.min(
                    cheapestSell.volume_remain,
                    highestBuy.volume_remain
                );

                // Apply capacity constraint (assuming volume per unit is 1 for simplicity)
                // You might want to look up actual item volumes from your market tree
                const maxQuantityFromCapacity = capacity; // This is a simplification

                const maxQuantity = Math.min(maxQuantityFromOrders, maxQuantityFromCapacity);

                if (maxQuantity > 0) {
                    const totalProfit = grossProfit * maxQuantity;

                    // Apply budget constraint
                    const totalCost = buyPrice * maxQuantity;
                    if (totalCost <= budget) {
                        routes.push({
                            itemId: parseInt(typeID),
                            itemName: `Item ${typeID}`, // TODO: replace with actual item name lookup from market tree
                            from: startRegionID,
                            to: endRegionID,
                            buyPrice: buyPrice,
                            sellPrice: sellPrice,
                            taxAdjustedSellPrice: taxAdjustedSellPrice,
                            netProfit: grossProfit,
                            totalProfit: totalProfit,
                            roi: roi,
                            quantity: maxQuantity,
                            totalCost: totalCost,
                            jumps: Math.floor(Math.random() * 10) + 1, // Placeholder - you'd calculate real jumps
                            profitPerJump: grossProfit / Math.max(1, Math.floor(Math.random() * 10) + 1),
                            profitPerItem: grossProfit,
                            salesTaxRate: salesTax,
                            // Additional info for debugging
                            startSellOrdersCount: startSellOrders.length,
                            endBuyOrdersCount: endBuyOrders.length
                        });
                    }
                }
            }
        }

        console.log(`Analysis complete. Found ${routes.length} profitable trade routes from ${commonTypeIds.length} items`);

        // If no routes found, return empty array with debug info in console
        if (routes.length === 0) {
            console.log('DEBUG INFO:', {
                startRegionID,
                endRegionID,
                startOrdersCount: startOrders.length,
                endOrdersCount: endOrders.length,
                commonItemTypes: commonTypeIds.length,
                filters: { profitAbove, roiMin, budget, capacity, salesTax },
                sampleStartOrders: startOrders.slice(0, 3),
                sampleEndOrders: endOrders.slice(0, 3),
                commonTypeIdsPreview: commonTypeIds.slice(0, 10)
            });

            // Return empty array to match frontend expectations
            return new Response(JSON.stringify([]), {
                headers: {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*'
                }
            });
        }

        // Sort by total profit descending (or by ROI, profit per jump, etc.)
        routes.sort((a, b) => b.totalProfit - a.totalProfit);

        // Limit results to top routes to avoid huge responses
        const topRoutes = routes.slice(0, 1000);

        // Return just the routes array to match your frontend expectation
        return new Response(JSON.stringify(topRoutes), {
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            }
        });

    } catch (err) {
        console.error('Trade route handler error:', err);
        return new Response(JSON.stringify({
            error: err.message,
            stack: err.stack
        }), {
            status: 500,
            headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
        });
    }
}
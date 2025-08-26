// src/utils/market.js
// Market data functions (Azure + ESI fallback)

import { fetchWithRetry, AZURE_BASE, ESI_BASE } from './api.js';

export async function fetchMarketOrders(typeId, regionId = null, locationId = null, isBuyOrder = null) {
    const params = new URLSearchParams({ type_id: typeId });
    if (regionId) params.append('region_id', regionId);
    if (locationId) params.append('location_id', locationId);
    if (isBuyOrder !== null) params.append('is_buy_order', isBuyOrder);

    const url = `${AZURE_BASE}/market/orders?${params}`;
    console.log(`🎯 Fetching market orders for type_id: ${typeId}, region_id: ${regionId}`);

    try {
        const response = await fetchWithRetry(url, {}, 1);
        console.log('✅ Azure response received:', response);

        // Validate response structure
        if (!response || typeof response !== 'object') {
            throw new Error('Invalid response structure from Azure');
        }

        // Ensure we have the expected structure
        const result = {
            buyOrders: response.buyOrders || [],
            sellOrders: response.sellOrders || [],
            meta: response.meta || {}
        };

        console.log(`📊 Azure orders: ${result.buyOrders.length} buy, ${result.sellOrders.length} sell`);
        return result;

    } catch (azureError) {
        console.error('❌ Azure fetch failed, falling back to ESI:', azureError);
        if (!regionId) return { buyOrders: [], sellOrders: [] };

        const esiUrl = `${ESI_BASE}/markets/${regionId}/orders/?type_id=${typeId}`;
        try {
            const orders = await fetchWithRetry(esiUrl, {}, 1);
            console.log(`✅ ESI response received: ${orders.length} orders`);

            // ESI orders need to be enriched with location metadata
            const enrichedOrders = orders.map(order => ({
                ...order,
                name: 'Unknown', // Will be resolved via locationInfoMap
                region_name: `Region ${regionId}`,
                security: null, // Will be resolved via locationInfoMap
                location_type: 'Unknown',
                is_npc: false // Default to player structure, will be resolved
            }));

            console.log('📊 ESI enriched orders:', enrichedOrders.length);
            return {
                buyOrders: enrichedOrders.filter(o => o.is_buy_order),
                sellOrders: enrichedOrders.filter(o => !o.is_buy_order)
            };
        } catch (esiError) {
            console.error('❌ ESI fetch failed:', esiError);
            return { buyOrders: [], sellOrders: [] };
        }
    }
}

export async function fetchMarketSummary(typeId, regionId = null) {
    const params = new URLSearchParams({ type_id: typeId });
    if (regionId) params.append('region_id', regionId);
    return fetchWithRetry(`${AZURE_BASE}/market/summary?${params}`, {}, 3);
}

export async function fetchMarketHistory(typeId, regionId, days = 30) {
    const params = new URLSearchParams({ type_id: typeId, region_id: regionId, days });
    try {
        const response = await fetchWithRetry(`${AZURE_BASE}/market/history?${params}`, {}, 3);
        return response.history || response; // Handle both wrapped and direct array responses
    } catch (error) {
        console.error('❌ Market history fetch failed:', error);
        return []; // Return empty array on failure
    }
}

export async function fetchAggregatedOrders(typeId, regionId) {
    const params = new URLSearchParams({ type_id: typeId, region_id: regionId });
    return fetchWithRetry(`${AZURE_BASE}/aggregated-orders?${params}`, {}, 3);
}

export async function fetchUniverseMarketHistory(typeId) {
    const hubs = [10000002, 10000043, 10000032, 10000030, 10000042]; // major trade hub regions
    const historyLists = await Promise.all(hubs.map(rid => fetchMarketHistory(typeId, rid)));
    // Aggregate by date across all regions
    const dateMap = new Map();
    historyLists.forEach(list => {
        if (Array.isArray(list)) {
            list.forEach(entry => {
                const date = entry.date;
                if (!dateMap.has(date)) {
                    dateMap.set(date, {
                        date,
                        totalVolume: 0,
                        totalValue: 0,
                        highest: 0,
                        lowest: Infinity,
                        orderCount: 0
                    });
                }
                const bucket = dateMap.get(date);
                const vol = entry.volume || 0;
                const avg = entry.average || 0;
                bucket.totalVolume += vol;
                bucket.totalValue += vol * avg;
                bucket.highest = Math.max(bucket.highest, entry.highest || 0);
                bucket.lowest = Math.min(bucket.lowest, entry.lowest || bucket.lowest);
                bucket.orderCount += entry.order_count || 0;
            });
        }
    });
    // Convert to array with weighted average
    const aggregated = Array.from(dateMap.values())
        .map(item => ({
            date: item.date,
            average: item.totalVolume > 0 ? item.totalValue / item.totalVolume : 0,
            totalVolume: item.totalVolume,
            highest: item.highest,
            lowest: item.lowest === Infinity ? 0 : item.lowest,
            order_count: item.orderCount
        }))
        .sort((a, b) => new Date(a.date) - new Date(b.date));
    return aggregated;
}

export async function fetchTradeRouteData(fromId, toId, types = [34, 44992]) {
    const opportunities = [];
    for (const typeId of types) {
        // Fetch sell orders (buying from source) and buy orders (selling to destination)
        const sellResult = await fetchMarketOrders(typeId, fromId, null, false);
        const buyResult = await fetchMarketOrders(typeId, toId, null, true);
        const sellOrders = sellResult.sellOrders || [];
        const buyOrders = buyResult.buyOrders || [];
        if (sellOrders.length && buyOrders.length) {
            const bestSell = Math.min(...sellOrders.map(o => o.price));
            const bestBuy = Math.max(...buyOrders.map(o => o.price));
            const profit = bestBuy - bestSell;
            const profitPct = bestSell > 0 ? (profit / bestSell) * 100 : 0;
            const maxSellVol = sellOrders.find(o => o.price === bestSell)?.volume_remain || 0;
            const maxBuyVol = buyOrders.find(o => o.price === bestBuy)?.volume_remain || 0;
            opportunities.push({
                type_id: typeId,
                buy_price: bestBuy,
                sell_price: bestSell,
                profit_per_unit: profit,
                profit_percentage: profitPct,
                max_volume: Math.min(maxSellVol, maxBuyVol),
                from_region: fromId,
                to_region: toId
            });
        }
    }
    // Sort by descending profit percentage
    return opportunities.sort((a, b) => b.profit_percentage - a.profit_percentage);
}

export async function fetchRegionHaulingData(originRegionId, destinationRegionId = null) {
    const params = new URLSearchParams({ origin_region_id: originRegionId });
    if (destinationRegionId) {
        params.append('destination_region_id', destinationRegionId);
    }

    const url = `${AZURE_BASE}/region_hauling?${params}`;
    console.log(`🚛 Fetching region hauling data: ${url}`);

    try {
        const response = await fetchWithRetry(url, {}, 3);
        console.log('🚛 Region hauling response:', response);
        return response.routes || [];
    } catch (error) {
        console.error('❌ Azure region hauling failed, attempting fallback method:', error);

        // Fallback: Use live market data to generate basic trade routes
        try {
            console.log('🚛 Using fallback trade route analysis...');
            const tradeRoutes = await generateBasicTradeRoutes(originRegionId, destinationRegionId);
            return tradeRoutes;
        } catch (fallbackError) {
            console.error('❌ Fallback method also failed:', fallbackError);
            throw new Error(`Azure Functions unavailable (${error.message}). Fallback failed: ${fallbackError.message}`);
        }
    }
}

// Fallback function to generate basic trade routes using live market data
async function generateBasicTradeRoutes(originRegionId, destinationRegionId = null) {
    console.log('🚛 Generating basic trade routes using live market data...');

    // Common high-value trade items in EVE with their volumes (m3)
    const commonTradeItems = [
        { typeId: 34, name: 'Tritanium', volume: 0.01 },
        { typeId: 35, name: 'Pyerite', volume: 0.01 },
        { typeId: 36, name: 'Mexallon', volume: 0.01 },
        { typeId: 37, name: 'Isogen', volume: 0.01 },
        { typeId: 38, name: 'Nocxium', volume: 0.01 },
        { typeId: 39, name: 'Zydrine', volume: 0.01 },
        { typeId: 40, name: 'Megacyte', volume: 0.01 },
        { typeId: 44992, name: 'PLEX', volume: 0.01 },
        { typeId: 11399, name: 'Morphite', volume: 0.01 },
        { typeId: 16634, name: 'Crystalline Carbonide', volume: 0.01 },
        { typeId: 16640, name: 'Titanium Carbide', volume: 0.01 },
        { typeId: 16643, name: 'Tungsten Carbide', volume: 0.01 },
        { typeId: 16647, name: 'Vanadium Carbide', volume: 0.01 },
        { typeId: 16648, name: 'Scandium', volume: 0.01 },
        { typeId: 16649, name: 'Chromium', volume: 0.01 },
        { typeId: 16650, name: 'Hafnium', volume: 0.01 },
        { typeId: 16651, name: 'Platinum', volume: 0.01 },
        { typeId: 16652, name: 'Cobalt', volume: 0.01 },
        { typeId: 16653, name: 'Cadmium', volume: 0.01 },
        { typeId: 11382, name: 'Oxygen', volume: 0.01 },
        { typeId: 3683, name: 'Oxygen Isotopes', volume: 0.1 },
        { typeId: 3684, name: 'Nitrogen Isotopes', volume: 0.1 },
        { typeId: 3685, name: 'Hydrogen Isotopes', volume: 0.1 },
        { typeId: 3686, name: 'Helium Isotopes', volume: 0.1 },
        { typeId: 29668, name: 'Skill Injector', volume: 0.01 },
        { typeId: 40519, name: 'Skill Extractor', volume: 0.01 },
    ];

    const tradeOpportunities = [];
    const destRegionId = destinationRegionId || originRegionId; // If no destination, use same region

    for (const item of commonTradeItems) {
        try {
            // Fetch sell orders from origin region
            const originResult = await fetchMarketOrders(item.typeId, originRegionId, null, false);
            const sellOrders = originResult.sellOrders || [];

            // Fetch buy orders from destination region
            const destResult = await fetchMarketOrders(item.typeId, destRegionId, null, true);
            const buyOrders = destResult.buyOrders || [];

            if (sellOrders.length > 0 && buyOrders.length > 0) {
                // Find best prices
                const bestSellPrice = Math.min(...sellOrders.map(order => order.price));
                const bestBuyPrice = Math.max(...buyOrders.map(order => order.price));

                if (bestBuyPrice > bestSellPrice) {
                    const profit = bestBuyPrice - bestSellPrice;
                    const profitMargin = ((profit / bestSellPrice) * 100);

                    // Get volume info and location details
                    const sellOrder = sellOrders.find(o => o.price === bestSellPrice);
                    const buyOrder = buyOrders.find(o => o.price === bestBuyPrice);
                    const maxVolume = Math.min(
                        sellOrder?.volume_remain || 0,
                        buyOrder?.volume_remain || 0
                    );

                    tradeOpportunities.push({
                        type_id: item.typeId,
                        item_name: item.name,
                        item_volume: item.volume,
                        origin_id: sellOrder?.location_id || 0,
                        destination_id: buyOrder?.location_id || 0,
                        origin_station_name: sellOrder?.name || 'Unknown Station',
                        destination_station_name: buyOrder?.name || 'Unknown Station',
                        origin_security: sellOrder?.security || null,
                        destination_security: buyOrder?.security || null,
                        sell_price: bestSellPrice,
                        buy_price: bestBuyPrice,
                        profit_per_unit: profit,
                        profit_margin: profitMargin,
                        max_volume: maxVolume,
                        _fallback: true // Mark as fallback data
                    });
                }
            }
        } catch (itemError) {
            console.warn(`🚛 Failed to fetch data for item ${item.typeId}:`, itemError);
        }
    }

    // Sort by profit margin and return top results
    const sortedRoutes = tradeOpportunities
        .filter(route => route.profit_margin > 1) // Only routes with >1% profit
        .sort((a, b) => b.profit_margin - a.profit_margin)
        .slice(0, 50); // Top 50 routes

    console.log(`🚛 Generated ${sortedRoutes.length} fallback trade routes`);
    return sortedRoutes;
}

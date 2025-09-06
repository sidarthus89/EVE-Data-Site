// src/utils/market.js
// Market data functions (Azure + ESI fallback)

import { fetchWithRetry, AZURE_BASE, ESI_BASE, fetchMarketTree } from './api.js';

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

export async function fetchMarketHistory(type_id, region_id, days = 30) {
    const params = new URLSearchParams({ type_id: type_id, region_id: region_id, days: days });
    const url = `${AZURE_BASE}/market/history?${params}`;
    console.log(`📈 Fetching market history: type_id=${type_id}, region_id=${region_id}, days=${days}`);
    console.log(`📈 URL: ${url}`);

    try {
        const response = await fetch(url);
        console.log(`📈 Response status: ${response.status} ${response.statusText}`);

        if (!response.ok) {
            throw new Error(`Failed to fetch market history: ${response.statusText} (${response.status})`);
        }

        const data = await response.json();
        console.log(`📈 Received data:`, {
            isArray: Array.isArray(data),
            length: Array.isArray(data) ? data.length : 'not array',
            type: typeof data,
            sample: Array.isArray(data) && data.length > 0 ? data[0] : data
        });

        return data;
    } catch (error) {
        console.error(`📈 Error in fetchMarketHistory for type_id=${type_id}, region_id=${region_id}:`, error);
        throw error;
    }
}

export async function fetchAggregatedOrders(typeId, regionId) {
    const params = new URLSearchParams({ type_id: typeId, region_id: regionId });
    return fetchWithRetry(`${AZURE_BASE}/aggregated-orders?${params}`, {}, 3);
}

export async function fetchUniverseMarketHistory(typeId) {
    console.log('🌍 fetchUniverseMarketHistory called with typeID:', typeId, typeof typeId);

    const hubs = [10000002, 10000043, 10000032, 10000030, 10000042]; // major trade hub regions
    console.log('🌍 Fetching from hubs:', hubs);

    const historyLists = await Promise.all(hubs.map(async (rid) => {
        try {
            console.log(`🌍 Fetching hub ${rid} for typeID ${typeId}`);
            const result = await fetchMarketHistory(typeId, rid);
            console.log(`🌍 Hub ${rid} returned:`, result ? result.length : 'null', 'items');
            if (result && result.length > 0) {
                console.log(`🌍 Sample data from hub ${rid}:`, result[0]);
            }
            return result;
        } catch (error) {
            console.error(`🌍 Hub ${rid} failed:`, error);
            return [];
        }
    }));

    console.log('🌍 All hub responses:', historyLists.map(list => Array.isArray(list) ? list.length : 'not array'));

    // Aggregate by date across all regions
    const dateMap = new Map();
    historyLists.forEach((list, index) => {
        console.log(`🌍 Processing hub ${hubs[index]} with ${Array.isArray(list) ? list.length : 'not array'} items`);
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

    console.log('🌍 Date map size:', dateMap.size);

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

    console.log('🌍 Final aggregated result:', aggregated.length, 'items');
    if (aggregated.length > 0) {
        console.log('🌍 Sample aggregated item:', aggregated[0]);
    }

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
    const params = new URLSearchParams({ from_region: originRegionId });
    if (destinationRegionId) {
        params.append('to_region', destinationRegionId);
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

    // Load full set of tradeable items from market.json
    const marketTree = await fetchMarketTree();
    const commonTradeItems = [];
    const traverse = node => {
        if (node.items) {
            node.items.forEach(item => {
                commonTradeItems.push({
                    typeId: Number(item.typeID),
                    name: item.typeName,
                    volume: item.volume || 0.01
                });
            });
        }
        Object.keys(node).forEach(key => {
            if (key !== 'items' && key !== '_info' && typeof node[key] === 'object') {
                traverse(node[key]);
            }
        });
    };
    traverse(marketTree);

    const tradeOpportunities = [];
    const destRegionId = destinationRegionId || originRegionId; // If no destination, use same region

    // Helper: fetch orders directly from ESI and split by buy/sell
    async function fetchEsiOrders(typeId, regionId) {
        const url = `${ESI_BASE}/markets/${regionId}/orders/?type_id=${typeId}`;
        const orders = await fetchWithRetry(url, {}, 1);
        return {
            sellOrders: orders.filter(o => !o.is_buy_order),
            buyOrders: orders.filter(o => o.is_buy_order)
        };
    }
    for (const item of commonTradeItems) {
        const { typeId } = item;
        try {
            // Fetch sell orders from origin region via ESI
            const { sellOrders } = await fetchEsiOrders(typeId, originRegionId);
            // Fetch buy orders from destination region via ESI
            const { buyOrders } = await fetchEsiOrders(typeId, destRegionId);

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
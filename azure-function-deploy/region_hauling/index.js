// Region Hauling Azure Function - JavaScript version
// Handles /api/region_hauling endpoint for profitable region-to-region or intra-region trade routes

const sql = require('mssql');

const dbConfig = {
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    server: process.env.DB_SERVER,
    options: { encrypt: true }
};

module.exports = async function (context, req) {
    const { method } = req;
    // Default CORS headers
    const corsHeaders = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization'
    };

    // Handle CORS preflight requests
    if (method === 'OPTIONS') {
        context.res = {
            status: 200,
            headers: corsHeaders
        };
        return;
    }

    const { origin_region_id, destination_region_id } = req.query;

    if (!origin_region_id) {
        context.res = {
            status: 400,
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Content-Type': 'application/json'
            },
            body: { error: 'origin_region_id is required' }
        };
        return;
    }

    try {
        context.log('Starting region hauling query with params:', { origin_region_id, destination_region_id });

        const pool = await sql.connect(dbConfig);
        const request = pool.request();
        request.input('origin_region_id', sql.Int, parseInt(origin_region_id));
        if (destination_region_id) {
            request.input('destination_region_id', sql.Int, parseInt(destination_region_id));
        }

        const query = `
      SELECT TOP 50
        sell.type_id,
        sell.location_id AS origin_id,
        buy.location_id AS destination_id,
        sell.price AS sell_price,
        buy.price AS buy_price,
        (buy.price - sell.price) AS profit_per_unit,
        ((buy.price - sell.price) / sell.price * 100) AS profit_margin,
        CASE 
          WHEN sell.volume_remain < buy.volume_remain THEN sell.volume_remain
          ELSE buy.volume_remain
        END AS max_volume
      FROM market_orders sell
      JOIN market_orders buy ON sell.type_id = buy.type_id
      WHERE sell.is_buy_order = 0
        AND buy.is_buy_order = 1
        AND sell.region_id = @origin_region_id
        ${destination_region_id ? 'AND buy.region_id = @destination_region_id' : ''}
        AND buy.price > sell.price
        AND sell.volume_remain > 0
        AND buy.volume_remain > 0
      ORDER BY profit_margin DESC
    `;

        context.log('Executing query:', query);
        const result = await request.query(query);
        const routes = result.recordset || [];

        // Hybrid model: update cached routes with live ESI data for freshness
        let finalRoutes = routes;
        try {
            const ESI_BASE = 'https://esi.evetech.net/latest';
            const ESI_DATASOURCE = 'tranquility';
            const origin = parseInt(origin_region_id);
            const dest = destination_region_id ? parseInt(destination_region_id) : origin;
            const typeIds = [...new Set(routes.map(r => r.type_id))];
            for (const typeId of typeIds) {
                // Fetch best sell (NPC sell orders) from origin via ESI
                const sellRes = await fetch(`${ESI_BASE}/markets/${origin}/orders/?type_id=${typeId}&datasource=${ESI_DATASOURCE}`);
                const sellData = await sellRes.json();
                const sells = sellData.filter(o => !o.is_buy_order);
                const bestSell = sells.length ? Math.min(...sells.map(o => o.price)) : null;
                // Fetch best buy (player buy orders) from destination via ESI
                const buyRes = await fetch(`${ESI_BASE}/markets/${dest}/orders/?type_id=${typeId}&datasource=${ESI_DATASOURCE}`);
                const buyData = await buyRes.json();
                const buys = buyData.filter(o => o.is_buy_order);
                const bestBuy = buys.length ? Math.max(...buys.map(o => o.price)) : null;
                if (bestSell === null || bestBuy === null) continue;
                const profitUnit = bestBuy - bestSell;
                if (profitUnit <= 0) continue;
                // Determine max volume
                const volSell = sells.find(o => o.price === bestSell)?.volume_remain || 0;
                const volBuy = buys.find(o => o.price === bestBuy)?.volume_remain || 0;
                const maxVol = Math.min(volSell, volBuy);
                const profitMargin = bestSell > 0 ? (profitUnit / bestSell) * 100 : 0;
                // Update existing or add new route
                const idx = finalRoutes.findIndex(r => r.type_id === typeId);
                const updated = {
                    type_id: typeId,
                    origin_id: origin,
                    destination_id: dest,
                    sell_price: bestSell,
                    buy_price: bestBuy,
                    profit_per_unit: profitUnit,
                    profit_margin: profitMargin,
                    max_volume: maxVol
                };
                if (idx >= 0) finalRoutes[idx] = updated;
                else finalRoutes.push(updated);
            }
            // Sort and limit top 50
            finalRoutes.sort((a, b) => b.profit_margin - a.profit_margin);
            finalRoutes = finalRoutes.slice(0, 50);
        } catch (liveErr) {
            context.log.warn('⚠️ Live ESI update failed:', liveErr.message);
        }

        context.log(`Returning ${finalRoutes.length} routes (cached + live hybrid)`);
        context.res = {
            status: 200,
            headers: {
                'Content-Type': 'application/json',
                ...corsHeaders
            },
            body: {
                origin_region_id,
                destination_region_id: destination_region_id || origin_region_id,
                routes: finalRoutes,
                count: finalRoutes.length
            }
        };
    } catch (error) {
        context.log.error('❌ Error in region hauling:', error);
        context.res = {
            status: 500,
            headers: {
                'Content-Type': 'application/json',
                ...corsHeaders
            },
            body: {
                error: error.message,
                origin_region_id,
                destination_region_id: destination_region_id || origin_region_id,
                routes: [],
                count: 0
            }
        };
    }
};

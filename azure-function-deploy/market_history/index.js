// azure-function-deploy/market_history/index.js
const axios = require('axios');

// Helper function to set consistent CORS headers
function setCorsHeaders() {
    return {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': 'https://sidarthus89.github.io',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Max-Age': '86400'
    };
}

module.exports = async function (context, req) {
    const headers = setCorsHeaders();

    try {
        context.log('🚀 Function started');

        // Handle CORS preflight requests
        if (req.method === 'OPTIONS') {
            context.log('✅ CORS preflight request handled');
            context.res = {
                status: 200,
                headers: headers
            };
            return;
        }

        context.log('📋 Request details:', {
            method: req.method,
            query: req.query,
            url: req.url,
            headers: req.headers
        });

        // Parse query parameters
        const typeId = req.query.type_id;
        const regionId = req.query.region_id;
        const days = req.query.days ? parseInt(req.query.days) : 30;

        context.log('🔍 Parsed parameters:', { typeId, regionId, days });

        // Validate parameters
        if (!typeId || !regionId) {
            context.log('❌ Missing parameters');
            context.res = {
                status: 400,
                headers: headers,
                body: {
                    error: 'Missing type_id or region_id query parameter.',
                    received: { type_id: typeId, region_id: regionId }
                }
            };
            return;
        }

        const typeIdNum = parseInt(typeId);
        const regionIdNum = parseInt(regionId);

        if (isNaN(typeIdNum) || isNaN(regionIdNum)) {
            context.log('❌ Invalid parameter types');
            context.res = {
                status: 400,
                headers: headers,
                body: {
                    error: 'type_id and region_id must be valid numbers',
                    received: { type_id: TypeId, region_id: regionId }
                }
            };
            return;
        }

        // Fetch data from EVE Online ESI endpoint
        const esiUrl = `https://esi.evetech.net/latest/markets/${regionIdNum}/history/?type_id=${typeIdNum}`;
        context.log('🌐 Fetching data from ESI:', esiUrl);

        try {
            const response = await axios.get(esiUrl);
            const data = response.data;

            context.log('✅ Data fetched successfully:', {
                recordCount: data.length,
                firstRecord: data[0] || 'No records'
            });

            // Transform the data for better frontend compatibility
            const transformedData = data.map(row => ({
                date: row.date,
                average: parseFloat(row.average) || 0,
                highest: parseFloat(row.highest) || 0,
                lowest: parseFloat(row.lowest) || 0,
                order_count: parseInt(row.order_count) || 0,
                volume: parseInt(row.volume) || 0,
                totalVolume: parseInt(row.volume) || 0, // Alias for frontend compatibility
                region_id: regionIdNum,
                type_id: typeIdNum
            }));

            context.res = {
                status: 200,
                headers: headers,
                body: {
                    success: true,
                    data: transformedData,
                    meta: {
                        type_id: typeIdNum,
                        region_id: regionIdNum,
                        days: days,
                        record_count: transformedData.length,
                        query_executed_at: new Date().toISOString()
                    }
                }
            };

        } catch (esiError) {
            context.log.error('❌ Failed to fetch data from ESI:', esiError.message);
            context.res = {
                status: 500,
                headers: headers,
                body: {
                    error: 'Failed to fetch data from ESI',
                    message: esiError.message
                }
            };
        }

    } catch (generalError) {
        context.log.error('💥 General function error:', {
            message: generalError.message,
            stack: generalError.stack,
            name: generalError.name
        });

        context.res = {
            status: 500,
            headers: headers,
            body: {
                error: 'Function execution error',
                message: generalError.message,
                name: generalError.name,
                timestamp: new Date().toISOString()
            }
        };
    }
};
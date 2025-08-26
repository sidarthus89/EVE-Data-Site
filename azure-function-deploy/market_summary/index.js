// Market Summary Azure Function - JavaScript version
// Handles /api/market/summary endpoint

const sql = require('mssql');

// Database configuration - use environment variables in production
const dbConfig = {
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    server: process.env.DB_SERVER,
    pool: {
        max: 10,
        min: 0,
        idleTimeoutMillis: 30000
    },
    options: {
        encrypt: true, // Use encryption for Azure SQL
        trustServerCertificate: false
    }
};

// Cache for database connections
let poolPromise;

function getPool() {
    if (!poolPromise) {
        poolPromise = sql.connect(dbConfig);
    }
    return poolPromise;
}

module.exports = async function (context, req) {
    const { method } = req;

    // Handle CORS preflight requests
    if (method === 'OPTIONS') {
        context.res = {
            status: 200,
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'GET, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type, Authorization'
            }
        };
        return;
    }

    context.log('Market summary endpoint called');

    try {
        const type_id = req.query.type_id;
        const region_id = req.query.region_id;

        if (!type_id) {
            context.res = {
                status: 400,
                headers: {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*'
                },
                body: { error: "type_id parameter is required" }
            };
            return;
        }

        // Check which market orders table exists
        let tableName = 'market_orders';

        try {
            const pool = await getPool();
            const tableCheck = await pool.request().query(`
                SELECT COUNT(*) as table_exists 
                FROM INFORMATION_SCHEMA.TABLES 
                WHERE TABLE_NAME = 'market_orders_live'
            `);

            if (tableCheck.recordset[0].table_exists > 0) {
                tableName = 'market_orders_live';
            }
        } catch (tableCheckError) {
            context.log.warn('Could not check table existence, using market_orders:', tableCheckError.message);
        }

        // Query for market summary statistics
        let query = `
        SELECT 
            COUNT(*) as total_orders,
            COUNT(CASE WHEN is_buy_order = 1 THEN 1 END) as buy_orders_count,
            COUNT(CASE WHEN is_buy_order = 0 THEN 1 END) as sell_orders_count,
            AVG(CASE WHEN is_buy_order = 1 THEN price END) as avg_buy_price,
            AVG(CASE WHEN is_buy_order = 0 THEN price END) as avg_sell_price,
            MIN(CASE WHEN is_buy_order = 0 THEN price END) as min_sell_price,
            MAX(CASE WHEN is_buy_order = 1 THEN price END) as max_buy_price,
            SUM(CASE WHEN is_buy_order = 1 THEN volume_remain END) as total_buy_volume,
            SUM(CASE WHEN is_buy_order = 0 THEN volume_remain END) as total_sell_volume,
            COUNT(DISTINCT location_id) as unique_locations,
            COUNT(DISTINCT region_id) as unique_regions
        FROM ${tableName}
        WHERE type_id = @type_id AND volume_remain > 0
        `;

        const pool = await getPool();
        const request = pool.request();
        request.input('type_id', sql.Int, parseInt(type_id));

        if (region_id && region_id !== 'all') {
            query += " AND region_id = @region_id";
            request.input('region_id', sql.Int, parseInt(region_id));
        }

        const result = await request.query(query);
        const summary = result.recordset[0] || {};

        // Calculate spread if we have both buy and sell prices
        let spread = null;
        let spreadPercent = null;

        if (summary.max_buy_price && summary.min_sell_price) {
            spread = summary.min_sell_price - summary.max_buy_price;
            spreadPercent = (spread / summary.min_sell_price) * 100;
        }

        const responseData = {
            type_id: parseInt(type_id),
            region_id: region_id ? parseInt(region_id) : null,
            summary: {
                total_orders: summary.total_orders || 0,
                buy_orders: summary.buy_orders_count || 0,
                sell_orders: summary.sell_orders_count || 0,
                avg_buy_price: summary.avg_buy_price || 0,
                avg_sell_price: summary.avg_sell_price || 0,
                min_sell_price: summary.min_sell_price || 0,
                max_buy_price: summary.max_buy_price || 0,
                total_buy_volume: summary.total_buy_volume || 0,
                total_sell_volume: summary.total_sell_volume || 0,
                unique_locations: summary.unique_locations || 0,
                unique_regions: summary.unique_regions || 0,
                spread: spread,
                spread_percent: spreadPercent
            },
            tableName: tableName
        };

        context.log(`Market summary for type ${type_id}: ${summary.total_orders} orders`);

        context.res = {
            status: 200,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            },
            body: responseData
        };

    } catch (error) {
        context.log.error('Error in market summary endpoint:', error);

        context.res = {
            status: 500,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            },
            body: {
                error: error.message,
                details: 'Failed to fetch market summary'
            }
        };
    }
};

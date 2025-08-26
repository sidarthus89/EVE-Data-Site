// Station Trading Azure Function - JavaScript version
// Handles /api/station endpoint for station trading opportunities
// azure-function-deploy/station_trading/index.js

const { loadRegions } = require('../../utils/locationsServer');
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
                'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type, Authorization'
            }
        };
        return;
    }

    context.log('Station endpoint called');

    try {
        const station_id = req.query.station_id || '60003760'; // Default to Jita 4-4

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
                context.log('Using market_orders_live table');
            } else {
                context.log('Using market_orders table');
            }
        } catch (tableCheckError) {
            context.log.warn('Could not check table existence, using market_orders:', tableCheckError.message);
        }

        // Query database for station trading opportunities
        // Note: Using location_id instead of station_id as that's the standard field
        const query = `
        SELECT TOP 20
            buy_orders.type_id,
            buy_orders.price as buy_price,
            sell_orders.price as sell_price,
            (sell_orders.price - buy_orders.price) as profit_per_unit,
            ((sell_orders.price - buy_orders.price) / buy_orders.price * 100) as profit_percentage,
            CASE 
                WHEN buy_orders.volume_remain < sell_orders.volume_remain THEN buy_orders.volume_remain 
                ELSE sell_orders.volume_remain 
            END as max_volume
        FROM ${tableName} buy_orders
        JOIN ${tableName} sell_orders ON buy_orders.type_id = sell_orders.type_id
        WHERE buy_orders.location_id = @station_id
          AND sell_orders.location_id = @station_id
          AND buy_orders.is_buy_order = 1
          AND sell_orders.is_buy_order = 0
          AND sell_orders.price > buy_orders.price
          AND buy_orders.volume_remain > 0
          AND sell_orders.volume_remain > 0
        ORDER BY profit_percentage DESC
        `;

        const pool = await getPool();
        const request = pool.request();
        request.input('station_id', sql.BigInt, parseInt(station_id));

        const result = await request.query(query);
        const trades = result.recordset || [];

        context.log(`Found ${trades.length} station trading opportunities`);

        const responseData = {
            message: 'Station trading data retrieved from database',
            station_id: station_id,
            trades: trades,
            count: trades.length,
            status: 'Connected to Azure SQL Database',
            tableName: tableName
        };

        context.res = {
            status: 200,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type'
            },
            body: responseData
        };

    } catch (error) {
        context.log.error('Error in station endpoint:', error);

        // Return mock data if database fails
        const fallbackData = {
            message: 'Database error, showing mock data',
            error: error.message,
            station_id: req.query.station_id || '60003760',
            trades: [
                {
                    type_id: 34,
                    buy_price: 5.50,
                    sell_price: 6.35,
                    profit_per_unit: 0.85,
                    profit_percentage: 15.45
                }
            ]
        };

        context.res = {
            status: 200,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type'
            },
            body: fallbackData
        };
    }
};

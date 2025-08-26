// Hauling Endpoint Azure Function - JavaScript version
// Handles /api/hauling endpoint for trade route analysis
// azure-function-deploy/hauling_endpoint/index.js

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

    context.log('Hauling endpoint called');

    try {
        // Get query parameters
        const from_region = req.query.from || '10000002'; // Default to The Forge (Jita)
        const to_region = req.query.to || '10000043';     // Default to Domain (Amarr)

        // Check which market orders table exists
        let tableName = 'market_orders'; // Default to original table name

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

        // Query database for profitable trades between regions
        const query = `
        SELECT TOP 20
            m1.type_id,
            m1.price as buy_price,
            m1.location_id as from_location,
            m2.price as sell_price,
            m2.location_id as to_location,
            (m2.price - m1.price) as profit_per_unit,
            ((m2.price - m1.price) / m1.price * 100) as profit_percentage,
            CASE 
                WHEN m1.volume_remain < m2.volume_remain THEN m1.volume_remain 
                ELSE m2.volume_remain 
            END as max_volume
        FROM ${tableName} m1
        JOIN ${tableName} m2 ON m1.type_id = m2.type_id
        WHERE m1.is_buy_order = 0 
          AND m2.is_buy_order = 1
          AND m1.region_id = @from_region
          AND m2.region_id = @to_region
          AND m2.price > m1.price
          AND m1.volume_remain > 0
          AND m2.volume_remain > 0
        ORDER BY profit_percentage DESC
        `;

        const pool = await getPool();
        const request = pool.request();
        request.input('from_region', sql.Int, parseInt(from_region));
        request.input('to_region', sql.Int, parseInt(to_region));

        const result = await request.query(query);
        const trades = result.recordset || [];

        context.log(`Found ${trades.length} profitable trade opportunities`);

        // Format response to match Python function structure
        const responseData = {
            message: 'Hauling data retrieved from database',
            from_region: from_region,
            to_region: to_region,
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
        context.log.error('Error in hauling endpoint:', error);

        // Return mock data if database fails (matching Python behavior)
        const fallbackData = {
            message: 'Database error, showing mock data',
            error: error.message,
            from_region: req.query.from || '10000002',
            to_region: req.query.to || '10000043',
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
            status: 200, // Return 200 with mock data like Python version
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
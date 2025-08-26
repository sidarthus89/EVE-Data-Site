// Health Check Azure Function - JavaScript version
// Handles /api/health endpoint

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

    context.log('Health check endpoint called');

    try {
        // Test database connection
        const pool = await getPool();
        const tablesResult = await pool.request().query(`
            SELECT COUNT(*) as table_count 
            FROM INFORMATION_SCHEMA.TABLES 
            WHERE TABLE_TYPE = 'BASE TABLE'
        `);

        const tableCount = tablesResult.recordset[0].table_count;

        // Check for expected tables
        const expectedTables = ['market_orders', 'market_orders_live', 'regions'];
        const tableCheckResults = {};

        for (const tableName of expectedTables) {
            try {
                const checkResult = await pool.request().query(`
                    SELECT COUNT(*) as table_exists 
                    FROM INFORMATION_SCHEMA.TABLES 
                    WHERE TABLE_NAME = '${tableName}'
                `);
                tableCheckResults[tableName] = checkResult.recordset[0].table_exists > 0;
            } catch (error) {
                tableCheckResults[tableName] = false;
            }
        }

        // Test sample query on main market table
        let marketTableStatus = 'unknown';
        let marketOrderCount = 0;

        if (tableCheckResults['market_orders_live']) {
            try {
                const orderResult = await pool.request().query('SELECT COUNT(*) as order_count FROM market_orders_live');
                marketOrderCount = orderResult.recordset[0].order_count;
                marketTableStatus = 'market_orders_live';
            } catch (error) {
                context.log.warn('Could not query market_orders_live:', error.message);
            }
        }

        if (marketTableStatus === 'unknown' && tableCheckResults['market_orders']) {
            try {
                const orderResult = await pool.request().query('SELECT COUNT(*) as order_count FROM market_orders');
                marketOrderCount = orderResult.recordset[0].order_count;
                marketTableStatus = 'market_orders';
            } catch (error) {
                context.log.warn('Could not query market_orders:', error.message);
            }
        }

        context.res = {
            status: 200,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'GET, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type, Authorization'
            },
            body: {
                status: "healthy",
                message: "EVE Trade API is running on Azure Functions (JavaScript)",
                database: "connected",
                tables: tableCount,
                table_status: tableCheckResults,
                market_table: marketTableStatus,
                market_orders: marketOrderCount,
                endpoints: [
                    "/health",
                    "/hauling",
                    "/station",
                    "/market/orders",
                    "/market/summary",
                    "/universe/regions",
                    "/locations/*"
                ],
                timestamp: new Date().toISOString()
            }
        };

    } catch (error) {
        context.log.error('Health check database error:', error);

        context.res = {
            status: 200, // Return 200 even for degraded state
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'GET, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type, Authorization'
            },
            body: {
                status: "degraded",
                message: "EVE Trade API is running but database is unavailable",
                database: "disconnected",
                error: error.message,
                endpoints: [
                    "/health",
                    "/hauling",
                    "/station",
                    "/market/orders",
                    "/market/summary",
                    "/universe/regions",
                    "/locations/*"
                ],
                timestamp: new Date().toISOString()
            }
        };
    }
};

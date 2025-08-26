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
        encrypt: true,
        trustServerCertificate: false
    }
};

// Cache for database connections
let poolPromise;
async function getPool() {
    try {
        if (!poolPromise) {
            poolPromise = sql.connect(dbConfig);
        }
        return poolPromise;
    } catch (err) {
        console.error('❌ Failed to connect to SQL:', err.message);
        throw new Error('Database connection failed: ' + err.message);
    }
}

// Helper function to set consistent CORS headers
function setCorsHeaders() {
    return {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Max-Age': '86400'
    };
}

module.exports = async function (context, req) {
    try {
        context.log('✅ Market history endpoint called');

        // Handle CORS preflight requests
        if (req.method === 'OPTIONS') {
            context.res = {
                status: 200,
                headers: setCorsHeaders()
            };
            return;
        }

        // Parse query parameters
        const type_id = req.query.type_id;
        const region_id = req.query.region_id;
        const days = parseInt(req.query.days) || 30;

        // Validate required parameters
        if (!type_id) {
            context.res = {
                status: 400,
                headers: setCorsHeaders(),
                body: {
                    error: "type_id parameter is required",
                    message: "Please provide a valid type_id parameter"
                }
            };
            return;
        }

        if (!region_id) {
            context.res = {
                status: 400,
                headers: setCorsHeaders(),
                body: {
                    error: "region_id parameter is required",
                    message: "Please provide a valid region_id parameter"
                }
            };
            return;
        }

        const parsedTypeId = parseInt(type_id);
        const parsedRegionId = parseInt(region_id);

        if (isNaN(parsedTypeId) || parsedTypeId <= 0) {
            context.res = {
                status: 400,
                headers: setCorsHeaders(),
                body: {
                    error: "Invalid type_id parameter",
                    message: "type_id must be a positive integer"
                }
            };
            return;
        }

        if (isNaN(parsedRegionId) || parsedRegionId <= 0) {
            context.res = {
                status: 400,
                headers: setCorsHeaders(),
                body: {
                    error: "Invalid region_id parameter",
                    message: "region_id must be a positive integer"
                }
            };
            return;
        }

        // Check which market history table exists
        let tableName = 'market_history';
        try {
            const pool = await getPool();
            const tableCheck = await pool.request().query(`
                SELECT COUNT(*) as table_exists 
                FROM INFORMATION_SCHEMA.TABLES 
                WHERE TABLE_NAME = 'market_history_live'
            `);
            if (tableCheck.recordset[0].table_exists > 0) {
                tableName = 'market_history_live';
                context.log('Using market_history_live table');
            } else {
                context.log('Using market_history table (market_history_live not found)');
            }
        } catch (tableCheckError) {
            context.log.warn('Could not check table existence, using market_history:', tableCheckError.message);
        }

        // Build the query
        const query = `
            SELECT 
                date,
                average,
                highest,
                lowest,
                order_count,
                volume
            FROM ${tableName}
            WHERE type_id = @type_id 
                AND region_id = @region_id
                AND date >= DATEADD(day, -@days, GETDATE())
            ORDER BY date DESC
        `;

        const pool = await getPool();
        const request = pool.request();
        request.input('type_id', sql.Int, parsedTypeId);
        request.input('region_id', sql.Int, parsedRegionId);
        request.input('days', sql.Int, days);

        context.log(`🧠 Executing query: ${query}`);
        context.log(`🔍 Parameters: type_id=${parsedTypeId}, region_id=${parsedRegionId}, days=${days}`);

        try {
            const result = await request.query(query);
            context.log(`✅ Query executed. Rows returned: ${result.recordset.length}`);

            const history = result.recordset.map(row => ({
                date: row.date,
                average: row.average,
                highest: row.highest,
                lowest: row.lowest,
                order_count: row.order_count,
                volume: row.volume
            }));

            context.res = {
                status: 200,
                headers: setCorsHeaders(),
                body: {
                    type_id: parsedTypeId,
                    region_id: parsedRegionId,
                    days: days,
                    history: history,
                    count: history.length,
                    tableName: tableName
                }
            };
        } catch (error) {
            context.log.error('❌ SQL query failed:', error);
            context.res = {
                status: 500,
                headers: setCorsHeaders(),
                body: {
                    error: 'SQL query failed',
                    details: error.message,
                    timestamp: new Date().toISOString()
                }
            };
        }
    } catch (error) {
        context.log.error('❌ Unhandled error in market history function:', error);
        context.res = {
            status: 500,
            headers: setCorsHeaders(),
            body: {
                error: error.message || 'Unhandled server error',
                timestamp: new Date().toISOString()
            }
        };
    }
};

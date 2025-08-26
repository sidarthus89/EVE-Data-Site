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
        context.log('✅ Market orders endpoint called');

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
        const location_id = req.query.location_id;
        const is_buy_order = req.query.is_buy_order;

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

        const parsedTypeId = parseInt(type_id);
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
                context.log('Using market_orders table (market_orders_live not found)');
            }
        } catch (tableCheckError) {
            context.log.warn('Could not check table existence, using market_orders:', tableCheckError.message);
        }

        let query = `
            SELECT 
                order_id, type_id, region_id, location_id, system_id, station_id,
                price, volume_total, volume_remain, min_volume, is_buy_order,
                duration, issued, range,
                location_name AS name,
                region_name,
                security_status AS security,
                location_type,
                is_npc
            FROM ${tableName}
            LEFT JOIN v_active_stations ON ${tableName}.location_id = v_active_stations.location_id
            WHERE type_id = @type_id AND volume_remain > 0
        `;

        const pool = await getPool();
        const request = pool.request();
        request.input('type_id', sql.Int, parsedTypeId);

        if (region_id && region_id !== 'all') {
            const parsedRegionId = parseInt(region_id);
            if (!isNaN(parsedRegionId)) {
                query += " AND region_id = @region_id";
                request.input('region_id', sql.Int, parsedRegionId);
            }
        }

        if (location_id) {
            const parsedLocationId = parseInt(location_id);
            if (!isNaN(parsedLocationId)) {
                query += " AND location_id = @location_id";
                request.input('location_id', sql.BigInt, parsedLocationId);
            }
        }

        if (is_buy_order !== null && is_buy_order !== undefined) {
            query += " AND is_buy_order = @is_buy_order";
            request.input('is_buy_order', sql.Bit, is_buy_order === 'true' ? 1 : 0);
        }

        if (is_buy_order === 'true') {
            query += " ORDER BY price DESC";
        } else if (is_buy_order === 'false') {
            query += " ORDER BY price ASC";
        } else {
            // Default: group buys first, then sort price descending
            query += " ORDER BY is_buy_order DESC, price DESC";
        }

        query += " OFFSET 0 ROWS FETCH NEXT 1000 ROWS ONLY";

        context.log(`🧠 Executing query: ${query}`);
        context.log(`🔍 Parameters: type_id=${parsedTypeId}, region_id=${region_id}, location_id=${location_id}, is_buy_order=${is_buy_order}`);

        try {
            const result = await request.query(query);
            context.log(`✅ Query executed. Rows returned: ${result.recordset.length}`);

            const orders = result.recordset.map(order => ({
                ...order,
                name: order.name || 'Unknown',
                regionName: order.region_name || 'Unknown',
                security: typeof order.security === 'number' ? order.security : null,
                type: order.location_type || 'unknown',
                isNPC: order.is_npc === 1
            }));

            const buyOrders = orders.filter(order => order.is_buy_order);
            const sellOrders = orders.filter(order => !order.is_buy_order);

            context.log(`📦 Found ${orders.length} total orders (${buyOrders.length} buy, ${sellOrders.length} sell)`);

            context.res = {
                status: 200,
                headers: setCorsHeaders(),
                body: {
                    buyOrders: buyOrders,
                    sellOrders: sellOrders,
                    meta: {
                        totalOrders: orders.length,
                        buyCount: buyOrders.length,
                        sellCount: sellOrders.length,
                        tableName: tableName,
                        parameters: {
                            type_id: parsedTypeId,
                            region_id: region_id,
                            location_id: location_id,
                            is_buy_order: is_buy_order
                        }
                    }
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
        context.log.error('❌ Unhandled error in market orders function:', error);
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

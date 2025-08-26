// Region Hauling Azure Function - JavaScript version
// Handles /api/region_hauling endpoint for profitable region-to-region or intra-region trade routes

const sql = require('mssql');

const dbConfig = {
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    server: process.env.DB_SERVER,
    pool: { max: 10, min: 0, idleTimeoutMillis: 30000 },
    options: { encrypt: true, trustServerCertificate: false }
};

let poolPromise;
async function getPool() {
    try {
        if (!poolPromise) {
            poolPromise = sql.connect(dbConfig);
        }
        return poolPromise;
    } catch (err) {
        console.error('❌ SQL connection failed:', err.message);
        throw new Error('Database connection failed: ' + err.message);
    }
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

        const pool = await getPool();
        const request = pool.request();
        request.input('origin_region_id', sql.Int, parseInt(origin_region_id));
        if (destination_region_id) {
            request.input('destination_region_id', sql.Int, parseInt(destination_region_id));
        }

        // Check which table exists first
        let tableName = 'market_orders';
        try {
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
      FROM ${tableName} sell
      JOIN ${tableName} buy ON sell.type_id = buy.type_id
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

        context.log(`Found ${routes.length} routes`);

        context.res = {
            status: 200,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type'
            },
            body: {
                origin_region_id,
                destination_region_id: destination_region_id || origin_region_id,
                routes,
                count: routes.length,
                tableName
            }
        };
    } catch (error) {
        context.log.error('❌ Error in region hauling:', error);
        context.res = {
            status: 500,
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Content-Type': 'application/json',
                'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type'
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

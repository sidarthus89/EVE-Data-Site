// Hauling Endpoint Azure Function - JavaScript version
// Handles /api/hauling endpoint for trade route analysis
// azure-function-deploy/hauling_endpoint/index.js

const { loadRegions } = require('../../utils/locationsServer');
const sql = require('mssql');
const fetch = require('node-fetch');

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

// Function to fetch and update SQL database with ESI data
const updateDatabaseWithESIData = async (fromRegion, toRegion) => {
    try {
        // Fetch market orders from ESI
        const esiResponse = await fetch(
            `${process.env.ESI_BASE}/markets/${fromRegion}/orders/`
        ).then(res => res.json());

        if (!esiResponse || !Array.isArray(esiResponse)) {
            throw new Error('Invalid ESI response');
        }

        const pool = await getPool();
        const transaction = pool.transaction();
        await transaction.begin();

        const tableName = 'market_orders_live';

        // Upsert data into the database
        for (const order of esiResponse) {
            await transaction.request()
                .input('type_id', sql.Int, order.type_id)
                .input('region_id', sql.Int, fromRegion)
                .input('location_id', sql.Int, order.location_id)
                .input('price', sql.Float, order.price)
                .input('volume_remain', sql.Int, order.volume_remain)
                .input('is_buy_order', sql.Bit, order.is_buy_order)
                .query(`
                    MERGE ${tableName} AS target
                    USING (SELECT @type_id AS type_id, @region_id AS region_id, @location_id AS location_id) AS source
                    ON target.type_id = source.type_id AND target.region_id = source.region_id AND target.location_id = source.location_id
                    WHEN MATCHED THEN
                        UPDATE SET price = @price, volume_remain = @volume_remain, is_buy_order = @is_buy_order
                    WHEN NOT MATCHED THEN
                        INSERT (type_id, region_id, location_id, price, volume_remain, is_buy_order)
                        VALUES (@type_id, @region_id, @location_id, @price, @volume_remain, @is_buy_order);
                `);
        }

        await transaction.commit();
        return true;
    } catch (error) {
        context.log.error('Error updating database with ESI data:', error);
        throw error;
    }
};

// Update the main function to call the database update logic
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
        const from_region = req.query.from || '10000002'; // Default to The Forge (Jita)
        const to_region = req.query.to || '10000043';     // Default to Domain (Amarr)

        // Update the database with the latest ESI data
        await updateDatabaseWithESIData(from_region, to_region);

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
        FROM market_orders_live m1
        JOIN market_orders_live m2 ON m1.type_id = m2.type_id
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

        context.res = {
            status: 200,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type'
            },
            body: {
                message: 'Hauling data retrieved from database',
                from_region: from_region,
                to_region: to_region,
                trades: trades,
                count: trades.length,
                status: 'Connected to Azure SQL Database'
            }
        };

    } catch (error) {
        context.log.error('Error in hauling endpoint:', error);
        context.res = {
            status: 500,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type'
            },
            body: {
                message: 'Error retrieving hauling data',
                error: error.message
            }
        };
    }
};
// Station Hauling Azure Function - JavaScript version
// Handles /api/station_hauling endpoint for profitable station-to-station trade routes

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
    const { origin_id, destination_id } = req.query;

    if (!origin_id || !destination_id) {
        context.res = {
            status: 400,
            headers: { 'Access-Control-Allow-Origin': '*' },
            body: { error: 'origin_id and destination_id are required' }
        };
        return;
    }

    try {
        const pool = await getPool();
        const request = pool.request();
        request.input('origin_id', sql.BigInt, parseInt(origin_id));
        request.input('destination_id', sql.BigInt, parseInt(destination_id));

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
      FROM market_orders_live sell
      JOIN market_orders_live buy ON sell.type_id = buy.type_id
      WHERE sell.is_buy_order = 0
        AND buy.is_buy_order = 1
        AND sell.location_id = @origin_id
        AND buy.location_id = @destination_id
        AND buy.price > sell.price
        AND sell.volume_remain > 0
        AND buy.volume_remain > 0
      ORDER BY profit_margin DESC
    `;

        const result = await request.query(query);
        const routes = result.recordset || [];

        context.res = {
            status: 200,
            headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
            body: {
                origin_id,
                destination_id,
                routes,
                count: routes.length
            }
        };
    } catch (error) {
        context.log.error('❌ Error in station hauling:', error);
        context.res = {
            status: 500,
            headers: { 'Access-Control-Allow-Origin': '*' },
            body: { error: error.message }
        };
    }
};

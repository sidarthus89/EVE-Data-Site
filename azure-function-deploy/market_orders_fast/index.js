const sql = require('mssql');

const dbConfig = {
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    server: process.env.DB_SERVER,
    options: { encrypt: true }
};

module.exports = async function (context, req) {
    const typeId = parseInt(req.query.type_id, 10);
    const regionId = req.query.region_id ? parseInt(req.query.region_id, 10) : null;
    const locationId = req.query.location_id ? parseInt(req.query.location_id, 10) : null;
    const isBuy = req.query.is_buy_order !== undefined ? req.query.is_buy_order === 'true' : null;

    if (!typeId) {
        context.res = {
            status: 400,
            headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
            body: { error: 'type_id is required' }
        };
        return;
    }

    try {
        const pool = await sql.connect(dbConfig);
        let query = `SELECT * FROM market_orders WHERE type_id = @typeId`;
        const request = pool.request().input('typeId', sql.Int, typeId);

        if (regionId !== null) {
            query += ' AND region_id = @regionId';
            request.input('regionId', sql.Int, regionId);
        }
        if (locationId !== null) {
            query += ' AND location_id = @locationId';
            request.input('locationId', sql.BigInt, locationId);
        }
        if (isBuy !== null) {
            query += ' AND is_buy_order = @isBuy';
            request.input('isBuy', sql.Bit, isBuy);
        }

        const result = await request.query(query);
        const rows = result.recordset || [];
        // Split buys and sells
        const buyOrders = rows.filter(r => r.is_buy_order);
        const sellOrders = rows.filter(r => !r.is_buy_order);

        context.res = {
            status: 200,
            headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
            body: { buyOrders, sellOrders, meta: { count: rows.length, timestamp: new Date().toISOString() } }
        };
    } catch (error) {
        context.log.error('MarketOrders error:', error);
        context.res = {
            status: 500,
            headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
            body: { error: 'Failed to fetch market orders' }
        };
    }
};
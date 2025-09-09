const sql = require('mssql');
const fetch = require('node-fetch');

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
    const limit = req.query.limit ? parseInt(req.query.limit, 10) : null;

    if (!typeId) {
        context.res = {
            status: 400,
            headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
            body: { error: 'type_id is required' }
        };
        return;
    }

    // Helper: ESI fallback using region and type
    async function fetchFromESI() {
        if (!regionId) {
            throw new Error('No SQL and no region_id provided for ESI fallback');
        }
        const base = process.env.ESI_BASE || 'https://esi.evetech.net/latest';
        const url = `${base}/markets/${regionId}/orders/?type_id=${typeId}`;
        const headers = { 'User-Agent': 'EVE-Data-Site/1.0 (GitHub: sidarthus89)' };
        const resp = await fetch(url, { headers });
        if (!resp.ok) {
            throw new Error(`ESI ${resp.status}`);
        }
        let orders = await resp.json();
        if (isBuy !== null) orders = orders.filter(o => !!o.is_buy_order === isBuy);
        if (locationId !== null) orders = orders.filter(o => Number(o.location_id) === Number(locationId));
        if (limit) orders = orders.slice(0, limit);
        const buyOrders = orders.filter(o => !!o.is_buy_order);
        const sellOrders = orders.filter(o => !o.is_buy_order);
        return { buyOrders, sellOrders, source: 'esi' };
    }

    try {
        // Try SQL first
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
        if (limit) {
            query = query.replace('SELECT *', `SELECT TOP (${limit}) *`);
        }

        const result = await request.query(query);
        const rows = result.recordset || [];
        if (rows.length > 0) {
            const buyOrders = rows.filter(r => r.is_buy_order);
            const sellOrders = rows.filter(r => !r.is_buy_order);
            context.res = {
                status: 200,
                headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
                body: { buyOrders, sellOrders, meta: { count: rows.length, timestamp: new Date().toISOString(), source: 'sql' } }
            };
            return;
        }
        // No SQL rows: fallback to ESI
        const { buyOrders, sellOrders, source } = await fetchFromESI();
        context.res = {
            status: 200,
            headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
            body: { buyOrders, sellOrders, meta: { count: buyOrders.length + sellOrders.length, timestamp: new Date().toISOString(), source } }
        };
    } catch (error) {
        context.log.error('MarketOrders error:', error);
        // Try ESI fallback on SQL error
        try {
            const { buyOrders, sellOrders, source } = await fetchFromESI();
            context.res = {
                status: 200,
                headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
                body: { buyOrders, sellOrders, meta: { count: buyOrders.length + sellOrders.length, timestamp: new Date().toISOString(), source } }
            };
        } catch (fallbackErr) {
            context.log.error('ESI fallback failed:', fallbackErr);
            context.res = {
                status: 500,
                headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
                body: { error: 'Failed to fetch market orders' }
            };
        }
    }
};
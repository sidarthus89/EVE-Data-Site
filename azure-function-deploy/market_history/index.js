const sql = require('mssql');

// Database configuration from environment variables
const config = {
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    server: process.env.DB_SERVER,
    database: process.env.DB_NAME,
    options: {
        encrypt: true,
        enableArithAbort: true
    }
};

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
    const typeId = req.query.type_id;
    const regionId = req.query.region_id;
    const days = req.query.days ? parseInt(req.query.days) : 30;

    if (!typeId || !regionId) {
        context.res = {
            status: 400,
            headers: setCorsHeaders(),
            body: 'Missing type_id or region_id query parameter.'
        };
        return;
    }

    try {
        // Connect to the database
        await sql.connect(config);
        const requestSql = new sql.Request();
        requestSql.input('typeId', sql.Int, parseInt(typeId));
        requestSql.input('regionId', sql.Int, parseInt(regionId));
        requestSql.input('days', sql.Int, days);

        // Execute query to retrieve market history
        const query = `
                    SELECT *
                    FROM price_history
                    WHERE type_id = @typeId
                        AND region_id = @regionId
                        AND date > DATEADD(day, -@days, GETDATE())
                    ORDER BY date ASC;
                `;
        const result = await requestSql.query(query);

        context.res = {
            status: 200,
            headers: setCorsHeaders(),
            body: result.recordset
        };
    } catch (err) {
        context.log.error('Error querying market history:', err);
        context.res = {
            status: 500,
            headers: setCorsHeaders(),
            body: 'Internal Server Error'
        };
    }
};

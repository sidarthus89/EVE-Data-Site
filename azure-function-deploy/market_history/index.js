// azure-function-deploy/market_history/index.js
const sql = require('mssql');

// Helper function to set consistent CORS headers
function setCorsHeaders() {
    return {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': 'https://sidarthus89.github.io',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Max-Age': '86400'
    };
}

module.exports = async function (context, req) {
    try {
        context.log('🚀 Function started');

        // Handle CORS preflight requests
        if (req.method === 'OPTIONS') {
            context.log('✅ CORS preflight request handled');
            context.res = {
                status: 200,
                headers: setCorsHeaders()
            };
            return;
        }

        context.log('📋 Request details:', {
            method: req.method,
            query: req.query,
            url: req.url
        });

        // Parse query parameters
        const typeId = req.query.type_id;
        const regionId = req.query.region_id;
        const days = req.query.days ? parseInt(req.query.days) : 30;

        context.log('🔍 Parsed parameters:', { typeId, regionId, days });

        if (!typeId || !regionId) {
            context.log('❌ Missing parameters');
            context.res = {
                status: 400,
                headers: setCorsHeaders(),
                body: {
                    error: 'Missing type_id or region_id query parameter.',
                    received: { type_id: typeId, region_id: regionId }
                }
            };
            return;
        }

        // Check environment variables first
        context.log('🔐 Environment variables check:', {
            DB_SERVER: process.env.DB_SERVER ? 'SET' : 'NOT SET',
            DB_NAME: process.env.DB_NAME ? 'SET' : 'NOT SET',
            DB_USER: process.env.DB_USER ? 'SET' : 'NOT SET',
            DB_PASSWORD: process.env.DB_PASSWORD ? 'SET' : 'NOT SET'
        });

        if (!process.env.DB_SERVER || !process.env.DB_NAME || !process.env.DB_USER || !process.env.DB_PASSWORD) {
            context.log('❌ Missing required environment variables');
            context.res = {
                status: 500,
                headers: setCorsHeaders(),
                body: {
                    error: 'Server configuration error',
                    message: 'Missing database connection parameters'
                }
            };
            return;
        }

        // Database configuration
        const config = {
            user: process.env.DB_USER,
            password: process.env.DB_PASSWORD,
            server: process.env.DB_SERVER,
            database: process.env.DB_NAME,
            options: {
                encrypt: true,
                enableArithAbort: true,
                trustServerCertificate: false
            },
            pool: {
                max: 10,
                min: 0,
                idleTimeoutMillis: 30000
            },
            connectionTimeout: 30000,
            requestTimeout: 30000
        };

        context.log('🔌 Attempting database connection...');

        try {
            // Test basic connection
            const pool = new sql.ConnectionPool(config);
            await pool.connect();

            context.log('✅ Database connected successfully');

            const request = pool.request();
            request.input('typeId', sql.Int, parseInt(typeId));
            request.input('regionId', sql.Int, parseInt(regionId));
            request.input('days', sql.Int, days);

            context.log('📊 Executing query...');

            const query = `
                SELECT TOP 10
                    region_id,
                    type_id,
                    date,
                    average,
                    highest,
                    lowest,
                    order_count,
                    volume
                FROM price_history
                WHERE type_id = @typeId
                    AND region_id = @regionId
                    AND date >= DATEADD(day, -@days, CAST(GETDATE() AS DATE))
                ORDER BY date DESC;
            `;

            const result = await request.query(query);

            context.log('✅ Query executed. Records found:', result.recordset.length);

            await pool.close();

            context.res = {
                status: 200,
                headers: setCorsHeaders(),
                body: {
                    success: true,
                    data: result.recordset,
                    meta: {
                        type_id: parseInt(typeId),
                        region_id: parseInt(regionId),
                        days: days,
                        record_count: result.recordset.length
                    }
                }
            };

        } catch (dbError) {
            context.log.error('❌ Database connection/query error:', {
                message: dbError.message,
                code: dbError.code,
                number: dbError.number,
                state: dbError.state,
                originalError: dbError.originalError
            });

            context.res = {
                status: 500,
                headers: setCorsHeaders(),
                body: {
                    error: 'Database error',
                    message: dbError.message,
                    code: dbError.code
                }
            };
        }

    } catch (generalError) {
        context.log.error('💥 General function error:', {
            message: generalError.message,
            stack: generalError.stack
        });

        context.res = {
            status: 500,
            headers: setCorsHeaders(),
            body: {
                error: 'Function execution error',
                message: generalError.message
            }
        };
    }
};
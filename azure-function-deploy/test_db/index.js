// Create this as azure-function-deploy/test_db/index.js
const sql = require('mssql');

const dbConfig = {
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    server: process.env.DB_SERVER,
    options: {
        encrypt: true,
        trustServerCertificate: false,
        connectTimeout: 30000,
        requestTimeout: 30000
    }
};

module.exports = async function (context, req) {
    context.log('=== Database Connection Test Started ===');

    // Log environment variables (without sensitive data)
    context.log('Environment check:', {
        server: process.env.DB_SERVER,
        database: process.env.DB_NAME,
        user: process.env.DB_USER,
        hasPassword: !!process.env.DB_PASSWORD
    });

    try {
        context.log('Attempting to connect to SQL Server...');

        const pool = await sql.connect(dbConfig);
        context.log('✅ Connected to database successfully');

        // Test a simple query
        context.log('Testing simple query...');
        const result = await pool.request().query('SELECT 1 as test_value, GETDATE() as current_time');
        context.log('✅ Query executed successfully');

        // Test if market_orders table exists
        context.log('Checking for market_orders table...');
        const tableCheck = await pool.request().query(`
            SELECT COUNT(*) as table_exists 
            FROM INFORMATION_SCHEMA.TABLES 
            WHERE TABLE_NAME = 'market_orders'
        `);

        const hasMarketTable = tableCheck.recordset[0].table_exists > 0;
        context.log(hasMarketTable ? '✅ market_orders table exists' : '❌ market_orders table not found');

        // If table exists, get sample data
        let sampleData = null;
        if (hasMarketTable) {
            context.log('Getting sample market data...');
            const sampleResult = await pool.request().query('SELECT TOP 5 * FROM market_orders');
            sampleData = sampleResult.recordset;
            context.log(`✅ Found ${sampleData.length} sample records`);
        }

        await pool.close();

        context.res = {
            status: 200,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            },
            body: {
                success: true,
                message: 'Database connection successful',
                details: {
                    server: process.env.DB_SERVER,
                    database: process.env.DB_NAME,
                    hasMarketTable,
                    testQuery: result.recordset[0],
                    sampleDataCount: sampleData ? sampleData.length : 0,
                    timestamp: new Date().toISOString()
                }
            }
        };

    } catch (error) {
        context.log.error('❌ Database connection failed:', {
            message: error.message,
            code: error.code,
            stack: error.stack
        });

        let errorDetails = {
            message: error.message,
            code: error.code
        };

        // Provide specific guidance based on error type
        let guidance = '';
        if (error.code === 'ENOTFOUND') {
            guidance = 'Server name not found. Check DB_SERVER setting.';
        } else if (error.code === 'ELOGIN') {
            guidance = 'Login failed. Check DB_USER and DB_PASSWORD settings.';
        } else if (error.code === 'ETIMEOUT') {
            guidance = 'Connection timeout. Server may be overloaded or firewall blocking.';
        }

        context.res = {
            status: 500,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            },
            body: {
                success: false,
                error: 'Database connection test failed',
                details: errorDetails,
                guidance,
                config: {
                    server: process.env.DB_SERVER,
                    database: process.env.DB_NAME,
                    user: process.env.DB_USER,
                    hasPassword: !!process.env.DB_PASSWORD
                }
            }
        };
    }
};
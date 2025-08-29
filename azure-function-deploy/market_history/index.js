// azure-function-deploy/market_history/index.js
// Minimal test version to isolate the module loading issue

module.exports = async function (context, req) {
    const headers = {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': 'https://sidarthus89.github.io',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Max-Age': '86400'
    };

    try {
        context.log('Function started - Basic test');

        // Handle CORS preflight
        if (req.method === 'OPTIONS') {
            context.log('CORS preflight handled');
            context.res = { status: 200, headers: headers };
            return;
        }

        // Test 1: Basic function works
        context.log('Test 1: Basic function execution');

        // Test 2: Environment variables
        const envTest = {
            NODE_VERSION: process.version,
            NODE_ENV: process.env.NODE_ENV || 'not set',
            DB_SERVER: process.env.DB_SERVER ? 'SET' : 'NOT SET',
            DB_NAME: process.env.DB_NAME ? 'SET' : 'NOT SET',
            DB_USER: process.env.DB_USER ? 'SET' : 'NOT SET',
            DB_PASSWORD: process.env.DB_PASSWORD ? 'SET' : 'NOT SET'
        };
        context.log('Environment test:', envTest);

        // Test 3: Try to require mssql
        let msqlTest = { status: 'not_attempted', error: null, version: null };
        try {
            context.log('Attempting to require mssql...');
            const sql = require('mssql');
            msqlTest.status = 'success';
            msqlTest.version = sql.version || 'version_unknown';
            context.log('mssql module loaded successfully');
        } catch (requireError) {
            msqlTest.status = 'failed';
            msqlTest.error = {
                message: requireError.message,
                code: requireError.code,
                stack: requireError.stack
            };
            context.log.error('Failed to require mssql:', requireError);
        }

        // Test 4: File system check (if possible)
        let fsTest = { status: 'not_attempted', error: null };
        try {
            const fs = require('fs');
            const path = require('path');
            const currentDir = process.cwd();
            const files = fs.readdirSync(currentDir);
            fsTest.status = 'success';
            fsTest.currentDir = currentDir;
            fsTest.files = files;
            context.log('File system check:', { currentDir, files });
        } catch (fsError) {
            fsTest.status = 'failed';
            fsTest.error = fsError.message;
            context.log.error('File system check failed:', fsError);
        }

        // Return comprehensive test results
        context.res = {
            status: 200,
            headers: headers,
            body: {
                success: true,
                timestamp: new Date().toISOString(),
                tests: {
                    basic_function: 'passed',
                    environment: envTest,
                    mssql_module: msqlTest,
                    file_system: fsTest
                },
                query_params: req.query || {},
                function_info: {
                    invocation_id: context.invocationId,
                    function_name: context.functionName,
                    execution_context: typeof context.executionContext !== 'undefined' ? 'available' : 'not_available'
                }
            }
        };

    } catch (generalError) {
        context.log.error('General function error:', {
            message: generalError.message,
            stack: generalError.stack,
            name: generalError.name
        });

        context.res = {
            status: 500,
            headers: headers,
            body: {
                error: 'Function execution error',
                message: generalError.message,
                name: generalError.name,
                stack: generalError.stack,
                timestamp: new Date().toISOString()
            }
        };
    }
};
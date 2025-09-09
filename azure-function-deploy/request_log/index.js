const telemetry = require('../utils/telemetry');

module.exports = async function (context, req) {
    telemetry.init();

    const corsHeaders = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization'
    };

    if (req.method === 'OPTIONS') {
        context.res = { status: 200, headers: corsHeaders };
        return;
    }

    const body = req.body || {};
    const name = body.name || req.query.name; // e.g., "10000002-10000043.json"
    const source = body.source || req.query.source || 'spa';
    const ip = (req.headers["x-forwarded-for"] || req.headers["x-client-ip"] || req.headers["x-appgw-trace-id"] || '').toString();

    if (name) {
        telemetry.trackEvent('SNAPSHOT_REQUEST', { name, source, ip });
    } else {
        telemetry.trackTrace('SNAPSHOT_REQUEST_MISSING_NAME', { source, ip });
    }

    context.res = {
        status: 200,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
        body: { ok: true }
    };
};

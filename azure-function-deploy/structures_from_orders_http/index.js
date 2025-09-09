const { run } = require('../structures_from_orders');

module.exports = async function (context, req) {
    const cors = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization'
    };
    if (req.method === 'OPTIONS') {
        context.res = { status: 200, headers: cors };
        return;
    }
    try {
        const summary = await run(context);
        context.res = {
            status: 200,
            headers: { 'Content-Type': 'application/json', ...cors },
            body: summary
        };
    } catch (e) {
        context.res = { status: 500, headers: cors, body: e.message };
    }
};

const { upsertDataToAll } = require('../utils/github');

module.exports = async function (context, req) {
    const corsHeaders = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization'
    };

    if (req.method === 'OPTIONS') {
        context.res = { status: 200, headers: corsHeaders };
        return;
    }

    const ts = new Date().toISOString();
    // Use branch-aware data prefix so this writes to 'data/' on gh-pages (or 'public/data' on other branches)
    const relativePath = 'region_hauling/.diag.txt';
    const payload = `diag write ${ts}\n`;
    try {
        const results = await upsertDataToAll(relativePath, payload, `chore(diag): write ${relativePath}`);
        context.res = {
            status: 200,
            headers: { 'Content-Type': 'application/json', ...corsHeaders },
            body: { ok: true, path: `data/${relativePath}`, results }
        };
    } catch (e) {
        context.res = {
            status: 500,
            headers: { 'Content-Type': 'application/json', ...corsHeaders },
            body: { ok: false, error: e.message }
        };
    }
};

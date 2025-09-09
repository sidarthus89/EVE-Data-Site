const { uploadJsonBlob } = require('../utils/blob');

module.exports = async function (context, req) {
    context.log('structures_upload invoked');
    context.res = { headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS' } };
    if (req.method === 'OPTIONS') return;

    try {
        const body = req.body;
        if (!body) {
            context.res = { status: 400, body: { error: 'Missing JSON body' } };
            return;
        }

        const path = 'structures/structures.json';
        const url = await uploadJsonBlob(path, body, 'public, max-age=3600');
        context.res = { status: 200, body: { ok: true, url, count: Array.isArray(body) ? body.length : undefined } };
    } catch (err) {
        context.log.error('Upload failed', err);
        context.res = { status: 500, body: { error: err.message } };
    }
};

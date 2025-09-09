const sql = require('mssql');
const fetch = require('node-fetch');
const { uploadJsonBlob } = require('../utils/old_blob');

const dbConfig = {
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    server: process.env.DB_SERVER,
    options: { encrypt: true }
};

module.exports = async function (context) {
    context.log('regions_with_markets started');
    try {
        let regionIds = new Set();

        // Prefer SQL aggregate table if present
        try {
            const pool = await sql.connect(dbConfig);
            const q = await pool.request().query(`
        SELECT DISTINCT region_id FROM aggregated_orders WHERE (best_buy_price IS NOT NULL OR best_sell_price IS NOT NULL)
      `);
            q.recordset.forEach(r => regionIds.add(r.region_id));
        } catch (e) {
            context.log('SQL not available or table missing, falling back to JSON');
        }

        if (regionIds.size === 0) {
            // Fallback: from stations (NPC) and structures blob
            const base = process.env.BLOB_PUBLIC_HTTP_BASE || process.env.BLOB_ACCOUNT_URL?.replace('.blob.core.windows.net', '.blob.core.windows.net');
            async function safeJson(url) { try { const r = await fetch(url); if (r.ok) return r.json(); } catch (_) { } return []; }
            const stations = await safeJson(`${base}/public/stations/stations_npc.json`);
            stations.forEach(s => regionIds.add(s.region_id));
            const structures = await safeJson(`${base}/public/structures/structures.json`);
            structures.forEach(s => { if (s.region_id) regionIds.add(s.region_id); });
        }

        // Map to minimal array of ids
        const output = Array.from(regionIds.values()).sort((a, b) => a - b);
        const url = await uploadJsonBlob('regions/regions_with_markets.json', output, 'public, max-age=3600');
        context.log(`Uploaded regions_with_markets.json to ${url} with ${output.length} regions`);
    } catch (err) {
        context.log.error('regions_with_markets failed', err);
        throw err;
    }
};

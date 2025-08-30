#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const sql = require('mssql');

require('dotenv').config();
// merge local.settings.json Values if present
try {
    const localSettingsPath = path.join(__dirname, '../azure-function-deploy/local.settings.json');
    if (fs.existsSync(localSettingsPath)) {
        const raw = fs.readFileSync(localSettingsPath, 'utf8');
        const parsed = JSON.parse(raw);
        if (parsed && parsed.Values) {
            Object.entries(parsed.Values).forEach(([k, v]) => {
                if (process.env[k] === undefined && v !== undefined) process.env[k] = v;
            });
        }
    }
} catch (e) { }

async function main() {
    const connectionString = process.env.DB_CONNECTION_STRING;
    try {
        if (connectionString) {
            await sql.connect(connectionString);
        } else {
            const cfg = {
                user: process.env.DB_USER,
                password: process.env.DB_PASSWORD,
                database: process.env.DB_NAME,
                server: process.env.DB_SERVER,
                options: { encrypt: true, trustServerCertificate: true }
            };
            await sql.connect(cfg);
        }

        const queries = [
            { name: 'total_locations', q: "SELECT COUNT(*) AS cnt FROM locations" },
            { name: 'npc_stations', q: "SELECT COUNT(*) AS cnt FROM locations WHERE is_npc = 1 AND location_type IN ('station','structure')" },
            { name: 'player_structures', q: "SELECT COUNT(*) AS cnt FROM locations WHERE is_npc = 0 AND location_type = 'structure'" },
            { name: 'market_cache', q: "IF OBJECT_ID('market_structure_cache','U') IS NOT NULL SELECT COUNT(*) AS cnt FROM market_structure_cache ELSE SELECT NULL AS cnt" }
        ];

        for (const item of queries) {
            try {
                const res = await sql.query(item.q);
                const cnt = res && res.recordset && res.recordset[0] ? res.recordset[0].cnt : null;
            } catch (e) {
                console.log(`${item.name}: ERROR - ${e.message}`);
            }
        }

    } catch (err) {
        console.error('DB connection failed:', err.message || err);
        process.exit(1);
    } finally {
        await sql.close();
    }
}

main().catch(e => { console.error(e); process.exit(1); });

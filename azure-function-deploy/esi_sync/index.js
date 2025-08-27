// azure-function-deploy/esi_sync/index.js

// Full Azure Function ESI sync runner
const sql = require('mssql');
const fs = require('fs');
const path = require('path');
// HTTP fetch for ESI
const fetch = require('node-fetch');

const ESI_BASE = 'https://esi.evetech.net/latest';
const ESI_DATASOURCE = 'tranquility';
const STRUCTURE_CACHE_DAYS = parseInt(process.env.STRUCTURE_MARKET_CACHE_DAYS || '7', 10);
const STRUCTURE_CONCURRENCY = parseInt(process.env.STRUCTURE_CHECK_CONCURRENCY || '5', 10);
const RATE_LIMIT_PER_SECOND = parseInt(process.env.ESI_RATE_PER_SECOND || '50', 10);

const dbConfig = {
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    server: process.env.DB_SERVER,
    pool: { max: 20, min: 0, idleTimeoutMillis: 30000 },
    options: { encrypt: true, trustServerCertificate: false }
};

class RateLimiter {
    constructor(perSecond) { this.window = 1000; this.max = perSecond; this.times = []; }
    async throttle() {
        const now = Date.now();
        this.times = this.times.filter(t => now - t < this.window);
        if (this.times.length >= this.max) {
            const oldest = Math.min(...this.times);
            const wait = this.window - (now - oldest);
            if (wait > 0) await new Promise(r => setTimeout(r, wait));
            return this.throttle();
        }
        this.times.push(now);
    }
}

const rateLimiter = new RateLimiter(RATE_LIMIT_PER_SECOND);

function buildEsiUrl(endpoint, params = {}) {
    // endpoint may already contain query params. Build a URL that appends datasource and any extra params.
    const hasQuery = endpoint.indexOf('?') !== -1;
    const base = `${ESI_BASE}${endpoint}${hasQuery ? '&' : '?'}datasource=${ESI_DATASOURCE}`;
    const extra = Object.keys(params).map(k => `${encodeURIComponent(k)}=${encodeURIComponent(params[k])}`).join('&');
    return extra ? `${base}&${extra}` : base;
}

async function fetchESI(endpoint, retries = 3) {
    await rateLimiter.throttle();
    for (let i = 0; i < retries; i++) {
        try {
            const url = buildEsiUrl(endpoint);
            const resp = await fetch(url);
            if (!resp.ok) throw new Error(`ESI ${resp.status} ${resp.statusText}`);
            return await resp.json();
        } catch (err) {
            if (i === retries - 1) throw err;
            await new Promise(r => setTimeout(r, 1000 * (i + 1)));
        }
    }
}

async function fetchESIPaged(endpoint, opts = {}) {
    // Fetch paged ESI endpoints using the 'page' query parameter and x-pages header fallback.
    const results = [];
    let page = 1;
    let totalPages = null;
    while (true) {
        await rateLimiter.throttle();
        const url = buildEsiUrl(endpoint, { page });
        const resp = await fetch(url);
        if (!resp.ok) throw new Error(`ESI ${resp.status} ${resp.statusText}`);
        const pageJson = await resp.json();
        if (!Array.isArray(pageJson) || pageJson.length === 0) break;
        results.push(...pageJson);
        if (totalPages === null) {
            const xp = resp.headers.get('x-pages');
            if (xp) totalPages = parseInt(xp, 10);
            else {
                const link = resp.headers.get('link');
                if (link) {
                    const m = link.match(/<[^>]+[?&]page=(\d+)[^>]*>;\s*rel="last"/i);
                    if (m) totalPages = parseInt(m[1], 10);
                }
            }
        }
        if (totalPages !== null && page >= totalPages) break;
        page++;
    }
    return results;
}

function loggerFor(context) {
    if (!context) return console.log.bind(console);
    if (typeof context.log === 'function') return context.log;
    if (context.log && typeof context.log.log === 'function') return context.log.log.bind(context.log);
    return console.log.bind(console);
}

async function logStart(pool, type) {
    try {
        const r = await pool.request().input('updateType', sql.NVarChar, type).query("INSERT INTO esi_update_log (update_type, started_at, status) OUTPUT INSERTED.id VALUES (@updateType, GETDATE(), 'running')");
        return r.recordset && r.recordset[0] && r.recordset[0].id ? r.recordset[0].id : null;
    } catch (e) { return null; }
}

async function logComplete(pool, id, stats) {
    if (!id) return;
    try {
        await pool.request()
            .input('logId', sql.Int, id)
            .input('recordsProcessed', sql.Int, stats.processed || 0)
            .input('recordsAdded', sql.Int, stats.added || 0)
            .input('recordsUpdated', sql.Int, stats.updated || 0)
            .input('errorsCount', sql.Int, stats.errors || 0)
            .input('status', sql.NVarChar, stats.errors > 0 ? 'completed_with_errors' : 'completed')
            .query(
                `UPDATE esi_update_log
                     SET completed_at = GETDATE(),
                         records_processed = @recordsProcessed,
                         records_added = @recordsAdded,
                         records_updated = @recordsUpdated,
                         errors_count = @errorsCount,
                         status = @status,
                         duration_seconds = DATEDIFF(second, started_at, GETDATE())
                     WHERE id = @logId`
            );
    } catch (err) {
        logger('❌ Unhandled exception in ESI sync logComplete:', err.stack || err.message || err);
    }
}

async function upsertRegion(pool, regionId, regionInfo) {
    return pool.request().input('regionId', sql.Int, regionId).input('regionName', sql.NVarChar, regionInfo.name).input('description', sql.NVarChar, regionInfo.description || null).query(`MERGE regions AS target USING (SELECT @regionId as region_id, @regionName as region_name, @description as description) AS source ON target.region_id = source.region_id WHEN MATCHED THEN UPDATE SET region_name = source.region_name, description = source.description, last_updated = GETDATE() WHEN NOT MATCHED THEN INSERT (region_id, region_name, description) VALUES (source.region_id, source.region_name, source.description);`);
}

async function upsertSystemAndLocation(pool, systemId, systemInfo, regionId, regionName) {
    await pool.request().input('systemId', sql.Int, systemId).input('systemName', sql.NVarChar, systemInfo.name).input('regionId', sql.Int, regionId).input('constellationId', sql.Int, systemInfo.constellation_id).input('securityStatus', sql.Decimal(4, 3), systemInfo.security_status).input('securityClass', sql.NVarChar, systemInfo.security_status >= 0.5 ? 'highsec' : systemInfo.security_status > 0 ? 'lowsec' : 'nullsec').query(`MERGE systems AS target USING (SELECT @systemId as system_id, @systemName as system_name, @regionId as region_id, @constellationId as constellation_id, @securityStatus as security_status, @securityClass as security_class) AS source ON target.system_id = source.system_id WHEN MATCHED THEN UPDATE SET system_name = source.system_name, security_status = source.security_status, security_class = source.security_class, last_updated = GETDATE() WHEN NOT MATCHED THEN INSERT (system_id, system_name, region_id, constellation_id, security_status, security_class) VALUES (source.system_id, source.system_name, source.region_id, source.constellation_id, source.security_status, source.security_class);`);
    await pool.request().input('location_id', sql.BigInt, systemId).input('location_name', sql.NVarChar, systemInfo.name).input('location_type', sql.NVarChar, 'system').input('region_id', sql.Int, regionId).input('region_name', sql.NVarChar, regionName).input('system_id', sql.Int, systemId).input('system_name', sql.NVarChar, systemInfo.name).input('security_status', sql.Decimal(4, 3), systemInfo.security_status).input('is_npc', sql.Bit, true).execute('sp_upsert_location');
}

async function upsertStation(pool, stationId, stationInfo, regionId, regionName, systemId, systemName, securityStatus) {
    await pool.request().input('location_id', sql.BigInt, stationId).input('location_name', sql.NVarChar, stationInfo.name).input('location_type', sql.NVarChar, 'station').input('region_id', sql.Int, regionId).input('region_name', sql.NVarChar, regionName).input('system_id', sql.Int, systemId).input('system_name', sql.NVarChar, systemName).input('security_status', sql.Decimal(4, 3), securityStatus).input('is_npc', sql.Bit, true).execute('sp_upsert_location');
}

async function upsertStructureLocation(pool, structureId, info, regionId, regionName) {
    await pool.request().input('location_id', sql.BigInt, structureId).input('location_name', sql.NVarChar, info.name || ('Structure ' + structureId)).input('location_type', sql.NVarChar, 'structure').input('region_id', sql.Int, regionId).input('region_name', sql.NVarChar, regionName).input('system_id', sql.Int, info.system_id || null).input('system_name', sql.NVarChar, info.system_name || null).input('security_status', sql.Decimal(4, 3), info.security_status || 0).input('is_npc', sql.Bit, false).execute('sp_upsert_location');
}

async function isStructureMarketAccessible(pool, structureId) {
    // Check DB cache
    try {
        const r = await pool.request().input('structureId', sql.BigInt, structureId).query('SELECT structure_id, last_checked, last_ok, last_status_code FROM market_structure_cache WHERE structure_id = @structureId');
        if (r.recordset && r.recordset.length) {
            const rec = r.recordset[0];
            const ageMs = Date.now() - new Date(rec.last_checked).getTime();
            if (ageMs < STRUCTURE_CACHE_DAYS * 24 * 3600 * 1000) return rec.last_ok === 1;
        }
    } catch (e) { /* ignore */ }

    try {
        await rateLimiter.throttle();
        const url = `${ESI_BASE}/markets/structures/${structureId}/?datasource=${ESI_DATASOURCE}`;
        const resp = await fetch(url);
        const ok = resp.status === 200;
        try {
            await pool.request().input('structureId', sql.BigInt, structureId).input('lastChecked', sql.DateTime2, new Date()).input('lastOk', sql.Bit, ok ? 1 : 0).input('status', sql.Int, resp.status).query(`MERGE market_structure_cache AS target USING (SELECT @structureId as structure_id, @lastChecked as last_checked, @lastOk as last_ok, @status as last_status_code) AS source ON target.structure_id = source.structure_id WHEN MATCHED THEN UPDATE SET last_checked = source.last_checked, last_ok = source.last_ok, last_status_code = source.last_status_code WHEN NOT MATCHED THEN INSERT (structure_id, last_checked, last_ok, last_status_code) VALUES (source.structure_id, source.last_checked, source.last_ok, source.last_status_code);`);
        } catch (e) { /* ignore cache write error */ }
        return ok;
    } catch (e) {
        return false;
    }
}

async function syncMarketStructures(pool, logger) {
    logger('Syncing market structures (may be slow)');
    let structureIds = [];
    try {
        // Use a paged fetch for the structures list; ESI will often paginate this endpoint.
        structureIds = await fetchESIPaged('/universe/structures/?filter=market');
    } catch (e) {
        logger('Failed to fetch market structures from ESI:', e && e.message ? e.message : e);
        // Try local fallback (build output or pre-generated file)
        try {
            const fallbackPath = path.resolve(__dirname, '..', '..', 'public', 'data', 'structures.json');
            if (fs.existsSync(fallbackPath)) {
                const raw = fs.readFileSync(fallbackPath, 'utf8');
                const parsed = JSON.parse(raw);
                if (Array.isArray(parsed)) {
                    structureIds = parsed;
                    logger('Loaded structure IDs from local fallback:', fallbackPath, structureIds.length);
                }
            }
        } catch (fe) { logger('Local fallback read failed', fe && fe.message ? fe.message : fe); }
        if (!structureIds || !structureIds.length) return;
    }

    for (let i = 0; i < structureIds.length; i += STRUCTURE_CONCURRENCY) {
        const batch = structureIds.slice(i, i + STRUCTURE_CONCURRENCY);
        await Promise.all(batch.map(async sid => {
            try {
                const ok = await isStructureMarketAccessible(pool, sid);
                if (!ok) return;
                const info = await fetchESI(`/universe/structures/${sid}/`);
                let regionId = null; let regionName = null;
                if (info && info.system_id) {
                    try { const sys = await fetchESI(`/universe/systems/${info.system_id}/`); regionId = sys.region_id; } catch (e) { /* ignore */ }
                }
                await upsertStructureLocation(pool, sid, info || { name: `Structure ${sid}` }, regionId, regionName);
                logger('Upserted structure', sid);
            } catch (e) { logger('Structure processing error', sid, e && e.message ? e.message : e); }
        }));
    }
    logger('Market structures sync complete');
}

async function syncRegions(pool, logger) {
    const logId = await logStart(pool, 'regions');
    const stats = { processed: 0, added: 0, updated: 0, errors: 0 };
    try {
        logger('Fetching region list');
        const regionIds = await fetchESI('/universe/regions/');
        for (const regionId of regionIds) {
            try {
                const ri = await fetchESI(`/universe/regions/${regionId}/`);
                await upsertRegion(pool, regionId, ri);
                stats.processed++;
            } catch (e) { logger('Region error', regionId, e && e.message ? e.message : e); stats.errors++; }
        }
    } finally { await logComplete(pool, logId, stats); }
}

async function syncSystemsAndStations(pool, logger) {
    const logId = await logStart(pool, 'systems_and_stations');
    const stats = { processed: 0, added: 0, updated: 0, errors: 0 };
    try {
        const regions = await pool.request().query('SELECT region_id, region_name FROM regions ORDER BY region_id');
        for (const region of regions.recordset) {
            try {
                const regionInfo = await fetchESI(`/universe/regions/${region.region_id}/`);
                if (!regionInfo || !Array.isArray(regionInfo.constellations)) { logger('Bad region info', region.region_id); stats.errors++; continue; }
                for (const constellationId of regionInfo.constellations) {
                    try {
                        const con = await fetchESI(`/universe/constellations/${constellationId}/`);
                        for (const systemId of con.systems) {
                            try {
                                const syst = await fetchESI(`/universe/systems/${systemId}/`);
                                await upsertSystemAndLocation(pool, systemId, syst, region.region_id, region.region_name);
                                if (syst && Array.isArray(syst.stations)) {
                                    for (const stationId of syst.stations) {
                                        try {
                                            const stationInfo = await fetchESI(`/universe/stations/${stationId}/`);
                                            await upsertStation(pool, stationId, stationInfo, region.region_id, region.region_name, systemId, syst.name, syst.security_status);
                                        } catch (e) { logger('Station error', stationId, e && e.message ? e.message : e); stats.errors++; }
                                    }
                                }
                                stats.processed++;
                            } catch (e) { logger('System error', systemId, e && e.message ? e.message : e); stats.errors++; }
                        }
                    } catch (e) { logger('Constellation error', constellationId, e && e.message ? e.message : e); stats.errors++; }
                }
            } catch (e) { logger('Region loop error', region.region_id, e && e.message ? e.message : e); stats.errors++; }
        }
    } finally { await logComplete(pool, logId, stats); }
}

module.exports = async function runEsiSync(context, myTimer) {
    await syncPriceHistory(pool, log);

    const logger = loggerFor(context);
    logger('🔄 Starting full ESI sync');
    try {
        // Ensure fetch is available
        if (!global.fetch) {
            try { global.fetch = require('node-fetch'); }
            catch { logger('❌ node-fetch missing'); }
        }

        if (process.env.DRY_RUN === '1' || process.env.DRY_RUN === 'true') {
            logger('DRY_RUN enabled — running ESI reads only');
            const r = await fetchESI('/universe/regions/');
            logger('DRY_RUN fetched regions:', Array.isArray(r) ? r.length : 0);
            return;
        }

        let pool;
        try {
            pool = await sql.connect(dbConfig);
            logger('Connected to DB');

            // Order matters: regions -> systems/stations -> structures (structures use market checks)
            await syncRegions(pool, logger);
            await syncSystemsAndStations(pool, logger);
            await syncMarketStructures(pool, logger);
            // Sync market orders for each region into market_orders table
            await syncMarketOrders(pool, logger);

            logger('ESI sync complete');
        } catch (err) {
            logger('❌ ESI sync failed:', err && err.message ? err.message : err);
        } finally {
            if (pool) await pool.close();
        }
    } catch (err) {
        logger('❌ Unhandled exception in ESI sync:', err.stack || err.message || err);
    }

    // Log any top-level error for Azure log stream
    // eslint-disable-next-line no-console
    console.error('❌ Top-level error in esi_sync/index.js:', err && err.stack ? err.stack : err);
    throw err;
}

/**
 * Fetch and cache latest market orders from ESI into SQL market_orders table
 */
async function syncMarketOrders(pool, logger) {
    logger('Syncing market orders for all regions');
    // Retrieve region IDs from DB
    const regionsResult = await pool.request().query('SELECT region_id FROM regions');
    const regions = regionsResult.recordset.map(r => r.region_id);
    for (const regionId of regions) {
        logger(`⏳ Fetching orders for region ${regionId}`);
        try {
            const orders = await fetchESIPaged(`/markets/${regionId}/orders/`, {});
            logger(`🔄 Upserting ${orders.length} orders for region ${regionId}`);
            for (const order of orders) {
                const req = pool.request()
                    .input('orderId', sql.BigInt, order.order_id)
                    .input('typeId', sql.Int, order.type_id)
                    .input('regionId', sql.Int, regionId)
                    .input('locationId', sql.BigInt, order.location_id)
                    .input('price', sql.Decimal(18, 2), order.price)
                    .input('volTotal', sql.Int, order.volume_total)
                    .input('volRemain', sql.Int, order.volume_remain)
                    .input('minVol', sql.Int, order.min_volume)
                    .input('isBuy', sql.Bit, order.is_buy_order ? 1 : 0)
                    .input('duration', sql.Int, order.duration)
                    .input('issued', sql.DateTime2, new Date(order.issued));
                await req.query(`
MERGE market_orders AS target
USING (SELECT @orderId as order_id) AS source
ON target.order_id = source.order_id
WHEN MATCHED THEN UPDATE SET
    type_id = @typeId,
    region_id = @regionId,
    location_id = @locationId,
    price = @price,
    volume_total = @volTotal,
    volume_remain = @volRemain,
    min_volume = @minVol,
    is_buy_order = @isBuy,
    duration = @duration,
    issued = @issued
WHEN NOT MATCHED THEN INSERT (order_id,type_id,region_id,location_id,price,volume_total,volume_remain,min_volume,is_buy_order,duration,issued)
    VALUES (@orderId,@typeId,@regionId,@locationId,@price,@volTotal,@volRemain,@minVol,@isBuy,@duration,@issued);
                `);
            }
        } catch (e) {
            logger(`Error syncing orders for region ${regionId}:`, e && e.message ? e.message : e);
        }
    }
}

async function syncPriceHistory(pool, log) {
    log('📈 Starting price history sync');

    const regions = await pool.request().query('SELECT region_id FROM regions');
    const types = await pool.request().query('SELECT DISTINCT type_id FROM market_orders');

    for (const { region_id } of regions.recordset) {
        for (const { type_id } of types.recordset) {
            try {
                const url = `https://esi.evetech.net/latest/markets/${region_id}/history/?type_id=${type_id}`;
                const response = await fetch(url);
                if (!response.ok) {
                    log(`⚠️ Failed to fetch history for region ${region_id}, type ${type_id}: ${response.status}`);
                    continue;
                }

                const history = await response.json();
                log(`🔄 Upserting ${history.length} records for region ${region_id}, type ${type_id}`);

                for (const entry of history) {
                    await pool.request()
                        .input('regionId', sql.Int, region_id)
                        .input('typeId', sql.Int, type_id)
                        .input('date', sql.Date, entry.date)
                        .input('average', sql.Float, entry.average)
                        .input('highest', sql.Float, entry.highest)
                        .input('lowest', sql.Float, entry.lowest)
                        .input('orderCount', sql.Int, entry.order_count)
                        .input('volume', sql.BigInt, entry.volume)
                        .query(`
MERGE price_history AS target
USING (SELECT @regionId AS region_id, @typeId AS type_id, @date AS date) AS source
ON target.region_id = source.region_id AND target.type_id = source.type_id AND target.date = source.date
WHEN MATCHED THEN UPDATE SET
    average = @average,
    highest = @highest,
    lowest = @lowest,
    order_count = @orderCount,
    volume = @volume
WHEN NOT MATCHED THEN INSERT (region_id, type_id, date, average, highest, lowest, order_count, volume)
VALUES (@regionId, @typeId, @date, @average, @highest, @lowest, @orderCount, @volume);
                    `);
                }
            } catch (err) {
                log(`❌ Error syncing history for region ${region_id}, type ${type_id}: ${err.message}`);
            }
        }
    }

    log('✅ Price history sync complete');
}


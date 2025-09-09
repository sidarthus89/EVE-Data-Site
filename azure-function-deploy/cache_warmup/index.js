const sql = require('mssql');
const { getDbConfig } = require('../utils/db');
const dbConfig = getDbConfig();

// Popular items to pre-cache
const POPULAR_TYPE_IDS = [
    44992, // Plex
    29668, // Skill Injector  
    34, // Tritanium
    35, // Pyerite
    36, // Mexallon
    37, // Isogen
    38, // Nocxium
    39, // Zydrine
    40, // Megacyte
    11399, // Morphite
];

const MAJOR_TRADE_HUBS = [
    30000142, // Jita IV - Moon 4 - Caldari Navy Assembly Plant
    30002187, // Amarr VIII (Oris) - Emperor Family Academy
    30002659, // Dodixie IX - Moon 20 - Federation Navy Assembly Plant
    30002510, // Rens VI - Moon 8 - Brutor Tribe Treasury
    30000144, // Perimeter II - Moon 1 - Caldari Navy Assembly Plant
];

module.exports = async function (context, myTimer) {
    const startTime = new Date();
    context.log('CacheWarmup function started at:', startTime.toISOString());

    try {
        if (!dbConfig) {
            throw new Error('Database configuration is missing. Provide DB_CONNECTION_STRING or SQLCONNSTR_* or DB_* env vars.');
        }
        const pool = await sql.connect(dbConfig);

        let cacheEntriesCreated = 0;

        // Pre-cache popular market data
        for (const typeId of POPULAR_TYPE_IDS) {
            for (const locationId of MAJOR_TRADE_HUBS) {
                // Check if cache entry exists and is recent
                const existingCache = await pool.request()
                    .input('typeId', sql.Int, typeId)
                    .input('locationId', sql.BigInt, locationId)
                    .query(`
            SELECT cache_key FROM cache_entries 
            WHERE cache_key = CONCAT('market_orders_', @typeId, '_', @locationId)
              AND created_at > DATEADD(minute, -30, GETUTCDATE())
          `);

                if (existingCache.recordset.length === 0) {
                    // Fetch fresh market data
                    const marketData = await pool.request()
                        .input('typeId', sql.Int, typeId)
                        .input('locationId', sql.BigInt, locationId)
                        .query(`
              SELECT * FROM market_orders 
              WHERE type_id = @typeId AND location_id = @locationId
              ORDER BY price ${Math.random() > 0.5 ? 'ASC' : 'DESC'}
            `);                    // Store in cache
                    const cacheKey = `market_orders_${typeId}_${locationId}`;
                    const cacheData = JSON.stringify(marketData.recordset);

                    await pool.request()
                        .input('cacheKey', sql.NVarChar, cacheKey)
                        .input('cacheData', sql.NVarChar, cacheData)
                        .query(`
              MERGE cache_entries AS target
              USING (SELECT @cacheKey as cache_key, @cacheData as cache_data) AS source
              ON target.cache_key = source.cache_key
              WHEN MATCHED THEN 
                UPDATE SET cache_data = source.cache_data, created_at = GETUTCDATE()
              WHEN NOT MATCHED THEN
                INSERT (cache_key, cache_data, created_at) 
                VALUES (source.cache_key, source.cache_data, GETUTCDATE());
            `);

                    cacheEntriesCreated++;
                }
            }
        }

        // Pre-cache region hauling routes for major regions
        const majorRegions = [10000002, 10000043, 10000032, 10000030]; // The Forge, Domain, Sinq Laison, Heimatar

        for (let i = 0; i < majorRegions.length; i++) {
            for (let j = i + 1; j < majorRegions.length; j++) {
                const fromRegion = majorRegions[i];
                const toRegion = majorRegions[j];

                const cacheKey = `region_hauling_${fromRegion}_${toRegion}`;
                const existingCache = await pool.request()
                    .input('cacheKey', sql.NVarChar, cacheKey)
                    .query(`
            SELECT cache_key FROM cache_entries 
            WHERE cache_key = @cacheKey
              AND created_at > DATEADD(hour, -2, GETUTCDATE())
          `);

                if (existingCache.recordset.length === 0) {
                    const routeData = await pool.request()
                        .input('fromRegion', sql.Int, fromRegion)
                        .input('toRegion', sql.Int, toRegion)
                        .query(`
              SELECT TOP 20
                sell.type_id,
                sell.location_id AS origin_id,
                buy.location_id AS destination_id,
                sell.price AS sell_price,
                buy.price AS buy_price,
                (buy.price - sell.price) AS profit_per_unit
              FROM market_orders sell
              JOIN market_orders buy ON sell.type_id = buy.type_id
              WHERE sell.is_buy_order = 0 AND buy.is_buy_order = 1
                AND sell.region_id = @fromRegion AND buy.region_id = @toRegion
                AND buy.price > sell.price
              ORDER BY (buy.price - sell.price) DESC
            `); const cacheData = JSON.stringify(routeData.recordset);

                    await pool.request()
                        .input('cacheKey', sql.NVarChar, cacheKey)
                        .input('cacheData', sql.NVarChar, cacheData)
                        .query(`
              MERGE cache_entries AS target
              USING (SELECT @cacheKey as cache_key, @cacheData as cache_data) AS source
              ON target.cache_key = source.cache_key
              WHEN MATCHED THEN 
                UPDATE SET cache_data = source.cache_data, created_at = GETUTCDATE()
              WHEN NOT MATCHED THEN
                INSERT (cache_key, cache_data, created_at) 
                VALUES (source.cache_key, source.cache_data, GETUTCDATE());
            `);

                    cacheEntriesCreated++;
                }
            }
        }

        const duration = new Date() - startTime;
        context.log(`CacheWarmup completed in ${duration}ms: ${cacheEntriesCreated} cache entries created/updated`);

    } catch (error) {
        context.log.error('CacheWarmup error:', error);
        throw error;
    }
};

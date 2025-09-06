const sql = require('mssql');

const dbConfig = {
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    server: process.env.DB_SERVER,
    options: { encrypt: true }
};

module.exports = async function (context, myTimer) {
    const startTime = new Date();
    context.log('PruneHistory function started at:', startTime.toISOString());

    try {
        const pool = await sql.connect(dbConfig);

        // Define retention periods (in days)
        const MARKET_ORDERS_RETENTION = 7;
        const MARKET_HISTORY_RETENTION = 90;
        const CACHE_RETENTION = 1;

        // Prune old market orders
        const ordersResult = await pool.request()
            .input('retentionDays', sql.Int, MARKET_ORDERS_RETENTION)
            .query(`
        DELETE FROM market_orders 
        WHERE issued < DATEADD(day, -@retentionDays, GETUTCDATE())
      `);        // Prune old market history
        const historyResult = await pool.request()
            .input('retentionDays', sql.Int, MARKET_HISTORY_RETENTION)
            .query(`
        DELETE FROM price_history 
        WHERE date < DATEADD(day, -@retentionDays, GETUTCDATE())
      `);

        // Prune old cache entries
        const cacheResult = await pool.request()
            .input('retentionDays', sql.Int, CACHE_RETENTION)
            .query(`
        DELETE FROM cache_entries 
        WHERE created_at < DATEADD(day, -@retentionDays, GETUTCDATE())
      `);

        // Clean up orphaned delta records (skip if table doesn't exist)
        try {
            const deltaResult = await pool.request()
                .query(`
            DELETE d FROM market_deltas d
            LEFT JOIN market_orders o ON d.order_id = o.order_id
            WHERE o.order_id IS NULL
          `);
        } catch (deltaErr) {
            context.log.warn('Delta cleanup skipped (table may not exist):', deltaErr.message);
        }

        const duration = new Date() - startTime;
        context.log(`PruneHistory completed in ${duration}ms:`, {
            marketOrders: ordersResult.rowsAffected[0],
            marketHistory: historyResult.rowsAffected[0],
            cacheEntries: cacheResult.rowsAffected[0],
            deltaRecords: deltaResult.rowsAffected[0]
        });

    } catch (error) {
        context.log.error('PruneHistory error:', error);
        throw error;
    }
};

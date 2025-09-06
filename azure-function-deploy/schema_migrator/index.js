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
    context.log('SchemaMigrator function started at:', startTime.toISOString());

    try {
        const pool = await sql.connect(dbConfig);

        // Check current schema version
        const versionResult = await pool.request().query(`
      IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'schema_migrations')
      BEGIN
        CREATE TABLE schema_migrations (
          id INT IDENTITY(1,1) PRIMARY KEY,
          version VARCHAR(50) NOT NULL,
          applied_at DATETIME2 DEFAULT GETUTCDATE()
        );
        INSERT INTO schema_migrations (version) VALUES ('1.0.0');
      END
    `);

        // Get current version
        const currentVersion = await pool.request().query(`
      SELECT TOP 1 version FROM schema_migrations ORDER BY applied_at DESC
    `);

        const version = currentVersion.recordset[0]?.version || '1.0.0';
        context.log(`Current schema version: ${version}`);

        // Apply pending migrations based on version
        let migrationsApplied = 0;

        // Example migration: Add indexes if not exist
        if (version < '1.1.0') {
            await pool.request().query(`
        IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_market_orders_type_region')
        BEGIN
          CREATE INDEX IX_market_orders_type_region 
          ON market_orders (type_id, region_id, is_buy_order);
        END
      `);

            await pool.request().query(`
        INSERT INTO schema_migrations (version) VALUES ('1.1.0')
      `);
            migrationsApplied++;
            context.log('Applied migration 1.1.0: Added market orders indexes');
        }

        // Update statistics for better query performance
        await pool.request().query(`
      UPDATE STATISTICS market_orders;
      UPDATE STATISTICS price_history;
    `);        // Rebuild fragmented indexes (if fragmentation > 30%)
        const fragmentationResult = await pool.request().query(`
      SELECT 
        OBJECT_NAME(i.object_id) AS table_name,
        i.name AS index_name,
        s.avg_fragmentation_in_percent
      FROM sys.dm_db_index_physical_stats(DB_ID(), NULL, NULL, NULL, 'LIMITED') s
      JOIN sys.indexes i ON s.object_id = i.object_id AND s.index_id = i.index_id
      WHERE s.avg_fragmentation_in_percent > 30
        AND i.name IS NOT NULL
    `);

        for (const row of fragmentationResult.recordset) {
            await pool.request().query(`
        ALTER INDEX [${row.index_name}] ON [${row.table_name}] REBUILD
      `);
            context.log(`Rebuilt fragmented index: ${row.table_name}.${row.index_name} (${row.avg_fragmentation_in_percent.toFixed(1)}% fragmented)`);
        }

        const duration = new Date() - startTime;
        context.log(`SchemaMigrator completed in ${duration}ms:`, {
            migrationsApplied,
            indexesRebuilt: fragmentationResult.recordset.length
        });

    } catch (error) {
        context.log.error('SchemaMigrator error:', error);
        throw error;
    }
};

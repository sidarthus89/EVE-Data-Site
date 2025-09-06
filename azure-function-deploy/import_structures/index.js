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
    context.log('ImportStructures function started at:', startTime.toISOString());

    try {
        const pool = await sql.connect(dbConfig);

        // Fetch structures from ESI
        const esiResponse = await fetch('https://esi.evetech.net/latest/universe/structures/', {
            headers: { 'User-Agent': 'EVE-Data-Site/1.0 (contact@example.com)' }
        });

        if (!esiResponse.ok) {
            throw new Error(`ESI structures request failed: ${esiResponse.status}`);
        }

        const structureIds = await esiResponse.json();
        context.log(`Found ${structureIds.length} structure IDs from ESI`);

        // Clear existing structures data
        await pool.request().query('DELETE FROM structures WHERE source = \'esi\'');

        // Batch insert structure IDs (structure details require authentication)
        const batchSize = 100;
        let insertedCount = 0;

        for (let i = 0; i < structureIds.length; i += batchSize) {
            const batch = structureIds.slice(i, i + batchSize);
            const request = pool.request();

            let query = 'INSERT INTO structures (structure_id, source, last_updated) VALUES ';
            const values = [];

            batch.forEach((id, index) => {
                const paramBase = `@id${index}`;
                request.input(`id${index}`, sql.BigInt, id);
                values.push(`(${paramBase}, 'esi', GETUTCDATE())`);
            });

            query += values.join(', ');
            await request.query(query);
            insertedCount += batch.length;
        }

        const duration = new Date() - startTime;
        context.log(`ImportStructures completed: ${insertedCount} structures imported in ${duration}ms`);

    } catch (error) {
        context.log.error('ImportStructures error:', error);
        throw error;
    }
};
